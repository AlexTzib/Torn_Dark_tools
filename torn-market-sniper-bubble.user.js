// ==UserScript==
// @name         Dark Tools - Market Sniper
// @namespace    alex.torn.pda.marketsniper.bubble
// @version      1.0.0
// @description  Market profit finder — scans item market and bazaar for underpriced deals. Shows buy/sell prices, estimated profit, ROI%, and alerts on high-value opportunities.
// @author       Alex + Devin
// @match        https://www.torn.com/*
// @connect      weav3r.dev
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-market-sniper-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-market-sniper-bubble.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PDA_INJECTED_KEY = '###PDA-APIKEY###';

  const SCRIPT_KEY = 'tpda_market_sniper_v1';
  const BUBBLE_ID = 'tpda-sniper-bubble';
  const PANEL_ID = 'tpda-sniper-panel';
  const HEADER_ID = 'tpda-sniper-header';
  const BUBBLE_SIZE = 56;
  const API_DELAY_MS = 300; /* gap between items (~100 calls at 200/min shared with other scripts) */
  const CACHE_TTL_MS = 5 * 60 * 1000; /* 5-minute price cache */
  const DISMISS_TTL_MS = 60 * 60 * 1000; /* 1-hour dismiss expiry */
  const NOTIFY_DEDUP_MS = 5 * 60 * 1000; /* 5-minute notification dedup per item */

  /* ── Default watchlist — high-liquidity fast-flip items ───── */
  const DEFAULT_WATCHLIST = [
    { id: 206, name: 'Xanax' },
    { id: 196, name: 'Vicodin' },
    { id: 367, name: 'Feathery Hotel Coupon' },
    { id: 366, name: 'Erotic DVD' },
    { id: 370, name: 'Donator Pack' },
    { id: 283, name: 'Energy Drink' },
    { id: 197, name: 'Morphine' },
    { id: 398, name: 'Small Explosive Device' },
  ];

  const SETTINGS_KEY = `${SCRIPT_KEY}_settings`;
  const WATCHLIST_KEY = `${SCRIPT_KEY}_watchlist`;
  const DISMISSED_KEY = `${SCRIPT_KEY}_dismissed`;
  const PRICES_KEY = `${SCRIPT_KEY}_prices`;

  function defaultSettings() {
    return {
      minProfit: 0,       /* 0 = no limit */
      minRoi: 0,          /* 0 = no limit */
      profitableOnly: true,
      hideDismissed: true,
      sortBy: 'netProfit', /* 'netProfit' | 'roiPct' | 'discoveredAt' */
      sortAsc: false,      /* descending by default — best deals first */
      taxPct: 0,           /* configurable tax estimate (Torn has no explicit tax, but allows conservative estimates) */
      notifyEnabled: true,
      notifyMinProfit: 100000,
      notifyMinRoi: 10,
    };
  }

  function loadSettings() {
    const saved = getStorage(SETTINGS_KEY, null);
    if (!saved) return defaultSettings();
    return { ...defaultSettings(), ...saved };
  }

  function saveSettings() {
    setStorage(SETTINGS_KEY, STATE.settings);
  }

  function loadWatchlist() {
    const saved = getStorage(WATCHLIST_KEY, null);
    if (!saved) return DEFAULT_WATCHLIST.map(i => ({ ...i }));
    return saved;
  }

  function saveWatchlist() {
    setStorage(WATCHLIST_KEY, STATE.watchlist);
  }

  function loadDismissed() {
    const parsed = getStorage(DISMISSED_KEY, {});
    const now = Date.now();
    const pruned = {};
    for (const [k, ts] of Object.entries(parsed)) {
      if (now - ts < DISMISS_TTL_MS) pruned[k] = ts;
    }
    return pruned;
  }

  function saveDismissed() {
    setStorage(DISMISSED_KEY, STATE.dismissed);
  }

  function loadCachedPrices() {
    const parsed = getStorage(PRICES_KEY, null);
    if (!parsed) return;
    STATE.prices = parsed.prices || {};
    STATE.lastScanAt = parsed.lastScanAt || 0;
    addLog('Loaded cached prices (' + ageText(STATE.lastScanAt) + ')');
  }

  function saveCachedPrices() {
    setStorage(PRICES_KEY, {
      prices: STATE.prices,
      lastScanAt: STATE.lastScanAt
    });
  }

  /* ── state ─────────────────────────────────────────────────── */
  const STATE = {
    apiKey: null,
    apiKeySource: '',
    watchlist: loadWatchlist(),
    settings: loadSettings(),
    dismissed: loadDismissed(),
    prices: {},         /* itemId → { floor, avg, listingCount, bazaarFloor, bazaarAvg, bazaarCount, bazaarSellerId, fetchedAt } */
    deals: [],          /* computed deal objects */
    scanning: false,
    scanProgress: 0,
    lastScanAt: 0,
    lastError: '',
    dealCount: 0,       /* count of profitable deals (for bubble badge) */
    _showWatchlistEdit: false,
    ui: {
      minimized: true,
      zIndexBase: 999940
    },
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
    if (n == null) return '\u2014';
    return '$' + Math.round(Number(n) || 0).toLocaleString();
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

  /** Compact variant — omits seconds when days or hours are present */
  function formatSecondsShort(sec) {
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
    if (!d && !h) parts.push(`${s}s`);
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
      const response = await originalFetch.apply(this, args);
      try {
        const url = String(args[0] && args[0].url ? args[0].url : args[0] || '');
        if (url.includes('api.torn.com/')) {
          extractApiKeyFromUrl(url);
          if (typeof handleApiPayload === 'function' && !url.includes('_tpda=1')) {
            const clone = response.clone();
            const ct = clone.headers.get('content-type') || '';
            if (ct.includes('json') || ct.includes('text/plain')) {
              clone.text().then(t => { const d = safeJsonParse(t); if (d) handleApiPayload(url, d); }).catch(() => {});
            }
          }
        }
      } catch {}
      return response;
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
      this.addEventListener('load', function () {
        try {
          const url = String(this.__tpda_url || '');
          if (!url.includes('api.torn.com/')) return;
          if (url.includes('_tpda=1')) return;
          if (typeof handleApiPayload === 'function') {
            const data = safeJsonParse(this.responseText);
            if (data) handleApiPayload(url, data);
          }
        } catch {}
      });
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
  /* Rough midpoint of each range (used for display/fallback) */
  const STAT_MIDPOINTS   = [1000, 13500, 135000, 1350000, 13500000, 135000000, 300000000];

  /* Per-rank midpoint estimates (total battle stats) for precise assignment matching.
     Values are community-sourced approximations of where each rank falls. */
  const RANK_STAT_MIDPOINTS = {
    'Absolute beginner': 500,
    'Beginner': 3500,
    'Inexperienced': 7500,
    'Rookie': 17500,
    'Novice': 37500,
    'Below average': 62500,
    'Average': 87500,
    'Reasonable': 125000,
    'Above average': 200000,
    'Competent': 300000,
    'Highly competent': 425000,
    'Veteran': 625000,
    'Distinguished': 875000,
    'Highly distinguished': 1250000,
    'Professional': 1750000,
    'Star': 2500000,
    'Master': 3500000,
    'Outstanding': 4500000,
    'Celebrity': 6250000,
    'Supreme': 8750000,
    'Idolized': 12500000,
    'Champion': 17500000,
    'Heroic': 25000000,
    'Legendary': 40000000,
    'Elite': 75000000,
    'Invincible': 150000000
  };

  function rankToMidpoint(rank) {
    return RANK_STAT_MIDPOINTS[rank] || 0;
  }

  function formatStatCompact(n) {
    if (n == null || isNaN(n)) return '?';
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }

  const PROFILE_CACHE_KEY = 'tpda_shared_profile_cache';
  const PROFILE_CACHE_TTL = 30 * 60 * 1000; // 30 min
  const SCAN_API_GAP_MS   = 650; // ~92 calls/min, under 100 limit

  function estimateStats(rank, level, crimesTotal, networth) {
    const rs = RANK_SCORES[rank];
    if (!rs) return null;
    /* Torn rank is directly determined by total battle stats.
       Map rank brackets to our 7 display ranges based on
       community-sourced rank ↔ stat correlations:
         rs  1      →  < 2k          (Absolute beginner)
         rs  2-4    →  2k - 25k      (Beginner … Rookie)
         rs  5-9    →  20k - 250k    (Novice … Above average)
         rs 10-15   →  200k - 2.5M   (Competent … Professional)
         rs 16-20   →  2M - 25M      (Star … Supreme)
         rs 21-24   →  20M - 250M    (Idolized … Legendary)
         rs 25-26   →  > 200M        (Elite, Invincible)       */
    const idx = rs <= 1  ? 0
              : rs <= 4  ? 1
              : rs <= 9  ? 2
              : rs <= 15 ? 3
              : rs <= 20 ? 4
              : rs <= 24 ? 5
              :            6;
    return { label: STAT_RANGES[idx], color: STAT_COLORS[idx], idx, midpoint: RANK_STAT_MIDPOINTS[rank] || STAT_MIDPOINTS[idx] };
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

  /* ── Cross-origin GET (PDA native HTTP with fetch fallback) ──
   *  Used for external APIs like TornW3B (weav3r.dev).
   *  PDA WebView blocks plain fetch to external domains even with
   *  CORS headers; PDA_httpGet uses Flutter native HTTP instead. */

  async function crossOriginGet(url) {
    if (typeof PDA_httpGet === 'function') {
      addLog('[W3B] using PDA_httpGet');
      const r = await PDA_httpGet(url, {});
      if (r && r.responseText) return JSON.parse(r.responseText);
      throw new Error(`PDA_httpGet status ${r?.status || 'unknown'}`);
    }
    addLog('[W3B] using fetch');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  /* ── Shared profit calculator ────────────────────────────────
   *  Reusable by any feature that needs buy/sell/tax/profit math.
   *  Returns null if inputs are invalid. */

  function calcDealProfit(buyPrice, sellPrice, taxPct, extraFees) {
    if (!buyPrice || buyPrice <= 0 || !sellPrice || sellPrice <= 0) return null;
    taxPct = Number(taxPct) || 0;
    extraFees = Number(extraFees) || 0;
    const taxAmount = Math.round(sellPrice * taxPct / 100);
    const netProfit = sellPrice - buyPrice - taxAmount - extraFees;
    const roiPct = buyPrice > 0 ? Math.round(netProfit / buyPrice * 10000) / 100 : 0;
    return { buyPrice, sellPrice, taxPct, taxAmount, extraFees, netProfit, roiPct };
  }

  /* ── Notification helper (with dedup) ───────────────────────
   *  Shared notification system with duplicate suppression.
   *  Returns true if a new notification was fired, false if suppressed. */

  const _tpdaNotifyCache = {};

  function tpdaNotify(key, title, body, ttlMs) {
    ttlMs = ttlMs || 5 * 60 * 1000;
    const now = Date.now();
    if (_tpdaNotifyCache[key] && (now - _tpdaNotifyCache[key]) < ttlMs) return false;
    _tpdaNotifyCache[key] = now;
    for (const k of Object.keys(_tpdaNotifyCache)) {
      if (now - _tpdaNotifyCache[k] > ttlMs * 2) delete _tpdaNotifyCache[k];
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: key, silent: false }); } catch {}
    }
    return true;
  }

  function tpdaRequestNotifyPermission() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  /* ── War-shared helpers ─────────────────────────────────────── */

  function loadPollMs(intervals, defaultMs) {
    const saved = getStorage(`${SCRIPT_KEY}_poll_ms`, defaultMs);
    return intervals.some(p => p.ms === saved) ? saved : defaultMs;
  }

  function savePollMs(ms) {
    setStorage(`${SCRIPT_KEY}_poll_ms`, ms);
  }

  function getManualEnemyFactionId() {
    return getStorage(`${SCRIPT_KEY}_enemy_faction_id`, '');
  }

  function setManualEnemyFactionId(id) {
    setStorage(`${SCRIPT_KEY}_enemy_faction_id`, String(id || ''));
  }

  function profileUrl(id) {
    return `https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}`;
  }

  function attackUrl(id) {
    return `https://www.torn.com/loader.php?sid=attack&user2ID=${encodeURIComponent(id)}`;
  }

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



  /* ── Panel expand/collapse hooks ─────────────────────────── */
  function onPanelExpand() {
    renderPanel();
    if (!STATE.scanning && (!STATE.lastScanAt || Date.now() - STATE.lastScanAt > CACHE_TTL_MS)) {
      scanAllItems();
    }
  }
  function onPanelCollapse() {}


  /* ── Cross-origin GET helper (PDA native -> plain fetch) ─── */


  /* ── Fetch item market data from Torn API v2 ─────────────── */
  async function fetchItemMarketData(itemId) {
    if (!STATE.apiKey) throw new Error('No API key');
    const url = `https://api.torn.com/v2/market/${itemId}/itemmarket?key=${STATE.apiKey}&_tpda=1`;
    addLog(`[API] GET /v2/market/${itemId}/itemmarket`);

    let data;
    if (typeof PDA_httpGet === 'function') {
      const resp = await PDA_httpGet(url, {});
      data = safeJsonParse(resp?.responseText);
    } else {
      const r = await fetch(url);
      data = await r.json();
    }

    if (data?.error) throw new Error(`API error ${data.error.code}: ${data.error.error}`);

    const im = data?.itemmarket || {};
    const listings = im.listings || [];
    const itemName = im.item?.name || '';
    const avgPrice = im.item?.average_price ?? null;
    addLog(`[API] itemmarket ${itemId}: ${listings.length} listings, avg=${avgPrice ?? 'n/a'}`);
    return {
      floor: listings.length ? listings[0].price : null,
      avg: avgPrice,
      count: listings.length,
      itemName
    };
  }


  /* ── Fetch bazaar data from TornW3B ────────────────────────── */
  async function fetchItemBazaarData(itemId) {
    const url = `https://weav3r.dev/api/marketplace/${itemId}`;
    addLog(`[W3B] GET /api/marketplace/${itemId}`);
    try {
      const data = await crossOriginGet(url);
      const listings = data.listings || [];
      const top = listings[0] || {};
      const bazaarFloor = top.price ?? null;
      const bazaarSellerId = top.player_id ?? null;
      const bazaarAvg = data.bazaar_average ?? null;
      addLog(`[W3B] bazaar ${itemId}: floor=${bazaarFloor ?? 'n/a'} avg=${bazaarAvg ?? 'n/a'} (${listings.length})`);
      return { bazaarFloor, bazaarAvg, bazaarCount: listings.length, bazaarSellerId };
    } catch (err) {
      addLog(`[W3B] bazaar ${itemId}: ${err.message}`);
      return { bazaarFloor: null, bazaarAvg: null, bazaarCount: 0, bazaarSellerId: null };
    }
  }


  /* ── Scan all watchlist items ──────────────────────────────── */
  async function scanAllItems() {
    if (STATE.scanning) { addLog('Scan already in progress'); return; }
    if (!STATE.apiKey) {
      STATE.lastError = 'No API key';
      addLog('Cannot scan \u2014 no API key');
      renderPanel();
      return;
    }

    STATE.scanning = true;
    STATE.scanProgress = 0;
    STATE.lastError = '';
    addLog(`Scanning ${STATE.watchlist.length} items\u2026`);
    renderPanel();

    for (let i = 0; i < STATE.watchlist.length; i++) {
      const item = STATE.watchlist[i];
      STATE.scanProgress = i;

      try {
        const [market, bazaar] = await Promise.all([
          fetchItemMarketData(item.id),
          fetchItemBazaarData(item.id)
        ]);

        /* Update item name from API if available */
        if (market.itemName && !item.nameFromApi) {
          item.name = market.itemName;
          item.nameFromApi = true;
        }

        STATE.prices[item.id] = {
          floor: market.floor,
          avg: market.avg,
          listingCount: market.count,
          bazaarFloor: bazaar.bazaarFloor,
          bazaarAvg: bazaar.bazaarAvg,
          bazaarCount: bazaar.bazaarCount,
          bazaarSellerId: bazaar.bazaarSellerId,
          fetchedAt: nowTs()
        };

        const bestBuy = [market.floor, bazaar.bazaarFloor].filter(p => p != null && p > 0);
        const buyPrice = bestBuy.length ? Math.min(...bestBuy) : null;
        if (buyPrice && market.avg) {
          addLog(`${item.name}: buy=${formatMoney(buyPrice)} sell=${formatMoney(market.avg)}`);
        }
      } catch (err) {
        addLog(`ERROR scanning ${item.name}: ${err.message}`);
      }

      if (!STATE.ui.minimized) renderPanel();
      if (i < STATE.watchlist.length - 1) await sleep(API_DELAY_MS);
    }

    STATE.scanProgress = STATE.watchlist.length;
    STATE.lastScanAt = nowTs();
    STATE.scanning = false;
    saveCachedPrices();
    saveWatchlist();
    buildDeals();
    checkNotifications();
    addLog(`Scan complete \u2014 ${STATE.dealCount} profitable deal${STATE.dealCount !== 1 ? 's' : ''}`);
    updateBubbleBadge();
    renderPanel();
  }


  /* ── Build deals from cached prices ────────────────────────── */
  function buildDeals() {
    const s = STATE.settings;
    const deals = [];

    for (const item of STATE.watchlist) {
      const p = STATE.prices[item.id];
      if (!p) continue;

      const bestBuy = [p.floor, p.bazaarFloor].filter(v => v != null && v > 0);
      const buyPrice = bestBuy.length ? Math.min(...bestBuy) : null;
      const sellPrice = p.avg;
      const buySource = (buyPrice != null && buyPrice === p.bazaarFloor) ? 'bazaar' : 'market';

      const profit = calcDealProfit(buyPrice, sellPrice, s.taxPct, 0);
      if (!profit) continue;

      deals.push({
        itemId: item.id,
        itemName: item.name,
        buyPrice: profit.buyPrice,
        sellPrice: profit.sellPrice,
        buySource,
        taxAmount: profit.taxAmount,
        netProfit: profit.netProfit,
        roiPct: profit.roiPct,
        marketFloor: p.floor,
        bazaarFloor: p.bazaarFloor,
        bazaarSellerId: p.bazaarSellerId,
        listingCount: (p.listingCount || 0) + (p.bazaarCount || 0),
        discoveredAt: p.fetchedAt || nowTs()
      });
    }

    STATE.deals = deals;
    STATE.dealCount = deals.filter(d => d.netProfit > 0).length;
  }


  /* ── Filter and sort deals ─────────────────────────────────── */
  function filteredDeals() {
    const s = STATE.settings;
    let list = STATE.deals.filter(d => {
      if (s.profitableOnly && d.netProfit <= 0) return false;
      if (s.minProfit > 0 && d.netProfit < s.minProfit) return false;
      if (s.minRoi > 0 && d.roiPct < s.minRoi) return false;
      if (s.hideDismissed) {
        const key = `${d.itemId}:${d.buyPrice}`;
        if (STATE.dismissed[key]) return false;
      }
      return true;
    });

    const dir = s.sortAsc ? 1 : -1;
    list.sort((a, b) => {
      if (s.sortBy === 'roiPct') return dir * (a.roiPct - b.roiPct);
      if (s.sortBy === 'discoveredAt') return dir * (a.discoveredAt - b.discoveredAt);
      return dir * (a.netProfit - b.netProfit);
    });

    return list;
  }


  /* ── Notifications ─────────────────────────────────────────── */
  function checkNotifications() {
    const s = STATE.settings;
    if (!s.notifyEnabled) return;

    for (const d of STATE.deals) {
      if (d.netProfit <= 0) continue;
      if (s.notifyMinProfit > 0 && d.netProfit < s.notifyMinProfit) continue;
      if (s.notifyMinRoi > 0 && d.roiPct < s.notifyMinRoi) continue;

      const key = `sniper_${d.itemId}`;
      tpdaNotify(
        key,
        `Deal: ${d.itemName}`,
        `Profit: ${formatMoney(d.netProfit)} (${d.roiPct.toFixed(1)}% ROI)`,
        NOTIFY_DEDUP_MS
      );
    }
  }


  /* ── Bubble badge ──────────────────────────────────────────── */
  function updateBubbleBadge() {
    const bubble = getBubbleEl();
    if (!bubble) return;
    const count = filteredDeals().length;
    const badge = bubble.querySelector('.tpda-sniper-badge');
    if (count > 0) {
      if (badge) {
        badge.textContent = String(count);
        badge.style.display = 'flex';
      }
    } else if (badge) {
      badge.style.display = 'none';
    }
  }


  /* ── Styles ──────────────────────────────────────────────── */

  function ensureStyles() {
    if (document.getElementById(`${SCRIPT_KEY}_style`)) return;

    const style = document.createElement('style');
    style.id = `${SCRIPT_KEY}_style`;
    style.textContent = `
      #${BUBBLE_ID} {
        position: fixed;
        width: ${BUBBLE_SIZE}px;
        height: ${BUBBLE_SIZE}px;
        border-radius: 50%;
        background: linear-gradient(135deg, #2ecc40, #1b8c2a);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-family: Arial, sans-serif;
        font-size: 11px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.18);
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
      }
      #${PANEL_ID} {
        position: fixed;
        width: 400px;
        max-width: 95vw;
        max-height: 80vh;
        background: rgba(15,15,18,0.98);
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
      .tpda-sniper-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 18px;
        height: 18px;
        border-radius: 9px;
        background: #f44;
        color: #fff;
        font-size: 10px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        border: 2px solid #0d0f14;
      }
      .tpda-sniper-row {
        padding: 8px;
        border-bottom: 1px solid #1e2030;
        font-size: 12px;
      }
      .tpda-sniper-row:hover {
        background: rgba(46,204,64,0.06);
      }
      .tpda-sniper-profit { color: #4caf50; font-weight: bold; }
      .tpda-sniper-loss { color: #f44; }
      .tpda-sniper-roi { color: #ffd700; font-size: 11px; }
      .tpda-sniper-buy-link {
        background: #2ecc40;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 11px;
        cursor: pointer;
        text-decoration: none;
        white-space: nowrap;
      }
      .tpda-sniper-dismiss {
        background: #333;
        color: #aaa;
        border: none;
        border-radius: 6px;
        padding: 3px 6px;
        font-size: 10px;
        cursor: pointer;
      }
      .tpda-sniper-filter-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 0;
        font-size: 11px;
      }
      .tpda-sniper-filter-row label {
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .tpda-sniper-filter-row input[type="checkbox"] {
        cursor: pointer;
      }
      .tpda-sniper-filter-row input[type="number"] {
        width: 70px;
        background: #0f1116;
        color: #fff;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 2px 4px;
        font-size: 11px;
      }
      .tpda-sniper-filter-row select {
        background: #0f1116;
        color: #fff;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 2px 4px;
        font-size: 11px;
      }
    `;
    document.head.appendChild(style);
  }


  /* ── Bubble ────────────────────────────────────────────────── */

  function createBubble() {
    if (getBubbleEl()) return;

    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.dataset.tpdaBubble = '1';
    bubble.innerHTML = 'MKT<span class="tpda-sniper-badge" style="display:none;">0</span>';

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


  /* ── Panel ─────────────────────────────────────────────────── */

  function createPanel() {
    if (getPanelEl()) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.display = 'none';
    panel.style.zIndex = String(STATE.ui.zIndexBase);

    panel.innerHTML = `
      <div id="${HEADER_ID}" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#1c1d24;border-bottom:1px solid #333;flex:0 0 auto;">
        <div>
          <div style="font-weight:bold;">Market Sniper</div>
          <div style="font-size:11px;color:#bbb;">Profit finder &amp; deal alerts</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="tpda-sniper-scan" style="background:#2ecc40;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">Scan</button>
          <button id="tpda-sniper-collapse" style="background:#444;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">\u25CB</button>
        </div>
      </div>
      <div id="tpda-sniper-body" style="padding:8px;overflow-y:auto;flex:1 1 auto;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('tpda-sniper-scan').addEventListener('click', () => {
      scanAllItems();
    });
    document.getElementById('tpda-sniper-collapse').addEventListener('click', collapseToBubble);

    /* Delegated click handler — attached ONCE here, never inside renderPanel() */
    const panelBody = document.getElementById('tpda-sniper-body');
    panelBody.addEventListener('click', (e) => {
      if (handleApiKeyClick(e, panelBody, () => { scanAllItems(); })) return;
      if (handleLogClick(e, panelBody)) return;

      /* Dismiss buttons */
      const dismissBtn = e.target.closest('.tpda-sniper-dismiss');
      if (dismissBtn) {
        const key = dismissBtn.dataset.dismissKey;
        if (key) {
          STATE.dismissed[key] = Date.now();
          saveDismissed();
          renderPanel();
          updateBubbleBadge();
        }
        return;
      }

      /* Clear dismissed */
      if (e.target.closest('.tpda-sniper-clear-dismissed')) {
        STATE.dismissed = {};
        saveDismissed();
        renderPanel();
        updateBubbleBadge();
        return;
      }

      /* Watchlist edit toggle */
      if (e.target.closest('.tpda-sniper-watchlist-toggle')) {
        STATE._showWatchlistEdit = !STATE._showWatchlistEdit;
        renderPanel();
        return;
      }

      /* Remove watchlist item */
      const removeBtn = e.target.closest('.tpda-sniper-wl-remove');
      if (removeBtn) {
        const itemId = parseInt(removeBtn.dataset.itemId);
        if (itemId) {
          STATE.watchlist = STATE.watchlist.filter(w => w.id !== itemId);
          saveWatchlist();
          renderPanel();
        }
        return;
      }

      /* Add watchlist item */
      if (e.target.closest('.tpda-sniper-wl-add')) {
        const idInput = panelBody.querySelector('.tpda-sniper-wl-id');
        const nameInput = panelBody.querySelector('.tpda-sniper-wl-name');
        const id = parseInt(idInput?.value);
        const name = String(nameInput?.value || '').trim();
        if (id > 0 && name) {
          if (!STATE.watchlist.some(w => w.id === id)) {
            STATE.watchlist.push({ id, name });
            saveWatchlist();
            addLog(`Added ${name} (ID ${id}) to watchlist`);
          }
          renderPanel();
        }
        return;
      }
    });

    /* Delegated change handler for settings/filters */
    panelBody.addEventListener('change', (e) => {
      const el = e.target;
      if (!el) return;
      const sKey = el.dataset.setting;
      if (!sKey) return;

      if (el.type === 'checkbox') {
        STATE.settings[sKey] = el.checked;
      } else if (el.type === 'number') {
        STATE.settings[sKey] = parseFloat(el.value) || 0;
      } else if (el.tagName === 'SELECT') {
        STATE.settings[sKey] = el.value;
      }
      saveSettings();
      buildDeals();
      updateBubbleBadge();
      renderPanel();
    });

    makeDraggablePanel(panel, document.getElementById(HEADER_ID));
  }


  /* ── Render ────────────────────────────────────────────────── */

  function renderPanel() {
    const body = document.getElementById('tpda-sniper-body');
    if (!body) return;

    let h = '';
    const s = STATE.settings;

    /* ─ Filters card ─ */
    h += `<div style="margin-bottom:8px;padding:8px;border:1px solid #2f3340;border-radius:10px;background:#141821;">`;
    h += `<div style="font-weight:bold;font-size:12px;margin-bottom:6px;">Filters &amp; Sort</div>`;

    h += `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:6px;">`;
    h += settingCheckbox('profitableOnly', 'Profitable only', s.profitableOnly, '#4caf50');
    h += settingCheckbox('hideDismissed', 'Hide dismissed', s.hideDismissed, '#bbb');
    h += `</div>`;

    h += `<div style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11px;">`;
    h += `<div class="tpda-sniper-filter-row">`;
    h += `<span style="color:#bbb;">Min Profit:</span>`;
    h += `<input type="number" data-setting="minProfit" value="${s.minProfit || ''}" min="0" placeholder="any" />`;
    h += `</div>`;
    h += `<div class="tpda-sniper-filter-row">`;
    h += `<span style="color:#bbb;">Min ROI%:</span>`;
    h += `<input type="number" data-setting="minRoi" value="${s.minRoi || ''}" min="0" step="0.1" placeholder="any" />`;
    h += `</div>`;
    h += `<div class="tpda-sniper-filter-row">`;
    h += `<span style="color:#bbb;">Tax%:</span>`;
    h += `<input type="number" data-setting="taxPct" value="${s.taxPct || ''}" min="0" max="100" step="0.1" placeholder="0" />`;
    h += `</div>`;
    h += `</div>`;

    h += `<div class="tpda-sniper-filter-row" style="margin-top:4px;">`;
    h += `<span style="color:#bbb;">Sort by:</span>`;
    h += `<select data-setting="sortBy">`;
    h += `<option value="netProfit" ${s.sortBy === 'netProfit' ? 'selected' : ''}>Net Profit</option>`;
    h += `<option value="roiPct" ${s.sortBy === 'roiPct' ? 'selected' : ''}>ROI %</option>`;
    h += `<option value="discoveredAt" ${s.sortBy === 'discoveredAt' ? 'selected' : ''}>Newest</option>`;
    h += `</select>`;
    h += settingCheckbox('sortAsc', 'Ascending', s.sortAsc, '#bbb');
    h += `</div>`;

    h += `</div>`;

    /* ─ Notification settings ─ */
    h += `<div style="margin-bottom:8px;padding:8px;border:1px solid #2f3340;border-radius:10px;background:#141821;">`;
    h += `<div style="font-weight:bold;font-size:12px;margin-bottom:6px;">Notifications</div>`;
    h += `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;">`;
    h += settingCheckbox('notifyEnabled', 'Alert on deals', s.notifyEnabled, '#ffd700');
    h += `</div>`;
    if (s.notifyEnabled) {
      h += `<div style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11px;margin-top:4px;">`;
      h += `<div class="tpda-sniper-filter-row">`;
      h += `<span style="color:#bbb;">Min $:</span>`;
      h += `<input type="number" data-setting="notifyMinProfit" value="${s.notifyMinProfit || ''}" min="0" placeholder="100000" />`;
      h += `</div>`;
      h += `<div class="tpda-sniper-filter-row">`;
      h += `<span style="color:#bbb;">Min ROI%:</span>`;
      h += `<input type="number" data-setting="notifyMinRoi" value="${s.notifyMinRoi || ''}" min="0" step="0.1" placeholder="10" />`;
      h += `</div>`;
      h += `</div>`;
    }
    h += `</div>`;

    /* ─ Status bar ─ */
    if (STATE.scanning) {
      h += `<div style="padding:6px;text-align:center;color:#ffc107;font-size:11px;">Scanning\u2026 ${STATE.scanProgress + 1}/${STATE.watchlist.length}</div>`;
    } else if (STATE.lastError) {
      h += `<div style="padding:6px;text-align:center;color:#f44;font-size:11px;">${escapeHtml(STATE.lastError)}</div>`;
    } else if (STATE.lastScanAt) {
      const deals = filteredDeals();
      h += `<div style="padding:4px 6px;display:flex;justify-content:space-between;font-size:11px;color:#888;">`;
      h += `<span>${deals.length} deal${deals.length !== 1 ? 's' : ''} found</span>`;
      h += `<span>Scanned ${ageText(STATE.lastScanAt)}</span>`;
      h += `</div>`;
    }

    /* ─ Deals list ─ */
    if (STATE.deals.length > 0 && !STATE.scanning) {
      const deals = filteredDeals();

      if (deals.length === 0) {
        h += `<div style="padding:12px;text-align:center;color:#888;font-size:12px;">No deals match your filters`;
        if (Object.keys(STATE.dismissed).length > 0) {
          h += ` <button class="tpda-sniper-clear-dismissed" style="background:#333;color:#bbb;border:none;border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer;margin-left:4px;">Clear dismissed</button>`;
        }
        h += `</div>`;
      } else {
        h += `<div style="max-height:45vh;overflow-y:auto;">`;
        for (const d of deals) {
          const profitClass = d.netProfit > 0 ? 'tpda-sniper-profit' : 'tpda-sniper-loss';
          const marketUrl = `https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${d.itemId}`;
          const buyUrl = d.buySource === 'bazaar' && d.bazaarSellerId
            ? `https://www.torn.com/bazaar.php?userId=${d.bazaarSellerId}#/`
            : marketUrl;
          const dismissKey = `${d.itemId}:${d.buyPrice}`;

          h += `<div class="tpda-sniper-row">`;

          /* Item info row */
          h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">`;
          h += `<div>`;
          h += `<a href="${escapeHtml(marketUrl)}" target="_blank" style="color:#42a5f5;text-decoration:none;font-weight:bold;">${escapeHtml(d.itemName)}</a>`;
          h += ` <span style="color:#666;font-size:10px;">#${d.itemId}</span>`;
          h += `</div>`;
          h += `<div style="display:flex;gap:4px;">`;
          h += `<a class="tpda-sniper-buy-link" href="${escapeHtml(buyUrl)}" target="_blank">Buy</a>`;
          h += `<button class="tpda-sniper-dismiss" data-dismiss-key="${escapeHtml(dismissKey)}">\u2715</button>`;
          h += `</div>`;
          h += `</div>`;

          /* Price details */
          h += `<div style="display:flex;gap:12px;font-size:11px;color:#bbb;">`;
          h += `<span>Buy: ${formatMoney(d.buyPrice)} <span style="color:#666;font-size:10px;">(${escapeHtml(d.buySource)})</span></span>`;
          h += `<span>Sell: ${formatMoney(d.sellPrice)}</span>`;
          h += `</div>`;

          /* Profit line */
          h += `<div style="display:flex;gap:12px;align-items:center;margin-top:2px;">`;
          h += `<span class="${profitClass}">Profit: ${formatMoney(d.netProfit)}</span>`;
          h += `<span class="tpda-sniper-roi">ROI: ${d.roiPct.toFixed(1)}%</span>`;
          if (d.taxAmount > 0) {
            h += `<span style="color:#888;font-size:10px;">Tax: ${formatMoney(d.taxAmount)}</span>`;
          }
          h += `</div>`;

          h += `</div>`;
        }
        h += `</div>`;

        if (Object.keys(STATE.dismissed).length > 0) {
          h += `<div style="text-align:center;padding:6px;">`;
          h += `<button class="tpda-sniper-clear-dismissed" style="background:#333;color:#bbb;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;">Clear ${Object.keys(STATE.dismissed).length} dismissed</button>`;
          h += `</div>`;
        }
      }
    } else if (!STATE.scanning && STATE.lastScanAt === 0 && STATE.apiKey) {
      h += `<div style="padding:12px;text-align:center;color:#888;font-size:12px;">Tap Scan to find deals</div>`;
    } else if (!STATE.apiKey) {
      h += `<div style="padding:12px;text-align:center;color:#ffc107;font-size:12px;">Enter your API key below to scan</div>`;
    }

    /* ─ Watchlist editor (collapsible) ─ */
    h += `<div style="margin-top:8px;padding:8px;border:1px solid #2f3340;border-radius:10px;background:#141821;">`;
    h += `<div class="tpda-sniper-watchlist-toggle" style="font-weight:bold;font-size:12px;cursor:pointer;user-select:none;">`;
    h += `${STATE._showWatchlistEdit ? '\u25BC' : '\u25B6'} Watchlist (${STATE.watchlist.length} items)`;
    h += `</div>`;

    if (STATE._showWatchlistEdit) {
      h += `<div style="margin-top:8px;">`;
      for (const item of STATE.watchlist) {
        h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px;">`;
        h += `<span>${escapeHtml(item.name)} <span style="color:#666;">#${item.id}</span></span>`;
        h += `<button class="tpda-sniper-wl-remove" data-item-id="${item.id}" style="background:#444;color:#f44;border:none;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;">\u2715</button>`;
        h += `</div>`;
      }
      h += `<div style="margin-top:8px;display:flex;gap:4px;align-items:center;">`;
      h += `<input class="tpda-sniper-wl-id" type="number" placeholder="Item ID" style="width:70px;background:#0f1116;color:#fff;border:1px solid #444;border-radius:4px;padding:4px;font-size:11px;" />`;
      h += `<input class="tpda-sniper-wl-name" type="text" placeholder="Item Name" style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:4px;padding:4px;font-size:11px;" />`;
      h += `<button class="tpda-sniper-wl-add" style="background:#2ecc40;color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">Add</button>`;
      h += `</div>`;
      h += `</div>`;
    }

    h += `</div>`;

    /* ─ API key card ─ */
    h += renderApiKeyCard();

    /* ─ Debug log ─ */
    h += renderLogCard();

    body.innerHTML = h;
  }

  function settingCheckbox(key, label, checked, color) {
    return `<label class="tpda-sniper-filter-row" style="color:${color};">` +
      `<input type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''} />` +
      `${escapeHtml(label)}</label>`;
  }


  /* ── Init ──────────────────────────────────────────────────── */

  function init() {
    initApiKey(PDA_INJECTED_KEY);
    loadCachedPrices();
    if (STATE.lastScanAt) buildDeals();

    ensureStyles();
    createBubble();
    createPanel();
    window.addEventListener('resize', onResize);
    updateBubbleBadge();
    tpdaRequestNotifyPermission();

    addLog('Market Sniper initialized' + (STATE.apiKey ? '' : ' \u2014 waiting for API key'));
  }

  hookFetch();
  hookXHR();

  setTimeout(init, 1200);
})();
