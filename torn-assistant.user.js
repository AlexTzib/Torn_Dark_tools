// ==UserScript==
// @name         Torn PDA - Safe AI Advisor Bubble
// @namespace    alex.torn.pda.safe.ai.bubble
// @version      3.0.0
// @description  Safe local Torn PDA advisor with draggable chat-head bubble and expandable panel
// @author       Alex + ChatGPT
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_KEY = 'tpda_safe_ai_bubble_v3';
  const BUBBLE_ID = 'tpda-safe-ai-bubble';
  const PANEL_ID = 'tpda-safe-ai-panel';
  const HEADER_ID = 'tpda-safe-ai-header';

  const STATE = {
    userData: {},
    tornData: {},
    lastSeen: {
      user: 0,
      torn: 0
    },
    ui: {
      minimized: true,
      zIndexBase: 999990,
      bubbleSize: 56
    }
  };

  const STOCK_RULES = {
    ASS: { shares: 1000000, type: 'active', frequencyDays: 7,  benefit: '1x Six Pack of Alcohol' },
    BAG: { shares: 3000000, type: 'active', frequencyDays: 7,  benefit: '1x Ammunition Pack (Special Ammo)' },
    CNC: { shares: 7500000, type: 'active', frequencyDays: 31, benefit: '$80,000,000', cashValue: 80000000 },
    EWM: { shares: 1000000, type: 'active', frequencyDays: 7,  benefit: '1x Box of Grenades' },
    ELT: { shares: 5000000, type: 'passive', benefit: '10% Home Upgrade Discount' },
    EVL: { shares: 100000,  type: 'active', frequencyDays: 7,  benefit: '1000 Happy' },
    FHG: { shares: 2000000, type: 'active', frequencyDays: 7,  benefit: '1x Feathery Hotel Coupon' },
    GRN: { shares: 500000,  type: 'active', frequencyDays: 31, benefit: '$4,000,000', cashValue: 4000000 },
    CBD: { shares: 350000,  type: 'active', frequencyDays: 7,  benefit: '50 Nerve' },
    HRG: { shares: 10000000, type: 'active', frequencyDays: 31, benefit: '1x Random Property' },
    IIL: { shares: 1000000, type: 'passive', benefit: '50% Virus Coding Time Reduction' },
    IOU: { shares: 3000000, type: 'active', frequencyDays: 31, benefit: '$12,000,000', cashValue: 12000000 },
    IST: { shares: 100000,  type: 'passive', benefit: 'Free Education Courses' },
    LAG: { shares: 750000,  type: 'active', frequencyDays: 7,  benefit: '1x Lawyer Business Card' },
    LOS: { shares: 7500000, type: 'passive', benefit: '25% Mission Credits/Money Boost' },
    LSC: { shares: 500000,  type: 'active', frequencyDays: 7,  benefit: '1x Lottery Voucher' },
    MCS: { shares: 350000,  type: 'active', frequencyDays: 7,  benefit: '100 Energy' },
    MSG: { shares: 300000,  type: 'passive', benefit: 'Free Classified Advertising' },
    MUN: { shares: 5000000, type: 'active', frequencyDays: 7,  benefit: '1x Six Pack of Energy Drink' },
    PRN: { shares: 1000000, type: 'active', frequencyDays: 7,  benefit: '1x Erotic DVD' },
    PTS: { shares: 10000000, type: 'active', frequencyDays: 7,  benefit: '100 Points' },
    SYM: { shares: 500000,  type: 'active', frequencyDays: 7,  benefit: '1x Drug Pack' },
    SYS: { shares: 3000000, type: 'passive', benefit: 'Advanced Firewall' },
    TCP: { shares: 1000000, type: 'passive', benefit: 'Company Sales Boost' },
    TCT: { shares: 100000,  type: 'active', frequencyDays: 31, benefit: '$1,000,000', cashValue: 1000000 },
    TCI: { shares: 1500000, type: 'passive', benefit: '10% Bank Interest Bonus' },
    TCC: { shares: 7500000, type: 'active', frequencyDays: 31, benefit: '1x Clothing Cache' },
    TCM: { shares: 1000000, type: 'passive', benefit: '10% Racing Skill Boost' },
    TGP: { shares: 2500000, type: 'passive', benefit: 'Company Advertising Boost' },
    THS: { shares: 150000,  type: 'active', frequencyDays: 7,  benefit: '1x Box of Medical Supplies' },
    TMI: { shares: 6000000, type: 'active', frequencyDays: 31, benefit: '$25,000,000', cashValue: 25000000 },
    TSB: { shares: 3000000, type: 'active', frequencyDays: 31, benefit: '$50,000,000', cashValue: 50000000 },
    WLT: { shares: 9000000, type: 'passive', benefit: 'Private Jet Access' },
    WSU: { shares: 1000000, type: 'passive', benefit: '10% Education Course Time Reduction' },
    YAZ: { shares: 1000000, type: 'passive', benefit: 'Free Banner Advertising' }
  };

  function nowTs() { return Date.now(); }

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function isObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  function deepMerge(target, source) {
    if (!isObject(target) || !isObject(source)) return source;
    const out = { ...target };
    for (const [k, v] of Object.entries(source)) {
      if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
      else out[k] = v;
    }
    return out;
  }

  function formatNumber(n) { return Number(n || 0).toLocaleString(); }
  function formatMoney(n) { return '$' + Number(n || 0).toLocaleString(); }

  function formatSeconds(sec) {
    sec = Number(sec || 0);
    if (sec <= 0) return 'Ready';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (!d && !h) parts.push(`${s}s`);
    return parts.join(' ');
  }

  function ageText(ts) {
    if (!ts) return 'never';
    return formatSeconds(Math.floor((Date.now() - ts) / 1000)) + ' ago';
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function setStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function getDefaultBubblePosition() {
    const existing = document.querySelectorAll('[id^="tpda-safe-ai-bubble"], [data-tpda-bubble="1"]').length;
    const right = 12;
    const bottom = 12 + (existing * 68);
    return { right, bottom };
  }

  function getBubblePosition() {
    return getStorage(`${SCRIPT_KEY}_bubble_pos`, getDefaultBubblePosition());
  }

  function setBubblePosition(pos) {
    setStorage(`${SCRIPT_KEY}_bubble_pos`, pos);
  }

  function getPanelPosition() {
    return getStorage(`${SCRIPT_KEY}_panel_pos`, null);
  }

  function setPanelPosition(pos) {
    setStorage(`${SCRIPT_KEY}_panel_pos`, pos);
  }

  function normalizeUserStocks(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object') {
      return Object.entries(raw).map(([key, value]) => ({ stock_id: key, ...value }));
    }
    return [];
  }

  function normalizeTornStocks(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object') {
      return Object.entries(raw).map(([key, value]) => ({ stock_id: key, ...value }));
    }
    return [];
  }

  function getTicker(item) {
    return item?.acronym || item?.ticker || item?.code || item?.stock || item?.name_short || item?.short_name || '';
  }

  function getOwnedShares(item) {
    return Number(item?.shares_owned ?? item?.shares ?? item?.total_shares ?? item?.amount ?? item?.owned ?? 0);
  }

  function getCurrentPrice(item) {
    return Number(item?.current_price ?? item?.price ?? item?.share_price ?? item?.cost ?? item?.stock_price ?? 0);
  }

  function getBenefitProgressDays(item) {
    return Number(item?.benefit_progress ?? item?.progress ?? item?.days_held ?? item?.days_invested ?? 0);
  }

  function getSelectionsPresent(data) {
    const keys = [];
    if (data.bars) keys.push('bars');
    if (data.cooldowns) keys.push('cooldowns');
    if (data.battlestats) keys.push('battlestats');
    if (data.stocks) keys.push('stocks');
    if (data.money) keys.push('money');
    if (data.profile || data.basic || data.name) keys.push('profile/basic');
    return keys;
  }

  function evaluateHappyJump(user) {
    const bars = user?.bars || {};
    const cds = user?.cooldowns || {};

    const eCur = Number(bars.energy?.current || 0);
    const eMax = Number(bars.energy?.maximum || 0);
    const hCur = Number(bars.happy?.current || 0);
    const hMax = Number(bars.happy?.maximum || 0);
    const drugCd = Number(cds.drug || 0);
    const boosterCd = Number(cds.booster || 0);
    const medicalCd = Number(cds.medical || 0);

    if (eMax <= 0 && hMax <= 0) {
      return {
        label: 'No data yet',
        score: 0,
        energy: 'Unknown',
        happy: 'Unknown',
        recommendation: 'Open a Torn PDA page that loads user data, then refresh this panel.',
        notes: ['No cached user API response detected yet']
      };
    }

    let score = 0;
    const notes = [];

    if (drugCd <= 0) { score += 3; notes.push('Drug cooldown ready'); }
    else notes.push(`Drug cooldown: ${formatSeconds(drugCd)}`);

    if (boosterCd <= 0) { score += 3; notes.push('Booster cooldown ready'); }
    else notes.push(`Booster cooldown: ${formatSeconds(boosterCd)}`);

    if (medicalCd > 0) {
      score -= 1;
      notes.push(`Medical cooldown active: ${formatSeconds(medicalCd)}`);
    }

    if (eMax > 0) {
      const eRatio = eCur / eMax;
      if (eRatio <= 0.35) {
        score += 2;
        notes.push('Energy is low enough for a jump setup window');
      } else if (eRatio <= 0.65) {
        score += 1;
        notes.push('Energy is moderate');
      } else {
        notes.push('Energy is already fairly high');
      }
    }

    if (hMax > 0) {
      const hRatio = hCur / hMax;
      if (hRatio < 1.2) notes.push('Happy is not boosted much above base yet');
      else if (hRatio < 2.5) notes.push('Happy is boosted, but not very high');
      else notes.push('Happy is strongly boosted');
    }

    let label = 'Not ready';
    if (score >= 7) label = 'Strong jump candidate';
    else if (score >= 5) label = 'Possible jump window';
    else if (score >= 3) label = 'Building window';

    let recommendation = 'Keep waiting and avoid wasting cooldown timing.';
    if (label === 'Strong jump candidate') {
      recommendation = 'Your bars and cooldowns look favorable for a jump-style training window. Double-check your intended item sequence manually before committing.';
    } else if (label === 'Possible jump window') {
      recommendation = 'You may be close to a workable jump setup. Main blockers are likely energy level or one remaining cooldown.';
    } else if (label === 'Building window') {
      recommendation = 'You are partway there, but this does not look like an ideal jump state yet.';
    }

    return {
      label,
      score,
      energy: `${formatNumber(eCur)} / ${formatNumber(eMax)}`,
      happy: `${formatNumber(hCur)} / ${formatNumber(hMax)}`,
      recommendation,
      notes
    };
  }

  function buildStockRoiRows(userStocks, tornStocks) {
    const marketByTicker = new Map();
    for (const s of tornStocks) {
      const ticker = getTicker(s);
      if (ticker) marketByTicker.set(ticker, s);
    }

    const rows = [];

    for (const s of userStocks) {
      const ticker = getTicker(s);
      const rule = STOCK_RULES[ticker];
      if (!ticker || !rule) continue;

      const owned = getOwnedShares(s);
      const incrementsOwned = Math.floor(owned / rule.shares);
      const nextTargetShares = (incrementsOwned + 1) * rule.shares;
      const missingShares = Math.max(0, nextTargetShares - owned);

      const market = marketByTicker.get(ticker) || {};
      const livePrice = getCurrentPrice(s) || getCurrentPrice(market) || 0;
      const toNextCost = missingShares * livePrice;

      let payoutPerCycle = null;
      let payoutPerDay = null;
      let paybackDays = null;

      if (rule.type === 'active' && rule.cashValue && rule.frequencyDays) {
        payoutPerCycle = rule.cashValue;
        payoutPerDay = payoutPerCycle / rule.frequencyDays;
        if (toNextCost > 0 && payoutPerDay > 0) {
          paybackDays = toNextCost / payoutPerDay;
        }
      }

      rows.push({
        ticker,
        type: rule.type,
        benefit: rule.benefit,
        owned,
        nextTargetShares,
        missingShares,
        toNextCost,
        payoutPerDay,
        paybackDays
      });
    }

    rows.sort((a, b) => {
      const aMissing = a.missingShares / Math.max(1, STOCK_RULES[a.ticker]?.shares || 1);
      const bMissing = b.missingShares / Math.max(1, STOCK_RULES[b.ticker]?.shares || 1);
      return aMissing - bMissing;
    });

    return rows;
  }

  function buildAdvice(userStocks, tornStocks, user) {
    const out = [];
    const bars = user.bars || {};
    const cds = user.cooldowns || {};

    const eCur = Number(bars.energy?.current || 0);
    const eMax = Number(bars.energy?.maximum || 0);
    const nCur = Number(bars.nerve?.current || 0);
    const nMax = Number(bars.nerve?.maximum || 0);
    const hCur = Number(bars.happy?.current || 0);
    const drugCd = Number(cds.drug || 0);
    const boosterCd = Number(cds.booster || 0);
    const medCd = Number(cds.medical || 0);

    if (!getSelectionsPresent(user).length) {
      out.push('No user data cached yet. Open a normal Torn PDA page that loads your stats, then refresh.');
      return out;
    }

    if (eMax > 0 && eCur >= eMax) out.push('Your energy is capped. Use energy soon so you do not waste regeneration.');
    else if (eMax > 0 && eCur >= Math.floor(eMax * 0.9)) out.push('Your energy is close to cap. Plan your next gym session soon.');

    if (nMax > 0 && nCur >= nMax) out.push('Your nerve is capped. Use it soon to avoid wasting regeneration.');

    if (drugCd <= 0 && boosterCd <= 0 && hCur > 0 && eCur < Math.max(150, eMax * 0.4)) {
      out.push('Drug and booster cooldowns are both ready, and your energy is not too high. This looks like a reasonable setup window.');
    }

    if (medCd > 0) out.push(`Medical cooldown is active for ${formatSeconds(medCd)}.`);

    if (!userStocks.length) {
      out.push('No user stock data cached yet. Open the Stock Market page in Torn PDA and then refresh this panel.');
      return out;
    }

    const roiRows = buildStockRoiRows(userStocks, tornStocks);

    const nearBlock = roiRows.filter(r => r.missingShares > 0).slice(0, 3);
    if (nearBlock.length) {
      out.push(
        'Closest next stock blocks: ' +
        nearBlock.map(r => `${r.ticker} (${formatNumber(r.missingShares)} shares short${r.toNextCost ? `, est. ${formatMoney(r.toNextCost)}` : ''})`).join(' | ')
      );
    }

    const cashRoi = roiRows.filter(r => Number.isFinite(r.paybackDays)).sort((a, b) => a.paybackDays - b.paybackDays).slice(0, 3);
    if (cashRoi.length) {
      out.push(
        'Fastest rough cash payback: ' +
        cashRoi.map(r => `${r.ticker} (~${Math.ceil(r.paybackDays)} days)`).join(' | ')
      );
    }

    out.push('This assistant is advisory only. It does not click, trade, or automate gameplay actions.');
    return out;
  }

  function getBubbleEl() {
    return document.getElementById(BUBBLE_ID);
  }

  function getPanelEl() {
    return document.getElementById(PANEL_ID);
  }

  function ensureStyles() {
    if (document.getElementById(`${SCRIPT_KEY}_style`)) return;
    const style = document.createElement('style');
    style.id = `${SCRIPT_KEY}_style`;
    style.textContent = `
      #${BUBBLE_ID} {
        position: fixed;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #2a6df4, #1745a8);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-family: Arial, sans-serif;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.18);
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
      }
      #${PANEL_ID} {
        position: fixed;
        width: 360px;
        max-width: 95vw;
        max-height: 70vh;
        background: rgba(15,15,18,0.96);
        color: #fff;
        border: 1px solid #3a3a45;
        border-radius: 14px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        font-family: Arial, sans-serif;
        font-size: 13px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      #${HEADER_ID} {
        cursor: move;
        touch-action: none;
      }
    `;
    document.head.appendChild(style);
  }

  function bringToFront(el) {
    STATE.ui.zIndexBase += 1;
    if (el) el.style.zIndex = String(STATE.ui.zIndexBase);
  }

  function clampToViewport(left, top, width, height) {
    const maxLeft = Math.max(0, window.innerWidth - width - 4);
    const maxTop = Math.max(0, window.innerHeight - height - 4);
    return {
      left: Math.min(Math.max(4, left), maxLeft),
      top: Math.min(Math.max(4, top), maxTop)
    };
  }

  function applyBubblePosition(pos) {
    const bubble = getBubbleEl();
    if (!bubble) return;

    bubble.style.left = '';
    bubble.style.top = '';
    bubble.style.right = `${pos.right}px`;
    bubble.style.bottom = `${pos.bottom}px`;
  }

  function bubbleRightBottomToLeftTop(pos, size) {
    return {
      left: window.innerWidth - size - pos.right,
      top: window.innerHeight - size - pos.bottom
    };
  }

  function leftTopToBubbleRightBottom(left, top, size) {
    return {
      right: Math.max(0, window.innerWidth - size - left),
      bottom: Math.max(0, window.innerHeight - size - top)
    };
  }

  function createBubble() {
    if (getBubbleEl()) return;

    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.dataset.tpdaBubble = '1';
    bubble.innerHTML = 'AI';
    const pos = getBubblePosition();

    bubble.style.right = `${pos.right}px`;
    bubble.style.bottom = `${pos.bottom}px`;
    bubble.style.zIndex = String(STATE.ui.zIndexBase);

    bubble.addEventListener('click', (e) => {
      if (bubble.dataset.dragged === '1') {
        bubble.dataset.dragged = '0';
        return;
      }
      e.preventDefault();
      expandPanelNearBubble();
    });

    document.body.appendChild(bubble);
    makeDraggableBubble(bubble);
  }

  function createPanel() {
    if (getPanelEl()) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.display = 'none';
    panel.style.zIndex = String(STATE.ui.zIndexBase);

    panel.innerHTML = `
      <div id="${HEADER_ID}" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#1c1d24;border-bottom:1px solid #333;flex:0 0 auto;">
        <div>
          <div style="font-weight:bold;">Torn AI Assistant</div>
          <div style="font-size:11px;color:#bbb;">Local-only advisor • no token extraction</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="tpda-ai-refresh" style="background:#2a6df4;color:white;border:none;border-radius:8px;padding:6px 10px;">Refresh</button>
          <button id="tpda-ai-collapse" style="background:#444;color:white;border:none;border-radius:8px;padding:6px 10px;">○</button>
        </div>
      </div>
      <div id="tpda-ai-body" style="padding:12px;overflow-y:auto;max-height:60vh;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('tpda-ai-refresh').addEventListener('click', renderPanel);
    document.getElementById('tpda-ai-collapse').addEventListener('click', collapseToBubble);

    makeDraggablePanel(panel, document.getElementById(HEADER_ID));
  }

  function expandPanelNearBubble() {
    STATE.ui.minimized = false;
    const bubble = getBubbleEl();
    const panel = getPanelEl();
    if (!bubble || !panel) return;

    bringToFront(panel);

    bubble.style.display = 'none';
    panel.style.display = 'flex';

    const saved = getPanelPosition();
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      const clamped = clampToViewport(saved.left, saved.top, panel.offsetWidth || 360, panel.offsetHeight || 420);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = '';
      panel.style.bottom = '';
    } else {
      const bRect = bubble.getBoundingClientRect();
      let left = bRect.left - 280;
      let top = bRect.top - 120;
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      const clamped = clampToViewport(left, top, panel.offsetWidth || 360, panel.offsetHeight || 420);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = '';
      panel.style.bottom = '';
      setPanelPosition(clamped);
    }

    renderPanel();
  }

  function collapseToBubble() {
    STATE.ui.minimized = true;
    const bubble = getBubbleEl();
    const panel = getPanelEl();
    if (!bubble || !panel) return;

    panel.style.display = 'none';
    bubble.style.display = 'flex';
    bringToFront(bubble);
  }

  function makeDraggableBubble(el) {
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let dragging = false;

    el.addEventListener('pointerdown', (e) => {
      dragging = false;
      el.dataset.dragged = '0';
      el.setPointerCapture?.(e.pointerId);
      bringToFront(el);

      const pos = getBubblePosition();
      const current = bubbleRightBottomToLeftTop(pos, STATE.ui.bubbleSize);
      startX = e.clientX;
      startY = e.clientY;
      originLeft = current.left;
      originTop = current.top;
    });

    el.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragging = true;

      if (!dragging) return;

      let nextLeft = originLeft + dx;
      let nextTop = originTop + dy;

      const clamped = clampToViewport(nextLeft, nextTop, STATE.ui.bubbleSize, STATE.ui.bubbleSize);
      el.style.left = `${clamped.left}px`;
      el.style.top = `${clamped.top}px`;
      el.style.right = '';
      el.style.bottom = '';
      el.dataset.dragged = '1';
    });

    function finishDrag() {
      if (startX === null) return;
      if (dragging) {
        const left = parseFloat(el.style.left || '0');
        const top = parseFloat(el.style.top || '0');
        const pos = leftTopToBubbleRightBottom(left, top, STATE.ui.bubbleSize);
        setBubblePosition(pos);
      }
      startX = null;
      startY = null;
    }

    el.addEventListener('pointerup', finishDrag);
    el.addEventListener('pointercancel', finishDrag);
  }

  function makeDraggablePanel(panel, handle) {
    let startX = null;
    let startY = null;
    let originLeft = 0;
    let originTop = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      handle.setPointerCapture?.(e.pointerId);
      bringToFront(panel);

      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      originLeft = rect.left;
      originTop = rect.top;
    });

    handle.addEventListener('pointermove', (e) => {
      if (startX === null) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let left = originLeft + dx;
      let top = originTop + dy;

      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(left, top, rect.width, rect.height);

      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = '';
      panel.style.bottom = '';
    });

    function finish() {
      if (startX === null) return;
      const rect = panel.getBoundingClientRect();
      setPanelPosition({ left: rect.left, top: rect.top });
      startX = null;
      startY = null;
    }

    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function renderHappyJumpCard(user) {
    const hj = evaluateHappyJump(user);
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Happy Jump Advisor</div>
        <div>Status: <strong>${escapeHtml(hj.label)}</strong> (score ${hj.score})</div>
        <div>Energy: ${escapeHtml(hj.energy)}</div>
        <div>Happy: ${escapeHtml(hj.happy)}</div>
        <div style="margin-top:6px;color:#ddd;">${escapeHtml(hj.recommendation)}</div>
        <div style="margin-top:8px;font-size:12px;color:#bbb;">
          ${hj.notes.map(n => `• ${escapeHtml(n)}`).join('<br>')}
        </div>
      </div>
    `;
  }

  function renderStockRoiCard(userStocks, tornStocks) {
    const rows = buildStockRoiRows(userStocks, tornStocks).slice(0, 5);

    if (!rows.length) {
      return `
        <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
          <div style="font-weight:bold;margin-bottom:6px;">Stock Block ROI Helper</div>
          <div>No stock holdings are cached yet. Open the stock market in Torn PDA once.</div>
        </div>
      `;
    }

    const body = rows.map(r => {
      const costText = r.toNextCost ? formatMoney(r.toNextCost) : 'unknown';
      const paybackText = Number.isFinite(r.paybackDays) ? `${Math.ceil(r.paybackDays)}d` : 'n/a';
      const dayText = r.payoutPerDay ? `${formatMoney(Math.round(r.payoutPerDay))}/day` : 'n/a';

      return `
        <div style="padding:8px 0;border-top:1px solid #2a2d38;">
          <div><strong>${escapeHtml(r.ticker)}</strong> • ${escapeHtml(r.type)} • ${escapeHtml(r.benefit)}</div>
          <div>Owned: ${formatNumber(r.owned)} / next block: ${formatNumber(r.nextTargetShares)}</div>
          <div>Missing: ${formatNumber(r.missingShares)} shares</div>
          <div>Est. next block cost: ${costText}</div>
          <div>Cash ROI: ${dayText} • payback ${paybackText}</div>
        </div>
      `;
    }).join('');

    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Stock Block ROI Helper</div>
        <div style="font-size:12px;color:#bbb;margin-bottom:6px;">
          ROI is rough. It only estimates cash-returning blocks directly and ignores future price movement.
        </div>
        ${body}
      </div>
    `;
  }

  function renderPanel() {
    const body = document.getElementById('tpda-ai-body');
    if (!body) return;

    const user = STATE.userData || {};
    const torn = STATE.tornData || {};
    const bars = user.bars || {};
    const cds = user.cooldowns || {};
    const battlestats = user.battlestats || {};
    const money = user.money || {};
    const userStocks = normalizeUserStocks(user.stocks);
    const tornStocks = normalizeTornStocks(torn.stocks);
    const advice = buildAdvice(userStocks, tornStocks, user);

    body.innerHTML = `
      <div style="margin-bottom:8px;color:#bbb;">
        User data seen: ${ageText(STATE.lastSeen.user)}<br>
        Market data seen: ${ageText(STATE.lastSeen.torn)}
      </div>

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Status</div>
        <div>Selections cached: ${getSelectionsPresent(user).join(', ') || 'none yet'}</div>
        <div>Energy: ${formatNumber(bars.energy?.current)} / ${formatNumber(bars.energy?.maximum)}</div>
        <div>Nerve: ${formatNumber(bars.nerve?.current)} / ${formatNumber(bars.nerve?.maximum)}</div>
        <div>Happy: ${formatNumber(bars.happy?.current)} / ${formatNumber(bars.happy?.maximum)}</div>
        <div>Drug CD: ${formatSeconds(cds.drug)}</div>
        <div>Booster CD: ${formatSeconds(cds.booster)}</div>
        <div>Medical CD: ${formatSeconds(cds.medical)}</div>
      </div>

      ${renderHappyJumpCard(user)}

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Battle stats</div>
        <div>STR: ${formatNumber(battlestats.strength)}</div>
        <div>SPD: ${formatNumber(battlestats.speed)}</div>
        <div>DEX: ${formatNumber(battlestats.dexterity)}</div>
        <div>DEF: ${formatNumber(battlestats.defense)}</div>
      </div>

      ${renderStockRoiCard(userStocks, tornStocks)}

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Funds seen</div>
        <div>Cash on hand: ${money.cash_on_hand != null ? formatMoney(money.cash_on_hand) : 'unknown'}</div>
        <div>Bank: ${money.money_bank != null ? formatMoney(money.money_bank) : 'unknown'}</div>
      </div>

      <div style="padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="font-weight:bold;margin-bottom:8px;">Advice</div>
        ${advice.map(x => `<div style="margin-bottom:8px;">• ${escapeHtml(x)}</div>`).join('')}
      </div>
    `;
  }

  function mergeUserData(data) {
    STATE.userData = deepMerge(STATE.userData, data);
    STATE.lastSeen.user = nowTs();
    if (!STATE.ui.minimized) renderPanel();
  }

  function mergeTornData(data) {
    STATE.tornData = deepMerge(STATE.tornData, data);
    STATE.lastSeen.torn = nowTs();
    if (!STATE.ui.minimized) renderPanel();
  }

  function handleApiPayload(url, data) {
    if (!data || data.error) return;
    if (typeof url !== 'string') return;

    if (url.includes('api.torn.com/user')) {
      mergeUserData(data);
    } else if (url.includes('api.torn.com/torn')) {
      mergeTornData(data);
    }
  }

  function hookFetch() {
    const originalFetch = window.fetch;
    if (!originalFetch) return;

    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const url = String(args[0] && args[0].url ? args[0].url : args[0] || '');
        if (url.includes('api.torn.com/')) {
          const clone = response.clone();
          const contentType = clone.headers.get('content-type') || '';
          if (contentType.includes('application/json') || contentType.includes('text/plain')) {
            const text = await clone.text();
            const data = safeJsonParse(text);
            handleApiPayload(url, data);
          }
        }
      } catch (_) {}
      return response;
    };
  }

  function hookXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__tpda_url = url;
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          const url = String(this.__tpda_url || '');
          if (!url.includes('api.torn.com/')) return;
          const text = this.responseText;
          const data = safeJsonParse(text);
          handleApiPayload(url, data);
        } catch (_) {}
      });

      return origSend.apply(this, args);
    };
  }

  function onResize() {
    const bubble = getBubbleEl();
    const panel = getPanelEl();

    if (bubble && bubble.style.display !== 'none') {
      const pos = getBubblePosition();
      const current = bubbleRightBottomToLeftTop(pos, STATE.ui.bubbleSize);
      const clamped = clampToViewport(current.left, current.top, STATE.ui.bubbleSize, STATE.ui.bubbleSize);
      const next = leftTopToBubbleRightBottom(clamped.left, clamped.top, STATE.ui.bubbleSize);
      setBubblePosition(next);
      applyBubblePosition(next);
    }

    if (panel && panel.style.display !== 'none') {
      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(rect.left, rect.top, rect.width, rect.height);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = '';
      panel.style.bottom = '';
      setPanelPosition(clamped);
    }
  }

  function init() {
    ensureStyles();
    hookFetch();
    hookXHR();
    createBubble();
    createPanel();
    window.addEventListener('resize', onResize);
    console.log('[Torn AI Assistant] Bubble mode started.');
  }

  setTimeout(init, 1200);
})();
