// ==UserScript==
// @name         Torn PDA - Strip Poker Advisor
// @namespace    alex.torn.pda.strippoker.bubble
// @version      2.0.0
// @description  Texas Hold'em advisor for Torn Strip Poker. Auto-detects hole + community cards, evaluates best-of-7 hand via Monte Carlo, suggests optimal play.
// @author       Alex + Devin
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-strip-poker-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-strip-poker-bubble.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Torn PDA replaces this placeholder with the real API key at injection time.
  // Outside PDA (e.g. Tampermonkey) it stays as the literal placeholder string.
  const PDA_INJECTED_KEY = '###PDA-APIKEY###';

  /* ── constants ─────────────────────────────────────────────── */
  const SCRIPT_KEY   = 'tpda_strip_poker_v1';
  const BUBBLE_ID    = 'tpda-poker-bubble';
  const PANEL_ID     = 'tpda-poker-panel';
  const HEADER_ID    = 'tpda-poker-header';
  const BUBBLE_SIZE  = 40;
  const MC_ITERATIONS = 5000;

  const RANKS   = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const SUITS   = ['c','d','h','s'];
  const SUIT_SYM = { c: '\u2663', d: '\u2666', h: '\u2665', s: '\u2660' };
  const SUIT_CLR = { c: '#4caf50', d: '#42a5f5', h: '#ef5350', s: '#e0e0e0' };
  const RANK_VAL = {};
  RANKS.forEach((r, i) => { RANK_VAL[r] = i + 2; });

  const HAND_NAMES = [
    'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
    'Straight', 'Flush', 'Full House', 'Four of a Kind',
    'Straight Flush', 'Royal Flush'
  ];

  /* ── state ─────────────────────────────────────────────────── */
  const STATE = {
    myCards: [],       /* hole cards (0-2) */
    tableCards: [],    /* community cards (0-5) */
    cardSource: null, /* 'xhr', 'scan', 'manual' — tracks how cards were set */
    pickingRank: null,
    pickTarget: 'hole', /* 'hole' or 'table' — which set the picker adds to */
    handEval: null,
    winProb: null,
    suggestion: null,
    oppRange: null,
    showRange: false,
    ui: { minimized: true, zIndexBase: 999960 },
    _logs: []
  };

  // #COMMON_CODE


  /* ── Panel expand/collapse hooks (called by common code) ──── */

  function onPanelExpand() {
    renderPanel();
  }

  function onPanelCollapse() {}

  /* ── shared utilities ──────────────────────────────────────── */
  /* ── position helpers ──────────────────────────────────────── */
  /* ── card helpers ──────────────────────────────────────────── */
  function cardKey(c)  { return c.rank + c.suit; }
  function cardHtml(c) {
    return `<span style="color:${SUIT_CLR[c.suit]};font-weight:bold;">${escapeHtml(c.rank)}${SUIT_SYM[c.suit]}</span>`;
  }

  /* ── classCode parser (Torn casino format) ─────────────────── */
  const CLASS_SUIT_MAP = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' };
  function parseClassCode(classCode) {
    if (!classCode) return null;
    const m = classCode.match(/^(hearts|diamonds|clubs|spades)-(\d+|[JQKA])$/i);
    if (!m) return null;
    const suit = CLASS_SUIT_MAP[m[1].toLowerCase()];
    const rank = m[2].toUpperCase();
    if (!suit || !RANK_VAL[rank]) return null;
    return { rank, suit, value: RANK_VAL[rank] };
  }

  /* ── XHR / fetch interception for poker game data ──────────── */
  function handlePokerPayload(data) {
    if (!data || typeof data !== 'object') return;

    function extractCards(info) {
      const cards = [];
      if (!info) return cards;
      if (Array.isArray(info)) {
        info.forEach(c => {
          const parsed = parseClassCode(c.classCode || c.class_code);
          if (parsed) cards.push(parsed);
        });
      } else if (info.classCode || info.class_code) {
        const parsed = parseClassCode(info.classCode || info.class_code);
        if (parsed) cards.push(parsed);
      }
      return cards;
    }

    let holeCards = [];
    let communityCards = [];

    /* Try structured Hold'em fields first */
    if (data.player?.hand)   holeCards = extractCards(data.player.hand);
    if (data.yourCards)       holeCards = holeCards.length ? holeCards : extractCards(data.yourCards);
    if (data.yourHand)       holeCards = holeCards.length ? holeCards : extractCards(data.yourHand);
    if (data.hand)           holeCards = holeCards.length ? holeCards : extractCards(data.hand);

    /* Community / table cards */
    if (data.community)      communityCards = extractCards(data.community);
    if (data.communityCards) communityCards = communityCards.length ? communityCards : extractCards(data.communityCards);
    if (data.table?.cards)   communityCards = communityCards.length ? communityCards : extractCards(data.table.cards);
    if (data.tableCards)     communityCards = communityCards.length ? communityCards : extractCards(data.tableCards);
    if (data.board)          communityCards = communityCards.length ? communityCards : extractCards(data.board);

    /* currentGame array fallback */
    if (holeCards.length === 0 && Array.isArray(data.currentGame)) {
      data.currentGame.forEach(g => {
        if (g.playerCardInfo) holeCards.push(...extractCards([g.playerCardInfo]));
      });
    }

    /* Deep scan fallback: try to find classCode objects */
    if (holeCards.length === 0 && communityCards.length === 0) {
      const all = [];
      const scan = (obj, depth) => {
        if (depth > 3 || !obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          for (const item of obj) {
            if (item && (item.classCode || item.class_code)) {
              const p = parseClassCode(item.classCode || item.class_code);
              if (p) all.push(p);
            } else {
              scan(item, depth + 1);
            }
          }
        } else {
          for (const v of Object.values(obj)) scan(v, depth + 1);
        }
      };
      scan(data, 0);
      /* Heuristic: first 2 unique cards are hole, rest are community */
      const seen = new Set();
      for (const c of all) {
        const k = cardKey(c);
        if (seen.has(k)) continue;
        seen.add(k);
        if (holeCards.length < 2) holeCards.push(c);
        else if (communityCards.length < 5) communityCards.push(c);
      }
    }

    /* Deduplicate */
    function dedup(arr) {
      const seen = new Set();
      return arr.filter(c => { const k = cardKey(c); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    holeCards = dedup(holeCards).slice(0, 2);
    communityCards = dedup(communityCards).slice(0, 5);

    if (holeCards.length >= 1) {
      STATE.myCards = holeCards;
      STATE.tableCards = communityCards;
      STATE.cardSource = 'xhr';
      STATE.pickingRank = null;
      STATE.pickTarget = holeCards.length >= 2 ? 'table' : 'hole';
      const total = holeCards.length + communityCards.length;
      if (holeCards.length >= 2 && total >= 5) runEval();
      else { STATE.handEval = null; STATE.winProb = null; STATE.suggestion = suggest(null); STATE.oppRange = null; }
      addLog(`Auto-detected ${holeCards.length} hole + ${communityCards.length} community card(s)`);
      renderPanel();
    }
  }

  function isPokerUrl(url) {
    return /sid=.*poker/i.test(url) || /poker.*Data/i.test(url) ||
           /stripPoker/i.test(url) || /step=.*poker/i.test(url) ||
           /action=.*poker/i.test(url) ||
           /sid=.*holdem/i.test(url) || /holdem/i.test(url) ||
           /poker.*action/i.test(url);
  }

  function hookFetch() {
    const originalFetch = window.fetch;
    if (!originalFetch) return;
    window.fetch = async function (...args) {
      try {
        const url = String(args[0] && args[0].url ? args[0].url : args[0] || '');
        if (url.includes('api.torn.com/')) extractApiKeyFromUrl(url);
        if (isPokerUrl(url)) {
          const resp = await originalFetch.apply(this, args);
          try { resp.clone().json().then(d => handlePokerPayload(d)).catch(() => {}); } catch {}
          return resp;
        }
      } catch {}
      return originalFetch.apply(this, args);
    };
  }

  function hookXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._tpdaPokerUrl = url;
      try {
        const u = String(url || '');
        if (u.includes('api.torn.com/')) extractApiKeyFromUrl(u);
      } catch {}
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      const u = this._tpdaPokerUrl || '';
      if (u && isPokerUrl(u)) {
        this.addEventListener('load', function () {
          try {
            const d = JSON.parse(this.responseText);
            handlePokerPayload(d);
          } catch {}
        });
      }
      return origSend.apply(this, args);
    };
  }

  /* ── 5-card hand evaluator ─────────────────────────────────── */
  function evaluate5(cards) {
    if (cards.length !== 5) return null;

    const vals  = cards.map(c => c.value).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);

    const isFlush = suits.every(s => s === suits[0]);

    const uniq = [...new Set(vals)].sort((a, b) => b - a);
    let isStraight = false, straightHigh = 0;

    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) {
        isStraight = true;
        straightHigh = uniq[0];
      }
      if (!isStraight && uniq[0] === 14 && uniq[1] === 5 &&
          uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
        isStraight = true;
        straightHigh = 5;
      }
    }

    const freq = {};
    for (const v of vals) freq[v] = (freq[v] || 0) + 1;
    const groups = Object.entries(freq)
      .map(([v, cnt]) => ({ value: Number(v), count: cnt }))
      .sort((a, b) => b.count - a.count || b.value - a.value);
    const counts = groups.map(g => g.count);

    let rank, name;

    if (isStraight && isFlush) {
      rank = straightHigh === 14 ? 9 : 8;
      name = rank === 9 ? 'Royal Flush' : 'Straight Flush';
    } else if (counts[0] === 4)                        { rank = 7; name = 'Four of a Kind'; }
      else if (counts[0] === 3 && counts[1] === 2)     { rank = 6; name = 'Full House'; }
      else if (isFlush)                                 { rank = 5; name = 'Flush'; }
      else if (isStraight)                              { rank = 4; name = 'Straight'; }
      else if (counts[0] === 3)                         { rank = 3; name = 'Three of a Kind'; }
      else if (counts[0] === 2 && counts[1] === 2)      { rank = 2; name = 'Two Pair'; }
      else if (counts[0] === 2)                         { rank = 1; name = 'One Pair'; }
      else                                              { rank = 0; name = 'High Card'; }

    let score;
    if (isStraight) {
      score = rank * 1e10 + straightHigh * Math.pow(15, 4);
    } else {
      score = rank * 1e10;
      for (let i = 0; i < groups.length; i++) {
        score += groups[i].value * Math.pow(15, 4 - i);
      }
    }

    return { rank, name, score };
  }

  /* ── best hand from N cards (Hold'em: best 5 of up to 7) ──── */
  function bestOfN(cards) {
    if (cards.length < 5) return null;
    if (cards.length === 5) return evaluate5(cards);
    let best = null;
    const n = cards.length;
    for (let i = 0; i < n - 4; i++)
      for (let j = i + 1; j < n - 3; j++)
        for (let k = j + 1; k < n - 2; k++)
          for (let l = k + 1; l < n - 1; l++)
            for (let m = l + 1; m < n; m++) {
              const ev = evaluate5([cards[i], cards[j], cards[k], cards[l], cards[m]]);
              if (!best || ev.score > best.score) best = ev;
            }
    return best;
  }

  /* ── Monte Carlo win probability (Hold'em) ─────────────────── */
  function buildDeck(exclude) {
    const ex = new Set(exclude.map(cardKey));
    const deck = [];
    for (const r of RANKS) {
      for (const s of SUITS) {
        if (!ex.has(r + s)) deck.push({ rank: r, suit: s, value: RANK_VAL[r] });
      }
    }
    return deck;
  }

  function shuffleDraw(deck, n) {
    const a = [...deck];
    for (let i = 0; i < n && i < a.length; i++) {
      const j = i + Math.floor(Math.random() * (a.length - i));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  }

  function calcWinProb(holeCards, communityCards) {
    const allKnown = [...holeCards, ...communityCards];
    const deck = buildDeck(allKnown);
    const communityNeeded = 5 - communityCards.length;
    let wins = 0, ties = 0;
    for (let i = 0; i < MC_ITERATIONS; i++) {
      /* Draw remaining community cards + 2 opponent hole cards */
      const drawn = shuffleDraw(deck, communityNeeded + 2);
      const fullCommunity = [...communityCards, ...drawn.slice(0, communityNeeded)];
      const oppHole = drawn.slice(communityNeeded, communityNeeded + 2);

      const myAll  = [...holeCards, ...fullCommunity];
      const oppAll = [...oppHole,  ...fullCommunity];

      const myEval  = bestOfN(myAll);
      const oppEval = bestOfN(oppAll);
      if (!myEval || !oppEval) continue;
      if (myEval.score > oppEval.score) wins++;
      else if (myEval.score === oppEval.score) ties++;
    }
    return {
      win:  wins / MC_ITERATIONS,
      tie:  ties / MC_ITERATIONS,
      lose: 1 - (wins + ties) / MC_ITERATIONS
    };
  }

  /* ── opponent range analysis (Hold'em) ─────────────────────── */
  function calcOppRange(holeCards, communityCards) {
    const allKnown = [...holeCards, ...communityCards];
    const deck = buildDeck(allKnown);
    const communityNeeded = 5 - communityCards.length;
    const range = {};
    for (const n of HAND_NAMES) range[n] = { total: 0, beats: 0 };
    const samples = 3000;
    for (let i = 0; i < samples; i++) {
      const drawn = shuffleDraw(deck, communityNeeded + 2);
      const fullCommunity = [...communityCards, ...drawn.slice(0, communityNeeded)];
      const oppHole = drawn.slice(communityNeeded, communityNeeded + 2);

      const myAll  = [...holeCards, ...fullCommunity];
      const oppAll = [...oppHole,  ...fullCommunity];

      const myEv  = bestOfN(myAll);
      const oppEv = bestOfN(oppAll);
      if (!myEv || !oppEv) continue;
      range[oppEv.name].total++;
      if (oppEv.score > myEv.score) range[oppEv.name].beats++;
    }
    return range;
  }

  /* ── action suggestion ─────────────────────────────────────── */
  function suggest(prob) {
    if (!prob) return { act: '?', color: '#888', desc: 'Enter your hole cards + community cards' };
    const wp = prob.win + prob.tie * 0.5;
    if (wp >= 0.72) return { act: 'RAISE',   color: '#4caf50', desc: 'Strong hand \u2014 raise confidently' };
    if (wp >= 0.55) return { act: 'CALL',    color: '#8bc34a', desc: 'Good hand \u2014 play it' };
    if (wp >= 0.42) return { act: 'CALL',    color: '#ffc107', desc: 'Marginal \u2014 call if bet is small' };
    if (wp >= 0.30) return { act: 'CAUTION', color: '#ff9800', desc: 'Weak \u2014 consider folding' };
    return                  { act: 'FOLD',    color: '#f44336', desc: 'Very weak \u2014 fold' };
  }

  /* ── run full evaluation (Hold'em) ─────────────────────────── */
  function runEval() {
    const allCards = [...STATE.myCards, ...STATE.tableCards];
    if (STATE.myCards.length < 2 || allCards.length < 5) {
      /* Can evaluate current best hand for display, but need at least 2 hole + 3 community for full eval */
      STATE.handEval = allCards.length >= 5 ? bestOfN(allCards) : null;
      STATE.winProb  = null;
      STATE.suggestion = suggest(null);
      STATE.oppRange = null;
      return;
    }
    STATE.handEval   = bestOfN(allCards);
    STATE.winProb    = calcWinProb(STATE.myCards, STATE.tableCards);
    STATE.suggestion = suggest(STATE.winProb);
    STATE.oppRange   = calcOppRange(STATE.myCards, STATE.tableCards);
    addLog(`Hand: ${STATE.handEval?.name} | Win: ${Math.round(STATE.winProb.win * 100)}% | ${STATE.suggestion.act}`);
  }

  /* ── card add / remove / clear (Hold'em) ────────────────────── */
  function allCards() { return [...STATE.myCards, ...STATE.tableCards]; }

  function addCard(rank, suit) {
    const key = rank + suit;
    if (allCards().some(c => cardKey(c) === key)) {
      addLog(`Card ${rank}${SUIT_SYM[suit] || suit} already selected`);
      return;
    }
    const card = { rank, suit, value: RANK_VAL[rank] };
    if (STATE.pickTarget === 'hole' && STATE.myCards.length < 2) {
      STATE.myCards.push(card);
    } else if (STATE.tableCards.length < 5) {
      STATE.tableCards.push(card);
      /* Auto-switch to table after hole is full */
      if (STATE.pickTarget === 'hole' && STATE.myCards.length >= 2) STATE.pickTarget = 'table';
    } else return;
    STATE.cardSource = 'manual';
    STATE.pickingRank = null;
    const total = allCards().length;
    if (STATE.myCards.length >= 2 && total >= 5) runEval();
    renderPanel();
  }

  function removeCard(source, idx) {
    if (source === 'hole') STATE.myCards.splice(idx, 1);
    else STATE.tableCards.splice(idx, 1);
    STATE.handEval = null;
    STATE.winProb  = null;
    STATE.suggestion = suggest(null);
    STATE.oppRange = null;
    renderPanel();
  }

  function clearCards() {
    STATE.myCards = [];
    STATE.tableCards = [];
    STATE.cardSource = null;
    STATE.pickingRank = null;
    STATE.pickTarget = 'hole';
    STATE.handEval = null;
    STATE.winProb  = null;
    STATE.suggestion = suggest(null);
    STATE.oppRange = null;
    renderPanel();
  }

  /* ── DOM scanning (best-effort, Hold'em aware) ──────────────── */
  function scanDom() {
    const cards = [];
    const seen  = new Set();

    function tryAdd(rank, suit) {
      if (!rank || !suit) return;
      rank = rank.toUpperCase();
      suit = suit.toLowerCase();
      if (!RANK_VAL[rank] || !SUITS.includes(suit)) return;
      const k = rank + suit;
      if (seen.has(k)) return;
      seen.add(k);
      cards.push({ rank, suit, value: RANK_VAL[rank] });
    }

    /* Torn casino CSS-class card format: elements with class like "hearts-2", "spades-K" */
    document.querySelectorAll('[class*="hearts-"],[class*="diamonds-"],[class*="clubs-"],[class*="spades-"]').forEach(el => {
      const cls = el.className || '';
      const matches = cls.match(/\b(hearts|diamonds|clubs|spades)-(\d+|[JQKA])\b/gi);
      if (matches) {
        matches.forEach(cc => {
          const parsed = parseClassCode(cc);
          if (parsed) tryAdd(parsed.rank, parsed.suit);
        });
      }
    });

    document.querySelectorAll('[data-card],[data-rank]').forEach(el => {
      if (el.dataset.card) {
        const m = el.dataset.card.match(/^(10|[2-9]|[JQKA])([cdhs])$/i);
        if (m) tryAdd(m[1], m[2]);
      }
      if (el.dataset.rank && el.dataset.suit) tryAdd(el.dataset.rank, el.dataset.suit);
    });

    document.querySelectorAll('img').forEach(img => {
      const src = (img.src || '') + ' ' + (img.alt || '');
      if (src.includes('back') || src.includes('blank')) return;
      const m = src.match(/([2-9]|10|[jJqQkKaA])[\s_-]?(?:of[\s_-]?)?([cCdDhHsS])/);
      if (m) tryAdd(m[1], m[2]);
      const m2 = src.match(/([cdhs])[\s_-]?([2-9]|10|[jqka])/i);
      if (m2) tryAdd(m2[2], m2[1]);
    });

    const symMap = { '\u2663': 'c', '\u2666': 'd', '\u2665': 'h', '\u2660': 's' };
    document.querySelectorAll('[class*="card" i]').forEach(el => {
      if (el.children.length > 5) return;
      const txt = (el.textContent || '').trim();
      if (txt.length > 5) return;
      const m = txt.match(/^(10|[2-9]|[JQKA])\s*([\u2663\u2666\u2665\u2660])$/i) ||
                txt.match(/^([\u2663\u2666\u2665\u2660])\s*(10|[2-9]|[JQKA])$/i);
      if (m) {
        if (symMap[m[1]]) tryAdd(m[2], symMap[m[1]]);
        else if (symMap[m[2]]) tryAdd(m[1], symMap[m[2]]);
      }
    });

    if (cards.length > 0 && cards.length <= 7) {
      /* Don't overwrite XHR-detected hand with fewer DOM-scanned cards */
      const currentTotal = STATE.myCards.length + STATE.tableCards.length;
      if (STATE.cardSource === 'xhr' && currentTotal >= cards.length) {
        addLog(`Scan: ${cards.length} card(s) found but XHR data preferred`);
        return;
      }
      /* Heuristic for Hold'em: first 2 cards are hole, rest are community */
      STATE.myCards = cards.slice(0, 2);
      STATE.tableCards = cards.slice(2, 7);
      STATE.cardSource = 'scan';
      STATE.pickingRank = null;
      STATE.pickTarget = STATE.myCards.length >= 2 ? 'table' : 'hole';
      if (STATE.myCards.length >= 2 && cards.length >= 5) runEval();
      addLog(`Scanned ${cards.length} card(s): ${STATE.myCards.length} hole + ${STATE.tableCards.length} community`);
      renderPanel();
    } else {
      addLog(`Scan: ${cards.length} card(s) found \u2014 ${cards.length === 0 ? 'none detected, use manual input' : 'too many, ignored'}`);
    }
  }

  /* ── styles ────────────────────────────────────────────────── */
  function ensureStyles() {
    if (document.getElementById(`${SCRIPT_KEY}_style`)) return;
    const s = document.createElement('style');
    s.id = `${SCRIPT_KEY}_style`;
    s.textContent = `
      #${BUBBLE_ID} {
        position: fixed;
        width: ${BUBBLE_SIZE}px; height: ${BUBBLE_SIZE}px;
        border-radius: 50%;
        background: linear-gradient(135deg, #1b5e20, #0a3d0a);
        color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-weight: bold; font-family: Arial, sans-serif; font-size: 18px;
        box-shadow: 0 6px 18px rgba(0,0,0,0.4);
        border: 1px solid rgba(255,255,255,0.15);
        user-select: none; -webkit-user-select: none; touch-action: none;
        cursor: grab;
      }
      #${PANEL_ID} {
        position: fixed;
        width: 260px; max-width: 92vw; max-height: 82vh;
        background: rgba(15,15,18,0.98);
        color: #fff;
        border: 1px solid #3a3a45;
        border-radius: 14px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        font-family: Arial, sans-serif; font-size: 12px;
        display: flex; flex-direction: column;
        overflow: hidden;
      }
      #${HEADER_ID} { cursor: move; touch-action: none; }

      .tpda-pk-rank-btn {
        display: inline-block;
        min-width: 18px; padding: 3px 4px; margin: 1px;
        text-align: center;
        background: #1a1b22; color: #ccc;
        border: 1px solid #444; border-radius: 4px;
        cursor: pointer; font-size: 11px; font-family: monospace;
        user-select: none;
      }
      .tpda-pk-rank-btn:hover, .tpda-pk-rank-btn.active {
        background: #2e7d32; color: #fff; border-color: #4caf50;
      }
      .tpda-pk-suit-btn {
        display: inline-block;
        width: 32px; padding: 5px 0; margin: 2px;
        text-align: center;
        border: 1px solid #444; border-radius: 4px;
        cursor: pointer; font-size: 15px;
        user-select: none; background: #1a1b22;
      }
      .tpda-pk-suit-btn:hover { border-color: #aaa; }
      .tpda-pk-suit-btn.used { opacity: 0.25; cursor: default; }

      .tpda-pk-card {
        display: inline-block;
        padding: 2px 6px; margin: 2px;
        border-radius: 4px;
        background: #1a1b22; border: 1px solid #444;
        font-size: 13px; cursor: pointer;
      }
      .tpda-pk-card:hover { border-color: #f44; background: #2c1015; }

      .tpda-pk-bar {
        height: 6px; border-radius: 3px;
        background: #333; overflow: hidden; margin: 4px 0;
      }
      .tpda-pk-bar-fill {
        height: 100%; border-radius: 3px;
        transition: width 0.3s;
      }
    `;
    document.head.appendChild(s);
  }

  /* ── create bubble ─────────────────────────────────────────── */
  function createBubble() {
    if (getBubbleEl()) return;
    const b = document.createElement('div');
    b.id = BUBBLE_ID;
    b.dataset.tpdaBubble = '1';
    b.textContent = '\u2660';

    const pos = getBubblePosition();
    b.style.right  = `${pos.right}px`;
    b.style.bottom = `${pos.bottom}px`;
    b.style.zIndex = String(STATE.ui.zIndexBase);

    b.addEventListener('click', (e) => {
      if (b.dataset.dragged === '1') { b.dataset.dragged = '0'; return; }
      e.preventDefault();
      expandPanelNearBubble();
    });

    document.body.appendChild(b);
    makeDraggableBubble(b);
  }

  /* ── create panel ──────────────────────────────────────────── */
  function createPanel() {
    if (getPanelEl()) return;
    const p = document.createElement('div');
    p.id = PANEL_ID;
    p.style.display = 'none';
    p.style.zIndex  = String(STATE.ui.zIndexBase);

    p.innerHTML = `
      <div id="${HEADER_ID}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#1c1d24;border-bottom:1px solid #333;flex:0 0 auto;">
        <div>
          <div style="font-weight:bold;font-size:13px;">\u2660 Poker Advisor</div>
          <div style="font-size:10px;color:#bbb;">Strip Poker hand evaluator</div>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <button id="tpda-pk-scan" style="background:#1b5e20;color:#fff;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;">Scan</button>
          <button id="tpda-pk-collapse" style="background:#444;color:#fff;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;">\u25CB</button>
        </div>
      </div>
      <div id="tpda-pk-body" style="padding:8px;overflow-y:auto;flex:1 1 auto;"></div>
    `;

    document.body.appendChild(p);

    document.getElementById('tpda-pk-scan').addEventListener('click', scanDom);
    document.getElementById('tpda-pk-collapse').addEventListener('click', collapseToBubble);

    /* Delegated click handler — attached ONCE here, never inside renderPanel().
       innerHTML replacement destroys child nodes but #tpda-pk-body itself persists,
       so this single listener handles all clicks on dynamically rendered content. */
    const panelBody = document.getElementById('tpda-pk-body');
    panelBody.addEventListener('click', (e) => {
      if (handleApiKeyClick(e, panelBody, () => renderPanel())) return;
      if (handleLogClick(e, panelBody)) return;
    });

    makeDraggablePanel(p, document.getElementById(HEADER_ID));
  }

  /* ── expand / collapse ─────────────────────────────────────── */
  /* ── draggable bubble ──────────────────────────────────────── */
  /* ── draggable panel ───────────────────────────────────────── */
  /* ── window resize ─────────────────────────────────────────── */
  /* ── render panel ──────────────────────────────────────────── */
  function renderPanel() {
    const body = document.getElementById('tpda-pk-body');
    if (!body) return;

    let h = '';
    const totalCards = STATE.myCards.length + STATE.tableCards.length;

    /* ─ hole cards (your hand) ─ */
    h += `<div style="margin-bottom:6px;">`;
    h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">`;
    const srcLabel = STATE.cardSource === 'xhr' ? ' (auto)' : STATE.cardSource === 'scan' ? ' (scanned)' : '';
    h += `<span style="font-weight:bold;font-size:11px;">Your Cards (${STATE.myCards.length}/2)${srcLabel}</span>`;
    if (totalCards > 0) {
      h += `<span id="tpda-pk-clear" style="color:#f44;cursor:pointer;font-size:11px;">Clear All</span>`;
    }
    h += `</div>`;

    if (STATE.myCards.length > 0) {
      h += `<div style="display:flex;gap:3px;flex-wrap:wrap;">`;
      STATE.myCards.forEach((c, i) => {
        h += `<span class="tpda-pk-card" data-source="hole" data-idx="${i}" title="Tap to remove">${cardHtml(c)}</span>`;
      });
      h += `</div>`;
    } else {
      h += `<div style="color:#666;font-size:11px;">Cards auto-detect when playing, or tap to pick</div>`;
    }
    h += `</div>`;

    /* ─ community cards (table) ─ */
    h += `<div style="margin-bottom:6px;">`;
    h += `<div style="margin-bottom:4px;">`;
    h += `<span style="font-weight:bold;font-size:11px;">Community Cards (${STATE.tableCards.length}/5)</span>`;
    h += `</div>`;

    if (STATE.tableCards.length > 0) {
      h += `<div style="display:flex;gap:3px;flex-wrap:wrap;">`;
      STATE.tableCards.forEach((c, i) => {
        h += `<span class="tpda-pk-card" data-source="table" data-idx="${i}" title="Tap to remove">${cardHtml(c)}</span>`;
      });
      h += `</div>`;
    } else {
      h += `<div style="color:#666;font-size:11px;">Waiting for flop...</div>`;
    }
    h += `</div>`;

    /* ─ card picker ─ */
    if (STATE.myCards.length < 2 || STATE.tableCards.length < 5) {
      const usedKeys = new Set([...STATE.myCards, ...STATE.tableCards].map(cardKey));
      const isHole  = STATE.pickTarget === 'hole' && STATE.myCards.length < 2;
      const isTable = !isHole;

      h += `<div style="margin-bottom:6px;padding:6px;border:1px solid #2f3340;border-radius:8px;background:#141821;">`;

      /* Pick target toggle */
      h += `<div style="display:flex;gap:4px;margin-bottom:4px;font-size:10px;">`;
      h += `<span id="tpda-pk-target-hole" style="cursor:pointer;padding:2px 6px;border-radius:4px;${isHole ? 'background:#2e7d32;color:#fff;' : 'color:#888;'}">Hole${STATE.myCards.length >= 2 ? ' (full)' : ''}</span>`;
      h += `<span id="tpda-pk-target-table" style="cursor:pointer;padding:2px 6px;border-radius:4px;${isTable ? 'background:#1565c0;color:#fff;' : 'color:#888;'}">Community${STATE.tableCards.length >= 5 ? ' (full)' : ''}</span>`;
      h += `</div>`;

      h += `<div style="display:flex;flex-wrap:wrap;gap:1px;margin-bottom:4px;">`;
      for (const r of RANKS) {
        const active = STATE.pickingRank === r ? ' active' : '';
        h += `<span class="tpda-pk-rank-btn${active}" data-rank="${r}">${r}</span>`;
      }
      h += `</div>`;

      if (STATE.pickingRank) {
        h += `<div style="display:flex;gap:3px;justify-content:center;">`;
        for (const s of SUITS) {
          const key  = STATE.pickingRank + s;
          const used = usedKeys.has(key);
          const cls  = used ? ' used' : '';
          h += `<span class="tpda-pk-suit-btn${cls}" style="color:${SUIT_CLR[s]};"`;
          if (!used) h += ` data-pick="${key}"`;
          h += `>${SUIT_SYM[s]}</span>`;
        }
        h += `</div>`;
      } else {
        h += `<div style="color:#666;font-size:10px;text-align:center;">Pick a rank first</div>`;
      }

      h += `</div>`;
    }

    /* ─ evaluation results ─ */
    if (STATE.handEval) {
      const wp  = STATE.winProb ? Math.round(STATE.winProb.win  * 100) : 0;
      const tp  = STATE.winProb ? Math.round(STATE.winProb.tie  * 100) : 0;
      const lp  = STATE.winProb ? Math.round(STATE.winProb.lose * 100) : 0;
      const eff = STATE.winProb ? Math.round((STATE.winProb.win + STATE.winProb.tie * 0.5) * 100) : 0;
      const sg  = STATE.suggestion || suggest(null);

      h += `<div style="margin-bottom:6px;padding:8px;border:1px solid #2f3340;border-radius:8px;background:#141821;">`;
      h += `<div style="font-weight:bold;font-size:14px;margin-bottom:2px;">${escapeHtml(STATE.handEval.name)}</div>`;
      if (STATE.winProb) {
        h += `<div class="tpda-pk-bar"><div class="tpda-pk-bar-fill" style="width:${eff}%;background:${sg.color};"></div></div>`;
        h += `<div style="display:flex;justify-content:space-between;font-size:11px;color:#bbb;">`;
        h += `<span>W\u2009${wp}%\u2009\u00b7\u2009T\u2009${tp}%\u2009\u00b7\u2009L\u2009${lp}%</span>`;
        h += `<span style="font-weight:bold;">${eff}%</span>`;
        h += `</div>`;
      } else {
        h += `<div style="font-size:11px;color:#ffc107;">Best hand so far (need 2 hole + 3+ community for full eval)</div>`;
      }
      h += `</div>`;

      if (STATE.winProb) {
        h += `<div style="margin-bottom:6px;padding:8px;border:2px solid ${sg.color};border-radius:8px;background:rgba(0,0,0,0.3);text-align:center;">`;
        h += `<div style="font-size:18px;font-weight:bold;color:${sg.color};">${escapeHtml(sg.act)}</div>`;
        h += `<div style="font-size:11px;color:#bbb;">${escapeHtml(sg.desc)}</div>`;
        h += `</div>`;
      }

      /* ─ opponent range (collapsible) ─ */
      if (STATE.oppRange) {
        h += `<div style="margin-bottom:6px;">`;
        h += `<div id="tpda-pk-range-toggle" style="cursor:pointer;color:#42a5f5;font-size:11px;font-weight:bold;">`;
        h += `${STATE.showRange ? '\u25BC' : '\u25B6'} What can beat you?</div>`;

        if (STATE.showRange) {
          h += `<div style="margin-top:4px;padding:6px;border:1px solid #2f3340;border-radius:6px;background:#0f1116;font-size:11px;">`;
          for (let i = HAND_NAMES.length - 1; i >= 0; i--) {
            const name = HAND_NAMES[i];
            const r = STATE.oppRange[name];
            if (!r || !r.total) continue;
            const pct     = Math.round((r.total / 3000) * 100);
            const beatPct = r.total > 0 ? Math.round((r.beats / r.total) * 100) : 0;
            const beatAny = r.beats > 0;
            const color   = beatAny ? '#ff9f9f' : '#8dff8d';
            h += `<div style="display:flex;justify-content:space-between;padding:1px 0;">`;
            h += `<span>${escapeHtml(name)}</span>`;
            h += `<span style="color:${color};">${pct}%`;
            if (beatAny) h += ` \u2014 ${beatPct}% beats`;
            h += `</span></div>`;
          }
          h += `</div>`;
        }

        h += `</div>`;
      }
    } else if (totalCards > 0 && (STATE.myCards.length < 2 || totalCards < 5)) {
      h += `<div style="padding:6px;color:#ffc107;font-size:11px;text-align:center;">`;
      if (STATE.myCards.length < 2) {
        h += `Pick ${2 - STATE.myCards.length} more hole card${2 - STATE.myCards.length > 1 ? 's' : ''}`;
      } else {
        h += `Pick ${Math.max(0, 5 - totalCards)} more community card${5 - totalCards > 1 ? 's' : ''} for evaluation`;
      }
      h += `</div>`;
    }

    /* ─ api key card ─ */
    h += renderApiKeyCard();

    /* ─ debug log ─ */
    h += renderLogCard();

    body.innerHTML = h;

    /* ── wire up event handlers ── */
    const clearBtn = document.getElementById('tpda-pk-clear');
    if (clearBtn) clearBtn.onclick = clearCards;

    body.querySelectorAll('.tpda-pk-card[data-idx]').forEach(el => {
      el.onclick = () => removeCard(el.dataset.source, Number(el.dataset.idx));
    });

    body.querySelectorAll('.tpda-pk-rank-btn[data-rank]').forEach(el => {
      el.onclick = () => {
        STATE.pickingRank = STATE.pickingRank === el.dataset.rank ? null : el.dataset.rank;
        renderPanel();
      };
    });

    body.querySelectorAll('.tpda-pk-suit-btn[data-pick]').forEach(el => {
      el.onclick = () => {
        const key  = el.dataset.pick;
        const rank = key.slice(0, -1);
        const suit = key.slice(-1);
        addCard(rank, suit);
      };
    });

    const holeTarget = document.getElementById('tpda-pk-target-hole');
    const tableTarget = document.getElementById('tpda-pk-target-table');
    if (holeTarget) holeTarget.onclick = () => {
      if (STATE.myCards.length < 2) { STATE.pickTarget = 'hole'; renderPanel(); }
    };
    if (tableTarget) tableTarget.onclick = () => {
      STATE.pickTarget = 'table'; renderPanel();
    };

    const rangeToggle = document.getElementById('tpda-pk-range-toggle');
    if (rangeToggle) {
      rangeToggle.onclick = () => { STATE.showRange = !STATE.showRange; renderPanel(); };
    }
  }

  /* ── MutationObserver for auto-scan ──────────────────────── */
  let _scanTimer = null;
  function startCardObserver() {
    const target = document.getElementById('mainContainer') || document.body;
    const observer = new MutationObserver(() => {
      /* Debounce: wait 500ms after last mutation before scanning */
      if (_scanTimer) clearTimeout(_scanTimer);
      _scanTimer = setTimeout(() => {
        /* Only scan if panel is visible (user has opened the advisor) */
        const panel = getPanelEl();
        if (panel && panel.style.display !== 'none') {
          scanDom();
        }
      }, 500);
    });
    observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    addLog('Card auto-scan observer started');
  }

  /* ── init ──────────────────────────────────────────────────── */
  function init() {
    initApiKey(PDA_INJECTED_KEY);

    ensureStyles();
    createBubble();
    createPanel();
    startCardObserver();
    window.addEventListener('resize', onResize);
    addLog('Strip Poker Advisor v1.1.0 initialized' + (STATE.apiKey ? '' : ' — waiting for API key'));
    console.log('[Strip Poker Advisor] v1.1.0 Started.');
  }

  /* Install network hooks immediately (before DOM is ready) so we catch early game data */
  hookFetch();
  hookXHR();

  setTimeout(init, 1200);
})();
