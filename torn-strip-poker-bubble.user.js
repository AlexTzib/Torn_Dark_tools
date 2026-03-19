// ==UserScript==
// @name         Torn PDA - Strip Poker Advisor
// @namespace    alex.torn.pda.strippoker.bubble
// @version      1.1.0
// @description  Compact poker hand advisor for Torn Strip Poker. Tap-to-pick cards, evaluates hand strength via Monte Carlo simulation, and suggests optimal play. Tiny bubble won't block the pocket screen.
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
    myCards: [],
    cardSource: null, /* 'xhr', 'scan', 'manual' — tracks how cards were set */
    pickingRank: null,
    handEval: null,
    winProb: null,
    suggestion: null,
    oppRange: null,
    showRange: false,
    ui: { minimized: true, zIndexBase: 999960 },
    _logs: []
  };

    /* ===================================================================
   *  TPDA Common Code — shared across all Torn Dark Tools scripts
   *  This file is injected by build.py at the // #COMMON_CODE marker.
   *  It assumes these are already defined in scope:
   *    SCRIPT_KEY, BUBBLE_ID, PANEL_ID, HEADER_ID, BUBBLE_SIZE, STATE
   * =================================================================== */

  /* ── Shared API key storage ────────────────────────────────── */
  const SHARED_API_KEY_STORAGE = 'tpda_shared_api_key';

  /* ── Utility functions ─────────────────────────────────────── */

  function nowTs() { return Date.now(); }
  function nowUnix() { return Math.floor(Date.now() / 1000); }

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function formatNumber(n) { return Number(n ?? 0).toLocaleString(); }

  function formatMoney(n) {
    const v = Number(n || 0);
    if (!v) return '\u2014';
    return '$' + Math.round(v).toLocaleString();
  }

  function formatSeconds(sec) {
    sec = Math.floor(Number(sec || 0));
    if (sec <= 0) return 'now';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  function ageText(ts) {
    if (!ts) return 'never';
    return `${formatSeconds(Math.floor((Date.now() - ts) / 1000))} ago`;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /* ── Storage helpers ───────────────────────────────────────── */

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

  /* ── Debug log ─────────────────────────────────────────────── */

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString();
    STATE._logs.push(`[${ts}] ${msg}`);
    if (STATE._logs.length > 200) STATE._logs.shift();
  }

  /* ── Shared API key management ─────────────────────────────── */

  function getSharedApiKey() {
    return getStorage(SHARED_API_KEY_STORAGE, '');
  }

  function setSharedApiKey(key) {
    setStorage(SHARED_API_KEY_STORAGE, key || '');
  }

  function migrateApiKeyToShared() {
    /* If shared key already exists, nothing to do */
    if (getSharedApiKey()) return;
    /* Try to migrate from per-script key */
    const legacy = getStorage(`${SCRIPT_KEY}_api_key`, '') || getStorage(`${SCRIPT_KEY}_apikey`, '');
    if (legacy) {
      setSharedApiKey(legacy);
      addLog('Migrated API key to shared storage');
    }
  }

  function extractApiKeyFromUrl(url) {
    if (STATE.apiKeySource === 'manual' || STATE.apiKeySource === 'pda') return;
    try {
      const u = new URL(url, location.origin);
      const key = u.searchParams.get('key');
      if (key && key.length >= 16) {
        STATE.apiKey = key;
        STATE.apiKeySource = 'intercepted';
        addLog('API key captured from network traffic');
      }
    } catch {}
  }

  /* ── API key UI (collapsed by default) ─────────────────────── */

  function renderApiKeyCard() {
    const keyDisplay = STATE.apiKey
      ? `Active (${escapeHtml(STATE.apiKeySource || 'unknown')})`
      : 'Not available';
    const sourceHint = STATE.apiKeySource === 'pda'
      ? 'Using Torn PDA key automatically. Manual entry below is optional (overrides PDA key).'
      : 'In Torn PDA the key is loaded automatically. Outside PDA, paste your key below.';
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div class="tpda-apikey-toggle" style="font-weight:bold;cursor:pointer;user-select:none;">
          \u25B6 API Key: ${keyDisplay}
        </div>
        <div class="tpda-apikey-body" style="display:none;margin-top:8px;">
          <div style="font-size:11px;color:#bbb;margin-bottom:6px;">${sourceHint}</div>
          <div style="display:flex;gap:8px;">
            <input class="tpda-apikey-input" type="password" value="${escapeHtml(getSharedApiKey())}" placeholder="Your Torn API key"
                   style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:8px;padding:8px;" />
            <button class="tpda-apikey-save" style="background:#444;color:white;border:none;border-radius:8px;padding:8px 10px;">Save</button>
          </div>
        </div>
      </div>
    `;
  }

  function handleApiKeyClick(e, container, onSave) {
    /* Toggle collapsed/expanded */
    const toggle = e.target.closest('.tpda-apikey-toggle');
    if (toggle) {
      const body = container.querySelector('.tpda-apikey-body');
      if (body) {
        const show = body.style.display === 'none';
        body.style.display = show ? 'block' : 'none';
        toggle.textContent = (show ? '\u25BC' : '\u25B6') + toggle.textContent.slice(1);
      }
      return true;
    }
    /* Save button */
    const save = e.target.closest('.tpda-apikey-save');
    if (save) {
      const input = container.querySelector('.tpda-apikey-input');
      const val = String(input?.value || '').trim();
      setSharedApiKey(val);
      if (val) {
        STATE.apiKey = val;
        STATE.apiKeySource = 'manual';
      } else {
        STATE.apiKeySource = '';
      }
      addLog('API key saved (shared)');
      if (onSave) onSave();
      return true;
    }
    return false;
  }

  /* ── Debug log UI ──────────────────────────────────────────── */

  function renderLogCard() {
    return `
      <div style="margin-top:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#0f1116;">
        <div class="tpda-log-toggle" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
          <div style="font-weight:bold;font-size:12px;">Debug Log (${STATE._logs.length})</div>
          <button class="tpda-log-copy" style="background:#333;color:#bbb;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">Copy Log</button>
        </div>
        <div class="tpda-log-body" style="display:none;margin-top:8px;max-height:200px;overflow-y:auto;font-size:11px;color:#aaa;font-family:monospace;white-space:pre-wrap;word-break:break-all;">${STATE._logs.map(l => escapeHtml(l)).join('\n')}</div>
      </div>
    `;
  }

  function handleLogClick(e, container) {
    const toggle = e.target.closest('.tpda-log-toggle');
    if (toggle && !e.target.closest('.tpda-log-copy')) {
      const body = container.querySelector('.tpda-log-body');
      if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
      return true;
    }
    const copyBtn = e.target.closest('.tpda-log-copy');
    if (copyBtn) {
      const text = STATE._logs.join('\n');
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Log'; }, 1200);
      }).catch(() => {});
      return true;
    }
    return false;
  }

  /* ── UI core ───────────────────────────────────────────────── */

  function getBubbleEl() { return document.getElementById(BUBBLE_ID); }
  function getPanelEl() { return document.getElementById(PANEL_ID); }

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

  function getDefaultBubblePosition() {
    const existing = document.querySelectorAll('[data-tpda-bubble="1"]').length;
    return { right: 12, bottom: 12 + existing * (BUBBLE_SIZE + 12) };
  }

  function getBubblePosition() { return getStorage(`${SCRIPT_KEY}_bubble_pos`, getDefaultBubblePosition()); }
  function setBubblePosition(pos) { setStorage(`${SCRIPT_KEY}_bubble_pos`, pos); }
  function getPanelPosition() { return getStorage(`${SCRIPT_KEY}_panel_pos`, null); }
  function setPanelPosition(pos) { setStorage(`${SCRIPT_KEY}_panel_pos`, pos); }

  function copyToClipboard(text, buttonEl) {
    navigator.clipboard.writeText(text).then(() => {
      if (buttonEl) {
        const orig = buttonEl.textContent;
        buttonEl.textContent = 'Copied!';
        setTimeout(() => { buttonEl.textContent = orig; }, 1200);
      }
    }).catch(() => {});
  }

  /* ── Draggable bubble ──────────────────────────────────────── */

  function makeDraggableBubble(el) {
    let startX = null, startY = null, originLeft = 0, originTop = 0, dragging = false;

    el.addEventListener('pointerdown', (e) => {
      dragging = false;
      el.dataset.dragged = '0';
      el.setPointerCapture?.(e.pointerId);
      bringToFront(el);
      const pos = getBubblePosition();
      const current = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
      startX = e.clientX; startY = e.clientY;
      originLeft = current.left; originTop = current.top;
    });

    el.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragging = true;
      if (!dragging) return;
      const clamped = clampToViewport(originLeft + dx, originTop + dy, BUBBLE_SIZE, BUBBLE_SIZE);
      el.style.left = `${clamped.left}px`;
      el.style.top = `${clamped.top}px`;
      el.style.right = ''; el.style.bottom = '';
      el.dataset.dragged = '1';
    });

    function finishDrag() {
      if (startX === null) return;
      if (dragging) {
        const left = parseFloat(el.style.left || '0'), top = parseFloat(el.style.top || '0');
        setBubblePosition(leftTopToBubbleRightBottom(left, top, BUBBLE_SIZE));
      }
      startX = null; startY = null;
    }
    el.addEventListener('pointerup', finishDrag);
    el.addEventListener('pointercancel', finishDrag);
  }

  /* ── Draggable panel ───────────────────────────────────────── */

  function makeDraggablePanel(panel, handle) {
    let startX = null, startY = null, originLeft = 0, originTop = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      handle.setPointerCapture?.(e.pointerId);
      bringToFront(panel);
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      originLeft = rect.left; originTop = rect.top;
    });

    handle.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(originLeft + dx, originTop + dy, rect.width, rect.height);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = ''; panel.style.bottom = '';
    });

    function finish() {
      if (startX === null) return;
      const rect = panel.getBoundingClientRect();
      setPanelPosition({ left: rect.left, top: rect.top });
      startX = null; startY = null;
    }
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  /* ── Expand / collapse / resize ────────────────────────────── */

  function expandPanelNearBubble() {
    STATE.ui.minimized = false;
    const bubble = getBubbleEl(), panel = getPanelEl();
    if (!bubble || !panel) return;

    bringToFront(panel);
    bubble.style.display = 'none';
    panel.style.display = 'flex';

    const pw = panel.offsetWidth || 400, ph = panel.offsetHeight || 500;
    const saved = getPanelPosition();
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      const clamped = clampToViewport(saved.left, saved.top, pw, ph);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = ''; panel.style.bottom = '';
    } else {
      const bRect = bubble.getBoundingClientRect();
      let left = bRect.left - pw + 60, top = bRect.top - 120;
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      const clamped = clampToViewport(left, top, pw, ph);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = ''; panel.style.bottom = '';
      setPanelPosition(clamped);
    }

    /* Script-specific hook — called after positioning */
    if (typeof onPanelExpand === 'function') onPanelExpand();
  }

  function collapseToBubble() {
    /* Script-specific hook — called before hiding */
    if (typeof onPanelCollapse === 'function') onPanelCollapse();
    STATE.ui.minimized = true;
    const bubble = getBubbleEl(), panel = getPanelEl();
    if (!bubble || !panel) return;
    panel.style.display = 'none';
    bubble.style.display = 'flex';
    bringToFront(bubble);
  }

  function onResize() {
    const bubble = getBubbleEl(), panel = getPanelEl();

    if (bubble && bubble.style.display !== 'none') {
      const pos = getBubblePosition();
      const current = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
      const clamped = clampToViewport(current.left, current.top, BUBBLE_SIZE, BUBBLE_SIZE);
      const next = leftTopToBubbleRightBottom(clamped.left, clamped.top, BUBBLE_SIZE);
      setBubblePosition(next);
      bubble.style.left = ''; bubble.style.top = '';
      bubble.style.right = `${next.right}px`;
      bubble.style.bottom = `${next.bottom}px`;
    }

    if (panel && panel.style.display !== 'none') {
      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(rect.left, rect.top, rect.width, rect.height);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = ''; panel.style.bottom = '';
      setPanelPosition({ left: clamped.left, top: clamped.top });
    }
  }

  /* ── Network interception hooks ──────────────────────────────
   *  Captures API keys from fetch/XHR calls to api.torn.com.
   *  Safe to call multiple times — each script wraps only once. */

  function hookFetch() {
    const originalFetch = window.fetch;
    if (!originalFetch) return;

    window.fetch = async function (...args) {
      try {
        const url = String(args[0] && args[0].url ? args[0].url : args[0] || '');
        if (url.includes('api.torn.com/')) {
          extractApiKeyFromUrl(url);
        }
      } catch {}

      return originalFetch.apply(this, args);
    };
  }

  function hookXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__tpda_url = url;
      try {
        const u = String(url || '');
        if (u.includes('api.torn.com/')) {
          extractApiKeyFromUrl(u);
        }
      } catch {}
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      return origSend.apply(this, args);
    };
  }

  /* ── Stat estimation (TornPDA algorithm) ───────────────────── */

  const RANK_SCORES = {
    'Absolute beginner': 1, 'Beginner': 2, 'Inexperienced': 3, 'Rookie': 4,
    'Novice': 5, 'Below average': 6, 'Average': 7, 'Reasonable': 8,
    'Above average': 9, 'Competent': 10, 'Highly competent': 11, 'Veteran': 12,
    'Distinguished': 13, 'Highly distinguished': 14, 'Professional': 15,
    'Star': 16, 'Master': 17, 'Outstanding': 18, 'Celebrity': 19,
    'Supreme': 20, 'Idolized': 21, 'Champion': 22, 'Heroic': 23,
    'Legendary': 24, 'Elite': 25, 'Invincible': 26
  };
  const LEVEL_TRIGGERS   = [2, 6, 11, 26, 31, 50, 71, 100];
  const CRIMES_TRIGGERS  = [100, 5000, 10000, 20000, 30000, 50000];
  const NW_TRIGGERS      = [5e6, 5e7, 5e8, 5e9, 5e10];
  const STAT_RANGES      = ['< 2k', '2k - 25k', '20k - 250k', '200k - 2.5M', '2M - 25M', '20M - 250M', '> 200M'];
  const STAT_COLORS      = ['#8dff8d', '#8dff8d', '#bfe89c', '#ffd166', '#ffa94d', '#ff6b6b', '#ff4040'];
  /* Rough midpoint of each range (used for percentage-based target matching) */
  const STAT_MIDPOINTS   = [1000, 13500, 135000, 1350000, 13500000, 135000000, 300000000];

  const PROFILE_CACHE_KEY = 'tpda_shared_profile_cache';
  const PROFILE_CACHE_TTL = 30 * 60 * 1000; // 30 min
  const SCAN_API_GAP_MS   = 650; // ~92 calls/min, under 100 limit

  function estimateStats(rank, level, crimesTotal, networth) {
    const rs = RANK_SCORES[rank];
    if (!rs) return null;
    const ls = LEVEL_TRIGGERS.filter(t => t <= (level || 0)).length;
    const cs = CRIMES_TRIGGERS.filter(t => t <= (crimesTotal || 0)).length;
    const ns = NW_TRIGGERS.filter(t => t <= (networth || 0)).length;
    const idx = Math.max(0, Math.min(STAT_RANGES.length - 1, rs - ls - cs - ns - 1));
    return { label: STAT_RANGES[idx], color: STAT_COLORS[idx], idx };
  }

  /* ── Profile cache ─────────────────────────────────────────── */

  function loadProfileCache() {
    const raw = getStorage(PROFILE_CACHE_KEY, {});
    const now = nowTs();
    const pruned = {};
    for (const [id, p] of Object.entries(raw)) {
      if (p && (now - (p.fetchedAt || 0)) < PROFILE_CACHE_TTL) pruned[id] = p;
    }
    return pruned;
  }

  function saveProfileCache() {
    setStorage(PROFILE_CACHE_KEY, STATE.profileCache);
  }

  async function fetchMemberProfile(memberId) {
    const cached = STATE.profileCache[memberId];
    if (cached && (nowTs() - cached.fetchedAt) < PROFILE_CACHE_TTL) return cached;
    if (!STATE.apiKey) return null;

    try {
      const url = `https://api.torn.com/user/${encodeURIComponent(memberId)}?selections=profile,personalstats,criminalrecord&key=${encodeURIComponent(STATE.apiKey)}`;
      const res = await fetch(url, { method: 'GET' });
      const data = await res.json();
      if (data?.error) {
        addLog(`Profile ${memberId}: API error ${data.error.code || ''}`);
        return null;
      }

      const crimesTotal = (() => {
        const cr = data.criminalrecord;
        if (!cr || typeof cr !== 'object') return 0;
        let sum = 0;
        for (const v of Object.values(cr)) sum += Number(v) || 0;
        return sum;
      })();

      const profile = {
        rank: data.rank || '',
        level: data.level || 0,
        crimesTotal,
        networth: data.personalstats?.networth || 0,
        fetchedAt: nowTs()
      };
      profile.estimate = estimateStats(profile.rank, profile.level, profile.crimesTotal, profile.networth);
      STATE.profileCache[memberId] = profile;
      return profile;
    } catch (err) {
      addLog(`Profile ${memberId}: ${err.message || err}`);
      return null;
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ── Member data processing ────────────────────────────────── */

  function normalizeMembers(data) {
    const members = data?.members || data?.basic?.members || {};
    if (Array.isArray(members)) return members;
    if (typeof members === 'object' && members) {
      return Object.entries(members).map(([id, value]) => ({
        id,
        ...value
      }));
    }
    return [];
  }

  function parseRelativeMinutes(relative) {
    const s = String(relative || '').trim().toLowerCase();
    if (!s) return Number.POSITIVE_INFINITY;
    if (s === 'online' || s === 'just now') return 0;

    const m = s.match(/(\d+)\s*(minute|min|minutes)/);
    if (m) return Number(m[1]);

    const h = s.match(/(\d+)\s*(hour|hours|hr|hrs)/);
    if (h) return Number(h[1]) * 60;

    const d = s.match(/(\d+)\s*(day|days)/);
    if (d) return Number(d[1]) * 1440;

    const sec = s.match(/(\d+)\s*(second|seconds|sec|secs)/);
    if (sec) return 0;

    return Number.POSITIVE_INFINITY;
  }

  function memberLastActionInfo(member) {
    const la = member?.last_action || {};
    const status = String(la.status || member?.status || '').toLowerCase();
    const relative = String(la.relative || member?.last_action?.relative || '').trim();
    const timestamp = Number(la.timestamp || 0);

    let minutes = Number.POSITIVE_INFINITY;
    if (timestamp > 0) {
      minutes = Math.max(0, Math.floor((Date.now() / 1000 - timestamp) / 60));
    } else {
      minutes = parseRelativeMinutes(relative);
    }

    const isOnline =
      status === 'online' ||
      String(relative).toLowerCase() === 'online';

    return {
      isOnline,
      minutes,
      relative: relative || (isOnline ? 'Online' : 'Unknown'),
      lastActionStatus: status || ''
    };
  }

  function normalizeText(...parts) {
    return parts
      .filter(Boolean)
      .map(v => String(v).toLowerCase().trim())
      .join(' | ');
  }

  function inferLocationState(member) {
    const statusObj = member?.status;
    const statusState = (typeof statusObj === 'string') ? statusObj : statusObj?.state;
    const statusDesc = statusObj?.description;
    const statusDetail = statusObj?.details || statusObj?.detail;

    const combined = normalizeText(
      statusState,
      statusDesc,
      statusDetail,
      member?.state,
      member?.description,
      member?.details,
      member?.status_description,
      member?.status_detail,
      member?.current_status,
      member?.last_action?.status,
      member?.last_action?.relative,
      member?.life?.status,
      member?.travel?.status
    );

    if (/hospital/.test(combined)) {
      return { bucket: 'hospital', label: 'Hospital' };
    }

    if (/\bfederal\b/.test(combined)) {
      return { bucket: 'jail', label: 'Federal Jail' };
    }

    if (/\bjail\b/.test(combined)) {
      return { bucket: 'jail', label: 'Jail' };
    }

    if (/traveling|travelling|in flight|flying|returning/.test(combined)) {
      const desc = String(statusDesc || '').trim();
      let label = 'In flight';
      if (/traveling to|travelling to/i.test(desc)) label = desc;
      else if (/returning/i.test(desc)) label = desc;
      else if (member?.travel?.destination) label = 'Flying to ' + member.travel.destination;
      return { bucket: 'traveling', label };
    }

    if (/abroad|mexico|canada|argentina|hawaii|cayman|switzerland|japan|china|uae|united arab emirates|south africa|uk|united kingdom/.test(combined)) {
      const desc = String(statusDesc || '').trim();
      let label = 'Abroad';
      if (/^in\s/i.test(desc)) label = desc;
      else if (member?.travel?.destination) label = 'In ' + member.travel.destination;
      return { bucket: 'abroad', label };
    }

    if (/\bokay\b|\bin torn\b/.test(combined)) {
      return { bucket: 'torn', label: 'In Torn' };
    }

    if (statusObj?.color === 'green') {
      return { bucket: 'torn', label: 'In Torn' };
    }

    if (String(member?.last_action?.status || '').toLowerCase() === 'online') {
      return { bucket: 'torn', label: 'In Torn (online)' };
    }

    if (!combined) {
      return { bucket: 'unknown', label: 'Unknown location' };
    }

    return { bucket: 'unknown', label: combined.substring(0, 40) };
  }

  function parseRemainingFromText(text) {
    const s = String(text || '').toLowerCase();
    if (!s) return null;

    let total = 0;
    let matched = false;

    const d = s.match(/(\d+)\s*d/);
    const h = s.match(/(\d+)\s*h/);
    const m = s.match(/(\d+)\s*m/);
    const sec = s.match(/(\d+)\s*s/);

    if (d) { total += Number(d[1]) * 86400; matched = true; }
    if (h) { total += Number(h[1]) * 3600; matched = true; }
    if (m) { total += Number(m[1]) * 60; matched = true; }
    if (sec) { total += Number(sec[1]); matched = true; }

    if (matched) return total;

    const minOnly = s.match(/(\d+)\s*(minute|min|minutes)/);
    if (minOnly) return Number(minOnly[1]) * 60;

    const hourOnly = s.match(/(\d+)\s*(hour|hours|hr|hrs)/);
    if (hourOnly) return Number(hourOnly[1]) * 3600;

    return null;
  }

  function extractTimerInfo(member, locationBucket) {
    const statusObj = (member?.status && typeof member.status === 'object') ? member.status : null;

    const candidates = [
      statusObj?.description,
      statusObj?.details,
      member?.status_detail,
      member?.status_description,
      member?.description,
      member?.details,
      (typeof member?.status === 'string') ? member.status : null,
      member?.travel?.time_left,
      member?.travel?.remaining,
      member?.travel?.description,
      member?.hospital_time,
      member?.jail_time,
      member?.last_action?.relative
    ];

    const unixCandidates = [
      statusObj?.until,
      member?.status_until,
      member?.until,
      member?.until_timestamp,
      member?.travel?.timestamp,
      member?.travel?.until,
      member?.hospital_timestamp,
      member?.jail_timestamp
    ];

    for (const raw of unixCandidates) {
      const v = Number(raw || 0);
      if (v > 1000000000) {
        const remaining = Math.max(0, v - nowUnix());
        return {
          remainingSec: remaining,
          source: 'timestamp'
        };
      }
    }

    for (const raw of candidates) {
      if (raw == null) continue;
      if (typeof raw === 'number' && raw > 0) {
        return {
          remainingSec: Number(raw),
          source: 'numeric'
        };
      }
      const parsed = parseRemainingFromText(String(raw));
      if (parsed != null) {
        return {
          remainingSec: parsed,
          source: 'text'
        };
      }
    }

    if (locationBucket === 'torn' || locationBucket === 'unknown') {
      return {
        remainingSec: null,
        source: 'none'
      };
    }

    return {
      remainingSec: null,
      source: 'none'
    };
  }

  /* ── Faction data fetching ─────────────────────────────────── */

  async function fetchOwnFactionWars() {
    if (!STATE.apiKey) return null;
    try {
      const url = `https://api.torn.com/faction/?selections=basic&key=${encodeURIComponent(STATE.apiKey)}`;
      addLog('Fetching own faction data for war detection...');
      const res = await fetch(url, { method: 'GET' });
      const data = await res.json();
      if (data?.error) {
        addLog('Own faction API error: ' + (data.error.error || JSON.stringify(data.error)));
        return null;
      }
      const ownFactionId = String(data?.ID || data?.id || '');
      if (!ownFactionId) {
        addLog('Could not determine own faction ID from API response');
        return null;
      }
      addLog('Own faction: ' + (data?.name || ownFactionId));

      const now = Math.floor(Date.now() / 1000);
      const candidates = [];

      const rankedWars = data?.ranked_wars || data?.rankedwars || {};
      for (const [warId, war] of Object.entries(rankedWars)) {
        const start = Number(war?.war?.start || war?.start || 0);
        const end = Number(war?.war?.end || war?.end || 0);
        if (start <= 0) continue;
        if (end > 0 && end < now) continue;

        const factions = war?.factions || {};
        for (const fid of Object.keys(factions)) {
          if (String(fid) !== ownFactionId) {
            candidates.push({
              type: 'Ranked War',
              enemyId: String(fid),
              enemyName: factions[fid]?.name || '',
              start,
              startsIn: Math.max(0, start - now),
              warId
            });
          }
        }
      }

      const territoryWars = data?.territory_wars || data?.territory || {};
      for (const [warId, war] of Object.entries(territoryWars)) {
        const start = Number(war?.start || war?.time_started || 0);
        const end = Number(war?.end || war?.time_ended || 0);
        if (start <= 0) continue;
        if (end > 0 && end < now) continue;

        const factions = war?.factions || {};
        for (const fid of Object.keys(factions)) {
          if (String(fid) !== ownFactionId) {
            candidates.push({
              type: 'Territory War',
              enemyId: String(fid),
              enemyName: factions[fid]?.name || '',
              start,
              startsIn: Math.max(0, start - now),
              warId
            });
          }
        }
      }

      const raidWars = data?.raid_wars || data?.raids || {};
      for (const [warId, war] of Object.entries(raidWars)) {
        const start = Number(war?.start || war?.time_started || 0);
        const end = Number(war?.end || war?.time_ended || 0);
        if (start <= 0) continue;
        if (end > 0 && end < now) continue;

        const factions = war?.factions || {};
        for (const fid of Object.keys(factions)) {
          if (String(fid) !== ownFactionId) {
            candidates.push({
              type: 'Raid War',
              enemyId: String(fid),
              enemyName: factions[fid]?.name || '',
              start,
              startsIn: Math.max(0, start - now),
              warId
            });
          }
        }
      }

      if (!candidates.length) {
        addLog('No active or upcoming wars found in own faction data');
        return null;
      }

      candidates.sort((a, b) => a.startsIn - b.startsIn);
      const best = candidates[0];
      addLog(`War detected: ${best.type} vs ${best.enemyName || best.enemyId} (${best.startsIn === 0 ? 'in progress' : 'starts in ' + formatSeconds(best.startsIn)})`);
      return best;
    } catch (err) {
      addLog('Error fetching own faction wars: ' + (err?.message || err));
      return null;
    }
  }

  /* ── Common API key initialization ─────────────────────────── */

  function initApiKey(pdaInjectedKey) {
    migrateApiKeyToShared();
    /* Priority 1: PDA-injected key */
    if (pdaInjectedKey && pdaInjectedKey.length >= 16 && !pdaInjectedKey.includes('#')) {
      STATE.apiKey = pdaInjectedKey;
      STATE.apiKeySource = 'pda';
      addLog('API key loaded from Torn PDA');
      return;
    }
    /* Priority 2: shared manual key */
    const saved = getSharedApiKey();
    if (saved) {
      STATE.apiKey = saved;
      STATE.apiKeySource = 'manual';
      addLog('API key loaded from shared storage');
      return;
    }
    /* Priority 3: will be filled by network interception */
    addLog('No API key yet \u2014 waiting for PDA injection or manual entry');
  }



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
    const cards = [];

    function extractCards(info) {
      if (!info) return;
      if (Array.isArray(info)) {
        info.forEach(c => {
          const parsed = parseClassCode(c.classCode || c.class_code);
          if (parsed) cards.push(parsed);
        });
      } else if (info.classCode || info.class_code) {
        const parsed = parseClassCode(info.classCode || info.class_code);
        if (parsed) cards.push(parsed);
      }
    }

    /* Torn casino patterns: data.player.hand, data.currentGame[].playerCardInfo, data.yourCards, etc. */
    if (data.player?.hand) extractCards(data.player.hand);
    if (data.yourCards) extractCards(data.yourCards);
    if (data.yourHand) extractCards(data.yourHand);
    if (data.hand) extractCards(data.hand);
    if (Array.isArray(data.currentGame)) {
      data.currentGame.forEach(g => {
        if (g.playerCardInfo) extractCards([g.playerCardInfo]);
      });
    }
    /* Fallback: scan all arrays for classCode objects */
    if (cards.length === 0) {
      const scan = (obj, depth) => {
        if (depth > 3 || !obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          for (const item of obj) {
            if (item && (item.classCode || item.class_code)) {
              const p = parseClassCode(item.classCode || item.class_code);
              if (p) cards.push(p);
            } else {
              scan(item, depth + 1);
            }
          }
        } else {
          for (const v of Object.values(obj)) scan(v, depth + 1);
        }
      };
      scan(data, 0);
    }

    if (cards.length >= 1 && cards.length <= 10) {
      /* Take at most 5 unique cards (player hand) */
      const seen = new Set();
      const unique = [];
      for (const c of cards) {
        const k = cardKey(c);
        if (!seen.has(k)) { seen.add(k); unique.push(c); }
        if (unique.length >= 5) break;
      }
      STATE.myCards = unique;
      STATE.cardSource = 'xhr';
      STATE.pickingRank = null;
      if (unique.length === 5) runEval();
      else { STATE.handEval = null; STATE.winProb = null; STATE.suggestion = suggest(null); STATE.oppRange = null; }
      addLog(`Auto-detected ${unique.length} card(s) from game data`);
      renderPanel();
    }
  }

  function isPokerUrl(url) {
    return /sid=.*poker/i.test(url) || /poker.*Data/i.test(url) ||
           /stripPoker/i.test(url) || /step=.*poker/i.test(url) ||
           /action=.*poker/i.test(url);
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

  /* ── Monte Carlo win probability ───────────────────────────── */
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

  function calcWinProb(myCards) {
    const myEval = evaluate5(myCards);
    if (!myEval) return null;
    const deck = buildDeck(myCards);
    let wins = 0, ties = 0;
    for (let i = 0; i < MC_ITERATIONS; i++) {
      const opp = shuffleDraw(deck, 5);
      const oppEval = evaluate5(opp);
      if (!oppEval) continue;
      if (myEval.score > oppEval.score) wins++;
      else if (myEval.score === oppEval.score) ties++;
    }
    return {
      win:  wins / MC_ITERATIONS,
      tie:  ties / MC_ITERATIONS,
      lose: 1 - (wins + ties) / MC_ITERATIONS
    };
  }

  /* ── opponent range analysis ───────────────────────────────── */
  function calcOppRange(myCards) {
    const myEval = evaluate5(myCards);
    if (!myEval) return null;
    const deck = buildDeck(myCards);
    const range = {};
    for (const n of HAND_NAMES) range[n] = { total: 0, beats: 0 };
    const samples = 3000;
    for (let i = 0; i < samples; i++) {
      const opp = shuffleDraw(deck, 5);
      const ev = evaluate5(opp);
      if (!ev) continue;
      range[ev.name].total++;
      if (ev.score > myEval.score) range[ev.name].beats++;
    }
    return range;
  }

  /* ── action suggestion ─────────────────────────────────────── */
  function suggest(prob) {
    if (!prob) return { act: '?', color: '#888', desc: 'Enter 5 cards to evaluate' };
    const wp = prob.win + prob.tie * 0.5;
    if (wp >= 0.72) return { act: 'RAISE',   color: '#4caf50', desc: 'Strong hand \u2014 raise confidently' };
    if (wp >= 0.55) return { act: 'CALL',    color: '#8bc34a', desc: 'Good hand \u2014 play it' };
    if (wp >= 0.42) return { act: 'CALL',    color: '#ffc107', desc: 'Marginal \u2014 call if bet is small' };
    if (wp >= 0.30) return { act: 'CAUTION', color: '#ff9800', desc: 'Weak \u2014 consider folding' };
    return                  { act: 'FOLD',    color: '#f44336', desc: 'Very weak \u2014 fold' };
  }

  /* ── run full evaluation ───────────────────────────────────── */
  function runEval() {
    if (STATE.myCards.length < 5) {
      STATE.handEval = null;
      STATE.winProb  = null;
      STATE.suggestion = suggest(null);
      STATE.oppRange = null;
      return;
    }
    STATE.handEval   = evaluate5(STATE.myCards);
    STATE.winProb    = calcWinProb(STATE.myCards);
    STATE.suggestion = suggest(STATE.winProb);
    STATE.oppRange   = calcOppRange(STATE.myCards);
    addLog(`Hand: ${STATE.handEval?.name} | Win: ${Math.round(STATE.winProb.win * 100)}% | ${STATE.suggestion.act}`);
  }

  /* ── card add / remove / clear ─────────────────────────────── */
  function addCard(rank, suit) {
    if (STATE.myCards.length >= 5) return;
    if (STATE.myCards.some(c => cardKey(c) === rank + suit)) return;
    STATE.myCards.push({ rank, suit, value: RANK_VAL[rank] });
    STATE.cardSource = 'manual';
    STATE.pickingRank = null;
    if (STATE.myCards.length === 5) runEval();
    renderPanel();
  }

  function removeCard(idx) {
    STATE.myCards.splice(idx, 1);
    STATE.handEval = null;
    STATE.winProb  = null;
    STATE.suggestion = suggest(null);
    STATE.oppRange = null;
    renderPanel();
  }

  function clearCards() {
    STATE.myCards = [];
    STATE.cardSource = null;
    STATE.pickingRank = null;
    STATE.handEval = null;
    STATE.winProb  = null;
    STATE.suggestion = suggest(null);
    STATE.oppRange = null;
    renderPanel();
  }

  /* ── DOM scanning (best-effort) ────────────────────────────── */
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

    document.querySelectorAll('img').forEach(img => {
      const src = (img.src || '') + ' ' + (img.alt || '');
      if (src.includes('back') || src.includes('blank')) return;
      const m = src.match(/([2-9]|10|[jJqQkKaA])[\s_-]?(?:of[\s_-]?)?([cCdDhHsS])/);
      if (m) tryAdd(m[1], m[2]);
      const m2 = src.match(/([cdhs])[\s_-]?([2-9]|10|[jqka])/i);
      if (m2) tryAdd(m2[2], m2[1]);
    });

    document.querySelectorAll('[data-card],[data-rank]').forEach(el => {
      if (el.dataset.card) {
        const m = el.dataset.card.match(/^(10|[2-9]|[JQKA])([cdhs])$/i);
        if (m) tryAdd(m[1], m[2]);
      }
      if (el.dataset.rank && el.dataset.suit) tryAdd(el.dataset.rank, el.dataset.suit);
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

    if (cards.length > 0 && cards.length <= 5) {
      /* Don't overwrite XHR-detected hand with fewer DOM-scanned cards */
      if (STATE.cardSource === 'xhr' && STATE.myCards.length >= cards.length) {
        addLog(`Scan: ${cards.length} card(s) found but XHR data preferred`);
        return;
      }
      STATE.myCards = cards.slice(0, 5);
      STATE.cardSource = 'scan';
      STATE.pickingRank = null;
      if (STATE.myCards.length === 5) runEval();
      addLog(`Scanned ${cards.length} card(s) from page`);
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

    /* ─ selected cards ─ */
    h += `<div style="margin-bottom:6px;">`;
    h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">`;
    const srcLabel = STATE.cardSource === 'xhr' ? ' (auto)' : STATE.cardSource === 'scan' ? ' (scanned)' : '';
    h += `<span style="font-weight:bold;font-size:11px;">Your Hand (${STATE.myCards.length}/5)${srcLabel}</span>`;
    if (STATE.myCards.length > 0) {
      h += `<span id="tpda-pk-clear" style="color:#f44;cursor:pointer;font-size:11px;">Clear</span>`;
    }
    h += `</div>`;

    if (STATE.myCards.length > 0) {
      h += `<div style="display:flex;gap:3px;flex-wrap:wrap;">`;
      STATE.myCards.forEach((c, i) => {
        h += `<span class="tpda-pk-card" data-idx="${i}" title="Tap to remove">${cardHtml(c)}</span>`;
      });
      h += `</div>`;
    } else {
      h += `<div style="color:#666;font-size:11px;">Cards auto-detect when playing, or tap to pick</div>`;
    }
    h += `</div>`;

    /* ─ card picker ─ */
    if (STATE.myCards.length < 5) {
      const usedKeys = new Set(STATE.myCards.map(cardKey));

      h += `<div style="margin-bottom:6px;padding:6px;border:1px solid #2f3340;border-radius:8px;background:#141821;">`;

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
      h += `<div class="tpda-pk-bar"><div class="tpda-pk-bar-fill" style="width:${eff}%;background:${sg.color};"></div></div>`;
      h += `<div style="display:flex;justify-content:space-between;font-size:11px;color:#bbb;">`;
      h += `<span>W\u2009${wp}%\u2009\u00b7\u2009T\u2009${tp}%\u2009\u00b7\u2009L\u2009${lp}%</span>`;
      h += `<span style="font-weight:bold;">${eff}%</span>`;
      h += `</div>`;
      h += `</div>`;

      h += `<div style="margin-bottom:6px;padding:8px;border:2px solid ${sg.color};border-radius:8px;background:rgba(0,0,0,0.3);text-align:center;">`;
      h += `<div style="font-size:18px;font-weight:bold;color:${sg.color};">${escapeHtml(sg.act)}</div>`;
      h += `<div style="font-size:11px;color:#bbb;">${escapeHtml(sg.desc)}</div>`;
      h += `</div>`;

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
    } else if (STATE.myCards.length > 0 && STATE.myCards.length < 5) {
      h += `<div style="padding:6px;color:#ffc107;font-size:11px;text-align:center;">`;
      h += `Pick ${5 - STATE.myCards.length} more card${5 - STATE.myCards.length > 1 ? 's' : ''}</div>`;
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
      el.onclick = () => removeCard(Number(el.dataset.idx));
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
