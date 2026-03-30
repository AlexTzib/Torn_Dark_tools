// ==UserScript==
// @name         Dark Tools - Stock Trader
// @namespace    alex.torn.pda.stocktrader.bubble
// @version      1.5.1
// @description  Stock market analyzer — fetches stock prices, tracks history, calculates moving averages, and generates buy/sell signals based on trend analysis.
// @author       Alex + Devin
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-stock-trader-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-stock-trader-bubble.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PDA_INJECTED_KEY = '###PDA-APIKEY###';

  const SCRIPT_KEY = 'tpda_stock_trader_v1';
  const BUBBLE_ID = 'tpda-stock-bubble';
  const PANEL_ID = 'tpda-stock-panel';
  const HEADER_ID = 'tpda-stock-header';
  const BUBBLE_SIZE = 56;

  /* ── Timing constants ──────────────────────────────────────── */
  const MARKET_CACHE_TTL = 5 * 60 * 1000;         /* 5 min — all-stocks overview */
  const DETAIL_CACHE_TTL = 15 * 60 * 1000;        /* 15 min — per-stock chart data */
  const USER_CACHE_TTL = 5 * 60 * 1000;           /* 5 min — user holdings */
  const HISTORY_SNAPSHOT_INTERVAL = 60 * 60 * 1000; /* 1 hour between history snapshots */
  const HISTORY_MAX_AGE = 7 * 24 * 60 * 60 * 1000;  /* 7 days of local history */
  const HISTORY_MAX_POINTS = 168;                  /* 7 days × 24 hours */
  const POLL_MS = 5 * 60 * 1000;                   /* 5 min poll when panel open */
  const API_DELAY_MS = 350;                        /* gap between per-stock detail calls */

  /* ── Stock benefit rules (from AGENTS.md / assistant) ─────── */
  const STOCK_BENEFITS = {
    TCT: { shares: 100000,   cashValue: 1000000,   freqDays: 31, label: '$1M/mo' },
    GRN: { shares: 500000,   cashValue: 4000000,   freqDays: 31, label: '$4M/mo' },
    IOU: { shares: 3000000,  cashValue: 12000000,  freqDays: 31, label: '$12M/mo' },
    TMI: { shares: 6000000,  cashValue: 25000000,  freqDays: 31, label: '$25M/mo' },
    TSB: { shares: 3000000,  cashValue: 50000000,  freqDays: 31, label: '$50M/mo' },
    CNC: { shares: 7500000,  cashValue: 80000000,  freqDays: 31, label: '$80M/mo' }
  };

  /* ── localStorage keys ─────────────────────────────────────── */
  const MARKET_KEY = `${SCRIPT_KEY}_market`;
  const DETAIL_KEY = `${SCRIPT_KEY}_detail`;
  const USER_STOCKS_KEY = `${SCRIPT_KEY}_user_stocks`;
  const HISTORY_KEY = `${SCRIPT_KEY}_history`;
  const WATCHLIST_KEY = `${SCRIPT_KEY}_watchlist`;
  const SETTINGS_KEY = `${SCRIPT_KEY}_settings`;

  /* ── Default watchlist — popular benefit stocks ────────────── */
  const DEFAULT_WATCHLIST = ['TCT', 'GRN', 'IOU', 'TMI', 'TSB', 'CNC', 'FHG', 'SYM', 'MCS', 'EVL', 'EWM', 'LAG', 'PRN', 'THS', 'LSC'];

  function defaultSettings() {
    return {
      sortBy: 'signal',       /* 'signal' | 'change' | 'price' | 'acronym' | 'roi' */
      sortAsc: false,
      showOnlyWatchlist: false,
      showOnlyOwned: false,
      showOnlyNotOwned: false,
      showOnlySignals: false,
      notifyEnabled: false,
      notifyOnBuy: true,
      notifyOnSell: true,
      /* Signal score thresholds */
      strongBuyScore: 4,
      buyScore: 2,
      leanBuyScore: 0.5,
      leanSellScore: -0.5,
      sellScore: -2,
      strongSellScore: -4,
      /* RSI thresholds */
      rsiOversold: 30,
      rsiOverbought: 70,
      /* Benefit ROI thresholds */
      roiGoodPct: 2,
      roiGreatPct: 5
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
    return getStorage(WATCHLIST_KEY, DEFAULT_WATCHLIST.slice());
  }

  function saveWatchlist() {
    setStorage(WATCHLIST_KEY, STATE.watchlist);
  }

  /* ── STATE ─────────────────────────────────────────────────── */
  const STATE = {
    apiKey: null,
    apiKeySource: '',
    /* Market data (all stocks) */
    marketStocks: [],                /* TornStock[] from /v2/torn/stocks */
    marketFetchedAt: 0,
    /* Per-stock detail with chart history */
    stockDetails: {},                /* acronym → { ...TornStockDetailed, fetchedAt } */
    /* User holdings */
    userStocks: [],                  /* UserStock[] from /v2/user/stocks */
    userFetchedAt: 0,
    /* Local price history for trend analysis */
    priceHistory: {},                /* acronym → [{ price, ts }] */
    lastSnapshotAt: 0,
    /* Computed signals */
    signals: {},                     /* acronym → { signal, strength, reasons[] } */
    /* UI */
    watchlist: loadWatchlist(),
    settings: loadSettings(),
    scanning: false,
    scanProgress: 0,
    scanTotal: 0,
    lastError: '',
    activeTab: 'overview',           /* 'overview' | 'detail' | 'holdings' | 'settings' */
    previousTab: 'overview',         /* tab to return to from detail view */
    detailStock: null,               /* acronym of stock being viewed in detail */
    pollTimer: null,
    ui: {
      minimized: true,
      zIndexBase: 999930
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
  const PROFILE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — use Refresh Stats to force re-scan
  const SCAN_API_GAP_MS   = 650; // ~92 calls/min, under 100 limit

  /* ── API call tracking ────────────────────────────────────── */
  const _apiCallLog = [];  // timestamps (ms) of calls in last 60s
  let _apiCallTotal = 0;   // total calls this session

  function trackApiCall() {
    const now = Date.now();
    _apiCallLog.push(now);
    _apiCallTotal++;
    while (_apiCallLog.length && _apiCallLog[0] < now - 60000) _apiCallLog.shift();
  }

  function getApiCallsPerMinute() {
    const now = Date.now();
    while (_apiCallLog.length && _apiCallLog[0] < now - 60000) _apiCallLog.shift();
    return _apiCallLog.length;
  }

  function getApiCallTotal() { return _apiCallTotal; }

  /** Shared fetch helper: uses PDA_httpGet in PDA, plain fetch outside.
   *  Tracks API call count and handles rate limit errors with retry. */
  const TORN_API_TIMEOUT_MS = 12000;

  async function tornApiGet(url, retries) {
    if (retries == null) retries = 1;
    trackApiCall();
    let data;
    try {
      if (typeof PDA_httpGet === 'function') {
        const resp = await PDA_httpGet(url, {});
        data = safeJsonParse(resp?.responseText);
      } else {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), TORN_API_TIMEOUT_MS);
        try {
          const r = await fetch(url, { method: 'GET', signal: controller.signal });
          data = await r.json();
        } finally {
          clearTimeout(tid);
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        addLog(`API timeout after ${TORN_API_TIMEOUT_MS / 1000}s: ${url.replace(/key=[^&]+/, 'key=***')}`);
      } else {
        addLog(`API fetch error: ${err.message || err}`);
      }
      return null;
    }
    if (data?.error) {
      const code = data.error.code || 0;
      if (code === 5 && retries > 0) {
        addLog('Rate limit hit \u2014 waiting 5s before retry...');
        await sleep(5000);
        return tornApiGet(url, retries - 1);
      }
    }
    return data;
  }

  function matchRank(rank) {
    if (!rank) return 0;
    const r = String(rank).trim();
    if (RANK_SCORES[r]) return RANK_SCORES[r];
    const lower = r.toLowerCase();
    for (const [name, score] of Object.entries(RANK_SCORES)) {
      if (lower.includes(name.toLowerCase()) || name.toLowerCase().includes(lower)) return score;
    }
    return 0;
  }

  function estimateStats(rank, level, crimesTotal, networth) {
    const rankIndex = matchRank(rank);
    if (!rankIndex) return null;
    /* Algorithm from Torn PDA StatsCalculator.calculateStats():
       Rank is a composite of battle stats + level + crimes + networth.
       Subtract the non-stat contributions to isolate actual battle stats.
       Higher level/crimes/networth for the same rank = lower real stats. */
    const levelIndex = LEVEL_TRIGGERS.reduce((acc, t) => (level >= t ? acc + 1 : acc), 0);
    const crimeIndex = CRIMES_TRIGGERS.reduce((acc, t) => (crimesTotal >= t ? acc + 1 : acc), 0);
    const nwIndex    = NW_TRIGGERS.reduce((acc, t) => (networth >= t ? acc + 1 : acc), 0);
    const finalIndex = rankIndex - levelIndex - crimeIndex - nwIndex - 1;
    const idx = Math.max(0, Math.min(6, finalIndex));
    const matchedRankName = Object.entries(RANK_SCORES).find(([, v]) => v === rankIndex)?.[0] || rank;
    return { label: STAT_RANGES[idx], color: STAT_COLORS[idx], idx, midpoint: RANK_STAT_MIDPOINTS[matchedRankName] || STAT_MIDPOINTS[idx] };
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

  function clearProfileCache() {
    STATE.profileCache = {};
    setStorage(PROFILE_CACHE_KEY, {});
    addLog('Profile cache cleared');
  }

  async function fetchMemberProfile(memberId) {
    const cached = STATE.profileCache[memberId];
    if (cached && (nowTs() - cached.fetchedAt) < PROFILE_CACHE_TTL) return cached;
    if (!STATE.apiKey) return null;

    try {
      const url = `https://api.torn.com/user/${encodeURIComponent(memberId)}?selections=profile,personalstats,criminalrecord&key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
      const data = await tornApiGet(url);
      if (!data) return null;
      if (data?.error) {
        addLog(`Profile ${memberId}: API error ${data.error.code || data.error.error || ''}`);
        return null;
      }

      const crimesTotal = (() => {
        const cr = data.criminalrecord || data.profile?.criminalrecord;
        if (!cr || typeof cr !== 'object') return 0;
        let sum = 0;
        for (const v of Object.values(cr)) sum += Number(v) || 0;
        return sum;
      })();

      const profile = {
        rank: data.rank || data.profile?.rank || '',
        level: data.level || data.profile?.level || 0,
        crimesTotal,
        networth: data.personalstats?.networth || data.profile?.personalstats?.networth || 0,
        fetchedAt: nowTs()
      };
      profile.estimate = estimateStats(profile.rank, profile.level, profile.crimesTotal, profile.networth);
      if (!profile.estimate && profile.rank) {
        addLog(`Profile ${memberId}: rank "${profile.rank}" not recognized`);
      }
      STATE.profileCache[memberId] = profile;
      return profile;
    } catch (err) {
      addLog(`Profile ${memberId}: ${err.message || err}`);
      return null;
    }
  }

  /* ── FFScouter integration ───────────────────────────────────
   *  Calls ffscouter.com/api/v1/get-stats to get battle stat
   *  estimates based on Fair Fight analysis (community data).
   *  Much more accurate than rank-based estimation.
   *
   *  Requires a separate FFScouter API key (user registers at
   *  ffscouter.com with their Torn API key).
   *
   *  API: GET /api/v1/get-stats?key={ffkey}&targets={id1,id2,...}
   *  - Up to 205 targets per request
   *  - Rate limit: 20 requests/min per IP
   *  - Returns: [{ player_id, fair_fight, bs_estimate,
   *               bs_estimate_human, last_updated }]
   *  ──────────────────────────────────────────────────────────── */

  const FFSCOUTER_BASE_URL = 'https://ffscouter.com/api/v1';
  const FFSCOUTER_CACHE_KEY = 'tpda_shared_ffscouter_cache';
  const FFSCOUTER_KEY_STORAGE = 'tpda_shared_ffscouter_api_key';
  const FFSCOUTER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  const FFSCOUTER_CHUNK_SIZE = 200; // API max is 205, use 200 for safety

  function getFFScouterKey() {
    return getStorage(FFSCOUTER_KEY_STORAGE, '');
  }

  function setFFScouterKey(key) {
    setStorage(FFSCOUTER_KEY_STORAGE, String(key || '').trim());
  }

  function loadFFScouterCache() {
    const raw = getStorage(FFSCOUTER_CACHE_KEY, {});
    const now = nowTs();
    const pruned = {};
    for (const [id, entry] of Object.entries(raw)) {
      if (entry && (now - (entry.cachedAt || 0)) < FFSCOUTER_CACHE_TTL) {
        pruned[id] = entry;
      }
    }
    return pruned;
  }

  function saveFFScouterCache() {
    if (!STATE.ffScouterCache) return;
    setStorage(FFSCOUTER_CACHE_KEY, STATE.ffScouterCache);
  }

  function clearFFScouterCache() {
    STATE.ffScouterCache = {};
    setStorage(FFSCOUTER_CACHE_KEY, {});
    addLog('FFScouter cache cleared');
  }

  /** Fetch FFScouter stats for a list of player IDs.
   *  Chunks into groups of 200, returns total fetched count.
   *  Results stored in STATE.ffScouterCache. */
  async function fetchFFScouterStats(playerIds) {
    const ffKey = getFFScouterKey();
    if (!ffKey) {
      addLog('FFScouter: no API key configured');
      return 0;
    }
    if (!playerIds || !playerIds.length) return 0;

    if (!STATE.ffScouterCache) STATE.ffScouterCache = {};

    // Filter to only stale/missing IDs
    const now = nowTs();
    const staleIds = playerIds.filter(id => {
      const entry = STATE.ffScouterCache[id];
      return !entry || (now - (entry.cachedAt || 0)) >= FFSCOUTER_CACHE_TTL;
    });

    if (!staleIds.length) {
      addLog('FFScouter: all targets already cached');
      return 0;
    }

    let totalFetched = 0;

    for (let i = 0; i < staleIds.length; i += FFSCOUTER_CHUNK_SIZE) {
      const chunk = staleIds.slice(i, i + FFSCOUTER_CHUNK_SIZE);
      const targetsParam = chunk.join(',');
      const url = `${FFSCOUTER_BASE_URL}/get-stats?key=${encodeURIComponent(ffKey)}&targets=${targetsParam}`;

      try {
        addLog(`FFScouter: fetching ${chunk.length} targets (chunk ${Math.floor(i / FFSCOUTER_CHUNK_SIZE) + 1})...`);
        const data = await crossOriginGet(url);

        if (Array.isArray(data)) {
          const cacheTime = nowTs();
          for (const stat of data) {
            if (!stat.player_id) continue;
            STATE.ffScouterCache[String(stat.player_id)] = {
              playerId: stat.player_id,
              bsEstimate: stat.bs_estimate || null,
              bsEstimateHuman: stat.bs_estimate_human || null,
              fairFight: stat.fair_fight || null,
              lastUpdated: stat.last_updated || null,
              cachedAt: cacheTime
            };
            if (stat.bs_estimate) totalFetched++;
          }
          addLog(`FFScouter: got ${chunk.length} results (${totalFetched} with data)`);
        } else if (data && data.error) {
          addLog(`FFScouter error: ${data.error} (code ${data.code || '?'})`);
          if (data.code === 6) {
            addLog('FFScouter: API key not registered. Register at ffscouter.com');
            break;
          }
        }
      } catch (err) {
        addLog(`FFScouter fetch error: ${err.message || err}`);
      }

      // Rate limit courtesy: 3s delay between chunks
      if (i + FFSCOUTER_CHUNK_SIZE < staleIds.length) {
        await sleep(3000);
      }
    }

    saveFFScouterCache();
    return totalFetched;
  }

  /** Format FFScouter bs_estimate as a human-readable stat label.
   *  Returns an object { label, color } matching the rank-based estimate format. */
  function ffScouterToEstimate(entry) {
    if (!entry || !entry.bsEstimate) return null;
    const bs = entry.bsEstimate;
    const human = entry.bsEstimateHuman || formatStatCompact(bs);
    // Color based on absolute stat level
    let color;
    if (bs >= 2e9) color = '#ff1744';        // 2B+: deep red (extremely strong)
    else if (bs >= 500e6) color = '#ff5252';  // 500M+: red
    else if (bs >= 100e6) color = '#ff9800';  // 100M+: orange
    else if (bs >= 50e6) color = '#ffc107';   // 50M+: amber
    else if (bs >= 10e6) color = '#ffeb3b';   // 10M+: yellow
    else if (bs >= 2e6) color = '#8bc34a';    // 2M+: light green
    else color = '#4caf50';                   // under 2M: green (weak)

    const ffLabel = entry.fairFight != null ? ` FF:${entry.fairFight.toFixed(2)}` : '';
    return {
      label: `~${human}${ffLabel}`,
      color,
      source: 'ffscouter',
      bsEstimate: bs,
      fairFight: entry.fairFight,
      bsHuman: human
    };
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ── waitForElement: MutationObserver-based DOM polling ─────
   *  Returns a Promise that resolves when a matching element appears.
   *  Auto-cleans up after timeout (default 10s). Much more reliable
   *  than setTimeout polling for Torn's React SPA. */

  function waitForElement(selector, timeoutMs) {
    if (timeoutMs == null) timeoutMs = 10000;
    return new Promise(function (resolve, reject) {
      var el = document.querySelector(selector);
      if (el) return resolve(el);
      var obs = new MutationObserver(function () {
        var found = document.querySelector(selector);
        if (found) { obs.disconnect(); clearTimeout(tid); resolve(found); }
      });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      var tid = setTimeout(function () {
        obs.disconnect();
        reject(new Error('waitForElement timeout: ' + selector));
      }, timeoutMs);
    });
  }

  /* ── debounce: delay function execution until calls settle ── */

  function debounce(fn, waitMs) {
    var timer;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, waitMs);
    };
  }

  /* ── Input validation helpers ────────────────────────────── */

  function validateApiKey(key) {
    if (!key) return false;
    return /^[a-zA-Z0-9]{16}$/.test(String(key).trim());
  }

  function validateFactionId(id) {
    if (!id) return false;
    var s = String(id).trim();
    return /^\d{1,10}$/.test(s) && parseInt(s, 10) > 0;
  }

  function validateUserId(id) {
    if (!id) return false;
    var s = String(id).trim();
    return /^\d{1,10}$/.test(s) && parseInt(s, 10) > 0;
  }

  /* ── Batch API helper: parallel requests with throttle ─────
   *  Runs batches of `concurrency` requests, sleeping `delayMs`
   *  between batches. Each request is error-isolated so one
   *  failure won't kill the batch.
   *
   *  items:       Array of arbitrary items
   *  buildUrl:    fn(item) → URL string
   *  concurrency: parallel requests per batch (default 2)
   *  delayMs:     ms between batches (default 650)
   *
   *  Returns Array of { item, data, error } */

  async function batchApiCalls(items, buildUrl, concurrency, delayMs) {
    if (concurrency == null) concurrency = 2;
    if (delayMs == null) delayMs = 650;
    var results = [];
    for (var i = 0; i < items.length; i += concurrency) {
      var batch = items.slice(i, i + concurrency);
      var batchResults = await Promise.all(batch.map(function (item) {
        return tornApiGet(buildUrl(item))
          .then(function (data) { return { item: item, data: data, error: null }; })
          .catch(function (err) { return { item: item, data: null, error: err }; });
      }));
      for (var j = 0; j < batchResults.length; j++) results.push(batchResults[j]);
      if (i + concurrency < items.length) await sleep(delayMs);
    }
    return results;
  }

  /* ── Torn page data access (zero-cost, no API call) ────────
   *  Torn stores some user data in window.topBannerInitData.
   *  Returns the data object if available, or null. */

  function getTornBannerData() {
    try {
      return (typeof window !== 'undefined' && window.topBannerInitData &&
              window.topBannerInitData.user &&
              window.topBannerInitData.user.data) || null;
    } catch (_) { return null; }
  }

  /* ── isTabActive: check if browser tab/PDA tab is focused ── */

  function isTabActive() {
    try {
      if (typeof window !== 'undefined' && window.__tornpda &&
          window.__tornpda.tab && window.__tornpda.tab.state) {
        return !!window.__tornpda.tab.state.isActiveTab;
      }
    } catch (_) { /* not in PDA */ }
    return typeof document !== 'undefined' ? !document.hidden : true;
  }

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
      const url = `https://api.torn.com/faction/?selections=basic&key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
      addLog('Fetching own faction data for war detection...');
      const data = await tornApiGet(url);
      if (!data) return null;
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
    refreshIfStale();
    startPolling();
  }

  function onPanelCollapse() {
    stopPolling();
  }

  function startPolling() {
    stopPolling();
    STATE.pollTimer = setInterval(() => {
      if (!STATE.scanning) refreshIfStale();
    }, POLL_MS);
  }

  function stopPolling() {
    if (STATE.pollTimer) {
      clearInterval(STATE.pollTimer);
      STATE.pollTimer = null;
    }
  }

  async function refreshIfStale() {
    const now = Date.now();
    if (now - STATE.marketFetchedAt > MARKET_CACHE_TTL) {
      await fetchAllStocks();
    }
    if (STATE.apiKey && now - STATE.userFetchedAt > USER_CACHE_TTL) {
      await fetchUserStocks();
    }
  }


  /* ══════════════════════════════════════════════════════════════
   *  DATA FETCHING
   * ════════════════════════════════════════════════════════════ */

  async function fetchAllStocks() {
    if (!STATE.apiKey) { addLog('fetchAllStocks: no API key'); return; }
    addLog('Fetching all stocks...');
    const url = `https://api.torn.com/v2/torn/stocks?key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
    const data = await tornApiGet(url);
    if (!data) { addLog('fetchAllStocks: no response'); return; }
    if (data.error) { addLog('fetchAllStocks error: ' + (data.error.error || JSON.stringify(data.error))); return; }
    const stocks = data.stocks || [];
    if (!stocks.length) { addLog('fetchAllStocks: empty stocks array'); return; }
    STATE.marketStocks = stocks;
    STATE.marketFetchedAt = Date.now();
    setStorage(MARKET_KEY, { stocks, fetchedAt: STATE.marketFetchedAt });
    addLog('Fetched ' + stocks.length + ' stocks');
    takeHistorySnapshot(stocks);
    computeAllSignals();
    renderPanel();
  }

  async function fetchStockDetail(stockId) {
    if (!STATE.apiKey) return null;
    const url = `https://api.torn.com/v2/torn/${stockId}/stocks?key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
    const data = await tornApiGet(url);
    if (!data || data.error) {
      addLog('fetchStockDetail(' + stockId + ') error: ' + (data?.error?.error || 'no data'));
      return null;
    }
    return data.stocks || data;
  }

  async function fetchWatchlistDetails() {
    if (!STATE.apiKey || STATE.scanning) return;
    STATE.scanning = true;
    const stocksToFetch = [];
    const now = Date.now();
    for (const acr of STATE.watchlist) {
      const existing = STATE.stockDetails[acr];
      if (!existing || now - existing.fetchedAt > DETAIL_CACHE_TTL) {
        const stock = STATE.marketStocks.find(s => s.acronym === acr);
        if (stock) stocksToFetch.push(stock);
      }
    }
    STATE.scanTotal = stocksToFetch.length;
    STATE.scanProgress = 0;
    addLog('Fetching details for ' + stocksToFetch.length + ' watchlist stocks...');
    for (const stock of stocksToFetch) {
      const detail = await fetchStockDetail(stock.id);
      STATE.scanProgress++;
      if (detail) {
        STATE.stockDetails[stock.acronym] = { ...detail, fetchedAt: Date.now() };
        addLog('Detail fetched: ' + stock.acronym);
      }
      if (STATE.scanProgress < STATE.scanTotal) await sleep(API_DELAY_MS);
      renderPanel();
    }
    saveDetailCache();
    STATE.scanning = false;
    computeAllSignals();
    renderPanel();
  }

  async function fetchUserStocks() {
    if (!STATE.apiKey) return;
    addLog('Fetching user stocks...');
    const url = `https://api.torn.com/v2/user/stocks?key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
    const data = await tornApiGet(url);
    if (!data) { addLog('fetchUserStocks: no response'); return; }
    if (data.error) { addLog('fetchUserStocks error: ' + (data.error.error || JSON.stringify(data.error))); return; }
    STATE.userStocks = data.stocks || [];
    STATE.userFetchedAt = Date.now();
    setStorage(USER_STOCKS_KEY, { stocks: STATE.userStocks, fetchedAt: STATE.userFetchedAt });
    addLog('User owns ' + STATE.userStocks.length + ' stock(s)');
    renderPanel();
  }

  function loadCachedData() {
    const market = getStorage(MARKET_KEY, null);
    if (market) {
      STATE.marketStocks = market.stocks || [];
      STATE.marketFetchedAt = market.fetchedAt || 0;
    }
    const user = getStorage(USER_STOCKS_KEY, null);
    if (user) {
      STATE.userStocks = user.stocks || [];
      STATE.userFetchedAt = user.fetchedAt || 0;
    }
    const detail = getStorage(DETAIL_KEY, null);
    if (detail) {
      STATE.stockDetails = detail.details || {};
    }
    const hist = getStorage(HISTORY_KEY, null);
    if (hist) {
      STATE.priceHistory = hist.history || {};
      STATE.lastSnapshotAt = hist.lastSnapshotAt || 0;
    }
  }

  function saveDetailCache() {
    setStorage(DETAIL_KEY, { details: STATE.stockDetails });
  }


  /* ══════════════════════════════════════════════════════════════
   *  PRICE HISTORY & SNAPSHOTS
   * ════════════════════════════════════════════════════════════ */

  function takeHistorySnapshot(stocks) {
    const now = Date.now();
    if (now - STATE.lastSnapshotAt < HISTORY_SNAPSHOT_INTERVAL) return;
    const cutoff = now - HISTORY_MAX_AGE;
    for (const s of stocks) {
      const acr = s.acronym;
      if (!STATE.priceHistory[acr]) STATE.priceHistory[acr] = [];
      STATE.priceHistory[acr].push({ price: s.market.price, ts: now });
      /* Prune old entries */
      STATE.priceHistory[acr] = STATE.priceHistory[acr]
        .filter(p => p.ts > cutoff)
        .slice(-HISTORY_MAX_POINTS);
    }
    STATE.lastSnapshotAt = now;
    setStorage(HISTORY_KEY, { history: STATE.priceHistory, lastSnapshotAt: now });
    addLog('History snapshot taken (' + stocks.length + ' stocks)');
  }


  /* ══════════════════════════════════════════════════════════════
   *  SIGNAL COMPUTATION — Moving Averages & Trend Analysis
   * ════════════════════════════════════════════════════════════ */

  function computeSMA(prices, period) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((s, p) => s + p, 0) / period;
  }

  function computeEMA(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  function computeRSI(prices, period) {
    if (prices.length < period + 1) return null;
    const recent = prices.slice(-(period + 1));
    let gains = 0, losses = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = recent[i] - recent[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  function computeStockSignal(acronym) {
    const reasons = [];
    let score = 0; /* positive = buy, negative = sell */
    const S = STATE.settings;

    const stock = STATE.marketStocks.find(s => s.acronym === acronym);
    if (!stock) return { signal: 'HOLD', strength: 0, reasons: ['No market data'] };

    const price = stock.market.price;
    const detail = STATE.stockDetails[acronym];
    const localHistory = STATE.priceHistory[acronym] || [];
    const localPrices = localHistory.map(h => h.price);

    /* ── 1. API performance data (if detail available) ──────── */
    if (detail && detail.chart && detail.chart.performance) {
      const perf = detail.chart.performance;

      /* Short-term momentum (last hour) — low weight, noisy data */
      if (perf.last_hour) {
        const pct = perf.last_hour.change_percentage;
        if (pct > 2) { score += 0.5; reasons.push(`Hour: +${pct.toFixed(1)}% (bullish momentum)`); }
        else if (pct < -2) { score -= 0.5; reasons.push(`Hour: ${pct.toFixed(1)}% (bearish momentum)`); }
      }

      /* Day trend */
      if (perf.last_day) {
        const pct = perf.last_day.change_percentage;
        if (pct > 3) { score += 1; reasons.push(`Day: +${pct.toFixed(1)}% (strong up)`); }
        else if (pct > 0.5) { score += 0.5; reasons.push(`Day: +${pct.toFixed(1)}% (mild up)`); }
        else if (pct < -3) { score -= 1; reasons.push(`Day: ${pct.toFixed(1)}% (strong down)`); }
        else if (pct < -0.5) { score -= 0.5; reasons.push(`Day: ${pct.toFixed(1)}% (mild down)`); }
      }

      /* Week trend */
      if (perf.last_week) {
        const pct = perf.last_week.change_percentage;
        if (pct > 5) { score += 1.5; reasons.push(`Week: +${pct.toFixed(1)}% (strong uptrend)`); }
        else if (pct > 1) { score += 0.5; reasons.push(`Week: +${pct.toFixed(1)}% (uptrend)`); }
        else if (pct < -5) { score -= 1.5; reasons.push(`Week: ${pct.toFixed(1)}% (strong downtrend)`); }
        else if (pct < -1) { score -= 0.5; reasons.push(`Week: ${pct.toFixed(1)}% (downtrend)`); }
      }

      /* Month trend — heavier weight for longer trend */
      if (perf.last_month) {
        const pct = perf.last_month.change_percentage;
        if (pct > 10) { score += 2; reasons.push(`Month: +${pct.toFixed(1)}% (strong uptrend)`); }
        else if (pct > 2) { score += 1; reasons.push(`Month: +${pct.toFixed(1)}% (uptrend)`); }
        else if (pct < -10) { score -= 2; reasons.push(`Month: ${pct.toFixed(1)}% (strong downtrend)`); }
        else if (pct < -2) { score -= 1; reasons.push(`Month: ${pct.toFixed(1)}% (downtrend)`); }
      }

      /* Support/resistance from day range — symmetric weight */
      if (perf.last_day && perf.last_day.high && perf.last_day.low) {
        const range = perf.last_day.high - perf.last_day.low;
        const position = range > 0 ? (price - perf.last_day.low) / range : 0.5;
        if (position < 0.2) { score += 1; reasons.push('Near day low (support zone)'); }
        else if (position > 0.8) { score -= 1; reasons.push('Near day high (resistance zone)'); }
      }
    }

    /* ── 2. API chart history — SMA crossover ──────────────── */
    if (detail && detail.chart && detail.chart.history && detail.chart.history.length > 12) {
      const histPrices = detail.chart.history.map(h => h.price);
      const sma6 = computeSMA(histPrices, 6);
      const sma12 = computeSMA(histPrices, 12);
      if (sma6 !== null && sma12 !== null) {
        if (sma6 > sma12 * 1.01) { score += 1.5; reasons.push('SMA6 > SMA12 (bullish crossover)'); }
        else if (sma6 < sma12 * 0.99) { score -= 1.5; reasons.push('SMA6 < SMA12 (bearish crossover)'); }
      }

      /* RSI */
      const rsi = computeRSI(histPrices, 14);
      if (rsi !== null) {
        if (rsi < S.rsiOversold) { score += 2; reasons.push(`RSI ${rsi.toFixed(0)} — oversold < ${S.rsiOversold} (buy opportunity)`); }
        else if (rsi < S.rsiOversold + 10) { score += 0.5; reasons.push(`RSI ${rsi.toFixed(0)} — approaching oversold`); }
        else if (rsi > S.rsiOverbought) { score -= 2; reasons.push(`RSI ${rsi.toFixed(0)} — overbought > ${S.rsiOverbought} (sell signal)`); }
        else if (rsi > S.rsiOverbought - 10) { score -= 0.5; reasons.push(`RSI ${rsi.toFixed(0)} — approaching overbought`); }
      }

      /* Price vs EMA — trend confirmation */
      const ema12 = computeEMA(histPrices, 12);
      if (ema12 !== null) {
        const pctAbove = ((price - ema12) / ema12) * 100;
        if (pctAbove > 5) { score -= 0.5; reasons.push(`Price ${pctAbove.toFixed(1)}% above EMA12 (stretched)`); }
        else if (pctAbove < -5) { score += 0.5; reasons.push(`Price ${Math.abs(pctAbove).toFixed(1)}% below EMA12 (undervalued)`); }
      }
    }

    /* ── 3. Local history — own collected data ─────────────── */
    if (localPrices.length >= 6) {
      const localSma3 = computeSMA(localPrices, 3);
      const localSma6 = computeSMA(localPrices, 6);
      if (localSma3 !== null && localSma6 !== null) {
        if (localSma3 > localSma6 * 1.005) { score += 0.5; reasons.push('Local SMA3 > SMA6 (local uptrend)'); }
        else if (localSma3 < localSma6 * 0.995) { score -= 0.5; reasons.push('Local SMA3 < SMA6 (local downtrend)'); }
      }
    }

    /* ── 4. Benefit ROI for cash-paying stocks ─────────────── */
    const benefit = STOCK_BENEFITS[acronym];
    if (benefit && benefit.cashValue && price > 0) {
      const investmentCost = benefit.shares * price;
      const annualReturn = (benefit.cashValue / benefit.freqDays) * 365;
      const roi = (annualReturn / investmentCost) * 100;
      if (roi > S.roiGreatPct) { score += 1; reasons.push(`Benefit ROI ${roi.toFixed(1)}%/yr > ${S.roiGreatPct}% (strong passive income)`); }
      else if (roi > S.roiGoodPct) { score += 0.5; reasons.push(`Benefit ROI ${roi.toFixed(1)}%/yr > ${S.roiGoodPct}%`); }
      else if (roi < 1) { score -= 0.5; reasons.push(`Benefit ROI ${roi.toFixed(1)}%/yr < 1% (overpriced for benefit)`); }
    }

    /* ── Determine signal ─────────────────────────────────── */
    let signal, strength;
    if (score >= S.strongBuyScore) { signal = 'STRONG BUY'; strength = 5; }
    else if (score >= S.buyScore) { signal = 'BUY'; strength = 4; }
    else if (score >= S.leanBuyScore) { signal = 'LEAN BUY'; strength = 3; }
    else if (score <= S.strongSellScore) { signal = 'STRONG SELL'; strength = -5; }
    else if (score <= S.sellScore) { signal = 'SELL'; strength = -4; }
    else if (score <= S.leanSellScore) { signal = 'LEAN SELL'; strength = -3; }
    else { signal = 'HOLD'; strength = 0; }

    return { signal, strength, score, reasons };
  }

  function computeAllSignals() {
    for (const stock of STATE.marketStocks) {
      STATE.signals[stock.acronym] = computeStockSignal(stock.acronym);
    }
    addLog('Signals computed for ' + Object.keys(STATE.signals).length + ' stocks');
  }


  /* ══════════════════════════════════════════════════════════════
   *  HELPERS
   * ════════════════════════════════════════════════════════════ */

  function getSignalColor(signal) {
    if (signal.includes('STRONG BUY')) return '#00e676';
    if (signal.includes('BUY')) return '#4caf50';
    if (signal.includes('STRONG SELL') || signal.includes('STRONG AVOID')) return '#ff1744';
    if (signal.includes('SELL') || signal.includes('AVOID')) return '#f44336';
    return '#ffd740';
  }

  function getSignalIcon(signal) {
    if (signal.includes('STRONG BUY')) return '\u25B2\u25B2';
    if (signal.includes('BUY')) return '\u25B2';
    if (signal.includes('STRONG SELL') || signal.includes('STRONG AVOID')) return '\u25BC\u25BC';
    if (signal.includes('SELL') || signal.includes('AVOID')) return '\u25BC';
    return '\u25CF';
  }

  function stockLogo(stockId, size, acronym) {
    const sz = size || 22;
    const fbSz = Math.round(sz * 0.45);
    const initials = acronym ? escapeHtml(acronym.slice(0, 2)) : '?';
    return `<img src="https://yata.yt/media/stocks/${encodeURIComponent(stockId)}.png" `
      + `width="${sz}" height="${sz}" style="border-radius:4px;vertical-align:middle;object-fit:contain;background:#1a1e2a;" `
      + `onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';" />`
      + `<span style="display:none;width:${sz}px;height:${sz}px;border-radius:4px;background:#2a2e3a;color:#888;`
      + `font-size:${fbSz}px;font-weight:700;align-items:center;justify-content:center;vertical-align:middle;">${initials}</span>`;
  }

  function getChangeColor(pct) {
    if (pct > 0) return '#4caf50';
    if (pct < 0) return '#f44336';
    return '#888';
  }

  function formatPrice(p) {
    if (p == null || isNaN(p)) return '$?';
    if (p >= 1000) return '$' + Number(p).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return '$' + Number(p).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct(pct) {
    if (pct == null || isNaN(pct)) return '?%';
    const sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(2) + '%';
  }

  function formatLargeNumber(n) {
    if (n == null || isNaN(n)) return '?';
    if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  function sparkline(prices, width, height) {
    if (!prices || prices.length < 2) return '';
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const step = width / (prices.length - 1);
    const points = prices.map((p, i) => {
      const x = (i * step).toFixed(1);
      const y = (height - ((p - min) / range) * (height - 4) - 2).toFixed(1);
      return `${x},${y}`;
    }).join(' ');
    const startColor = prices[prices.length - 1] >= prices[0] ? '#4caf50' : '#f44336';
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" style="display:block;" preserveAspectRatio="xMidYMid meet">` +
      `<polyline points="${points}" fill="none" stroke="${startColor}" stroke-width="1.5" />` +
      `</svg>`;
  }

  function getUserHolding(stockId) {
    return STATE.userStocks.find(s => s.id === stockId);
  }

  function contextSignal(signal, owned) {
    if (owned) return signal;
    if (signal === 'STRONG SELL') return 'STRONG AVOID';
    if (signal === 'SELL') return 'AVOID';
    if (signal === 'LEAN SELL') return 'LEAN AVOID';
    return signal;
  }

  function getFilteredStocks() {
    let stocks = STATE.marketStocks.slice();
    const s = STATE.settings;
    if (s.showOnlyWatchlist) {
      stocks = stocks.filter(st => STATE.watchlist.includes(st.acronym));
    }
    if (s.showOnlyOwned) {
      const ownedIds = new Set(STATE.userStocks.map(u => u.id));
      stocks = stocks.filter(st => ownedIds.has(st.id));
    }
    if (s.showOnlyNotOwned) {
      const ownedIds = new Set(STATE.userStocks.map(u => u.id));
      stocks = stocks.filter(st => !ownedIds.has(st.id));
    }
    if (s.showOnlySignals) {
      stocks = stocks.filter(st => {
        const sig = STATE.signals[st.acronym];
        return sig && sig.signal !== 'HOLD';
      });
    }
    /* Sort */
    stocks.sort((a, b) => {
      const sigA = STATE.signals[a.acronym] || { strength: 0, score: 0 };
      const sigB = STATE.signals[b.acronym] || { strength: 0, score: 0 };
      let cmp = 0;
      switch (s.sortBy) {
        case 'signal': cmp = sigB.score - sigA.score; break;
        case 'change': {
          const cA = a.market?.price || 0;
          const cB = b.market?.price || 0;
          const detA = STATE.stockDetails[a.acronym];
          const detB = STATE.stockDetails[b.acronym];
          const pctA = detA?.chart?.performance?.last_day?.change_percentage || 0;
          const pctB = detB?.chart?.performance?.last_day?.change_percentage || 0;
          cmp = pctB - pctA;
          break;
        }
        case 'price': cmp = (b.market?.price || 0) - (a.market?.price || 0); break;
        case 'acronym': cmp = a.acronym.localeCompare(b.acronym); break;
        case 'roi': {
          const roiA = STOCK_BENEFITS[a.acronym] ? (STOCK_BENEFITS[a.acronym].cashValue / STOCK_BENEFITS[a.acronym].freqDays * 365) / (STOCK_BENEFITS[a.acronym].shares * (a.market?.price || 1)) * 100 : 0;
          const roiB = STOCK_BENEFITS[b.acronym] ? (STOCK_BENEFITS[b.acronym].cashValue / STOCK_BENEFITS[b.acronym].freqDays * 365) / (STOCK_BENEFITS[b.acronym].shares * (b.market?.price || 1)) * 100 : 0;
          cmp = roiB - roiA;
          break;
        }
        default: cmp = 0;
      }
      return s.sortAsc ? -cmp : cmp;
    });
    return stocks;
  }


  /* ══════════════════════════════════════════════════════════════
   *  UI — Styles, Bubble, Panel
   * ════════════════════════════════════════════════════════════ */

  function ensureStyles() {
    if (document.getElementById('tpda-stock-styles')) return;
    const style = document.createElement('style');
    style.id = 'tpda-stock-styles';
    style.textContent = `
      #${BUBBLE_ID} { position:fixed; width:${BUBBLE_SIZE}px; height:${BUBBLE_SIZE}px; border-radius:50%;
        background:linear-gradient(135deg,#f4b740,#e09520); display:flex; align-items:center; justify-content:center;
        cursor:pointer; font-weight:900; font-size:18px; color:#1a1a2e; box-shadow:0 4px 16px rgba(244,183,64,.5);
        user-select:none; touch-action:none; z-index:${STATE.ui.zIndexBase}; transition:box-shadow .2s; }
      #${BUBBLE_ID}:hover { box-shadow:0 4px 24px rgba(244,183,64,.8); }
      #${PANEL_ID} { position:fixed; width:400px; max-width:95vw; max-height:85vh; display:none; flex-direction:column;
        background:#0d0f14; border:1px solid #2f3340; border-radius:14px; overflow:hidden;
        box-shadow:0 8px 32px rgba(0,0,0,.6); z-index:${STATE.ui.zIndexBase + 1};
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:13px; color:#fff; }
      #${HEADER_ID} { display:flex; align-items:center; justify-content:space-between; padding:10px 14px;
        background:#141821; border-bottom:1px solid #2f3340; cursor:grab; user-select:none; touch-action:none; }
      .tpda-stock-body { flex:1; overflow-y:auto; padding:10px; }
      .tpda-stock-card { margin-bottom:8px; padding:10px; border:1px solid #2f3340; border-radius:10px; background:#141821; }
      .tpda-stock-row { display:flex; align-items:center; justify-content:space-between; padding:6px 10px;
        border-bottom:1px solid #1e222d; cursor:pointer; transition:background .15s; }
      .tpda-stock-row:hover { background:#1a1e2a; }
      .tpda-stock-row:last-child { border-bottom:none; }
      .tpda-stock-tabs { display:flex; gap:2px; padding:0 10px 8px; }
      .tpda-stock-tab { flex:1; padding:6px 0; text-align:center; border-radius:8px; cursor:pointer;
        background:#1a1e2a; color:#888; font-size:12px; font-weight:600; transition:all .15s; }
      .tpda-stock-tab.active { background:#2a6df4; color:#fff; }
      .tpda-stock-btn { border:none; border-radius:8px; padding:6px 12px; cursor:pointer; font-size:12px; font-weight:600; }
      .tpda-stock-badge { display:inline-block; padding:2px 6px; border-radius:6px; font-size:11px; font-weight:700; }
    `;
    document.head.appendChild(style);
  }

  function createBubble() {
    if (getBubbleEl()) return;
    const el = document.createElement('div');
    el.id = BUBBLE_ID;
    el.setAttribute('data-tpda-bubble', '1');
    el.textContent = '$';
    const pos = getBubblePosition();
    const lt = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
    const clamped = clampToViewport(lt.left, lt.top, BUBBLE_SIZE, BUBBLE_SIZE);
    const safe = leftTopToBubbleRightBottom(clamped.left, clamped.top, BUBBLE_SIZE);
    el.style.right = safe.right + 'px';
    el.style.bottom = safe.bottom + 'px';
    document.body.appendChild(el);
    makeDraggableBubble(el);
    el.addEventListener('click', (e) => {
      if (el.dataset.dragged === '1') { el.dataset.dragged = '0'; return; }
      expandPanelNearBubble();
    });
  }

  function createPanel() {
    if (getPanelEl()) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div id="${HEADER_ID}">
        <div style="font-weight:700;font-size:14px;">\u{1F4C8} Stock Trader</div>
        <button class="tpda-stock-close" style="background:none;border:none;color:#aaa;font-size:20px;cursor:pointer;padding:0 4px;">\u2715</button>
      </div>
      <div class="tpda-stock-body"></div>
    `;
    document.body.appendChild(panel);
    const header = document.getElementById(HEADER_ID);
    makeDraggablePanel(panel, header);
    /* Delegated click handlers — attached ONCE */
    panel.querySelector('.tpda-stock-close').onclick = () => collapseToBubble();
    const body = panel.querySelector('.tpda-stock-body');
    body.addEventListener('click', (e) => {
      if (handleApiKeyClick(e, body, () => renderPanel())) return;
      if (handleLogClick(e, body)) return;
      handlePanelClick(e, body);
    });
    body.addEventListener('change', (e) => {
      const numInput = e.target.closest('.tpda-stock-num-setting');
      if (numInput) {
        const val = parseFloat(numInput.value);
        if (!isNaN(val)) {
          STATE.settings[numInput.dataset.key] = val;
          saveSettings();
          computeAllSignals();
          addLog('Setting ' + numInput.dataset.key + ' = ' + val);
        }
      }
      const sortSel = e.target.closest('.tpda-stock-sort');
      if (sortSel) {
        STATE.settings.sortBy = sortSel.value;
        saveSettings();
        renderPanel();
      }
    });
  }


  /* ══════════════════════════════════════════════════════════════
   *  RENDER PANEL
   * ════════════════════════════════════════════════════════════ */

  function renderPanel() {
    const panel = getPanelEl();
    if (!panel || STATE.ui.minimized) return;
    const body = panel.querySelector('.tpda-stock-body');
    if (!body) return;

    let html = '';

    /* ── API Key card ──────────────────────────────────────── */
    html += renderApiKeyCard();

    /* ── Tabs ──────────────────────────────────────────────── */
    html += `<div class="tpda-stock-tabs">
      <div class="tpda-stock-tab ${STATE.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</div>
      <div class="tpda-stock-tab ${STATE.activeTab === 'holdings' ? 'active' : ''}" data-tab="holdings">Holdings</div>
      <div class="tpda-stock-tab ${STATE.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</div>
    </div>`;

    /* ── Status bar ────────────────────────────────────────── */
    if (STATE.scanning) {
      html += `<div style="padding:4px 10px;font-size:11px;color:#ffd740;">Scanning ${STATE.scanProgress}/${STATE.scanTotal}...</div>`;
    } else if (STATE.marketFetchedAt) {
      const signalCount = Object.values(STATE.signals).filter(s => s.signal !== 'HOLD').length;
      html += `<div style="padding:4px 10px;font-size:11px;color:#888;">
        ${STATE.marketStocks.length} stocks \u2022 ${signalCount} signals \u2022 Updated ${ageText(STATE.marketFetchedAt)}
        <span class="tpda-stock-refresh" style="color:#2a6df4;cursor:pointer;margin-left:8px;">\u21BB Refresh</span>
      </div>`;
    }

    /* ── Tab content ───────────────────────────────────────── */
    if (STATE.activeTab === 'overview') {
      html += renderOverviewTab();
    } else if (STATE.activeTab === 'detail' && STATE.detailStock) {
      html += renderDetailTab();
    } else if (STATE.activeTab === 'holdings') {
      html += renderHoldingsTab();
    } else if (STATE.activeTab === 'settings') {
      html += renderSettingsTab();
    }

    /* ── Debug log ─────────────────────────────────────────── */
    html += renderLogCard();

    body.innerHTML = html;
  }

  function renderOverviewTab() {
    if (!STATE.marketStocks.length) {
      return `<div class="tpda-stock-card" style="color:#888;text-align:center;">
        ${STATE.apiKey ? 'Loading stock data...' : 'Enter your API key above to start tracking stocks.'}
      </div>`;
    }

    const stocks = getFilteredStocks();
    let html = '';

    /* Filter toggles */
    html += `<div style="padding:0 0 8px;display:flex;gap:6px;flex-wrap:wrap;">
      <label style="font-size:11px;color:#aaa;cursor:pointer;">
        <input type="checkbox" class="tpda-stock-filter" data-filter="showOnlyWatchlist" ${STATE.settings.showOnlyWatchlist ? 'checked' : ''} style="margin-right:3px;" />Watchlist
      </label>
      <label style="font-size:11px;color:#aaa;cursor:pointer;">
        <input type="checkbox" class="tpda-stock-filter" data-filter="showOnlyOwned" ${STATE.settings.showOnlyOwned ? 'checked' : ''} style="margin-right:3px;" />Owned
      </label>
      <label style="font-size:11px;color:#aaa;cursor:pointer;">
        <input type="checkbox" class="tpda-stock-filter" data-filter="showOnlyNotOwned" ${STATE.settings.showOnlyNotOwned ? 'checked' : ''} style="margin-right:3px;" />Not Owned
      </label>
      <label style="font-size:11px;color:#aaa;cursor:pointer;">
        <input type="checkbox" class="tpda-stock-filter" data-filter="showOnlySignals" ${STATE.settings.showOnlySignals ? 'checked' : ''} style="margin-right:3px;" />Signals Only
      </label>
      <select class="tpda-stock-sort" style="background:#1a1e2a;color:#bbb;border:1px solid #333;border-radius:6px;font-size:11px;padding:2px 6px;margin-left:auto;">
        <option value="signal" ${STATE.settings.sortBy === 'signal' ? 'selected' : ''}>Sort: Signal</option>
        <option value="change" ${STATE.settings.sortBy === 'change' ? 'selected' : ''}>Sort: Change%</option>
        <option value="price" ${STATE.settings.sortBy === 'price' ? 'selected' : ''}>Sort: Price</option>
        <option value="acronym" ${STATE.settings.sortBy === 'acronym' ? 'selected' : ''}>Sort: Name</option>
        <option value="roi" ${STATE.settings.sortBy === 'roi' ? 'selected' : ''}>Sort: Benefit ROI</option>
      </select>
    </div>`;

    /* Stock rows */
    html += `<div class="tpda-stock-card" style="padding:0;">`;
    for (const stock of stocks) {
      const sig = STATE.signals[stock.acronym] || { signal: 'HOLD', strength: 0 };
      const detail = STATE.stockDetails[stock.acronym];
      const dayPct = detail?.chart?.performance?.last_day?.change_percentage;
      const history = (detail?.chart?.history || []).map(h => h.price);
      const isWatchlisted = STATE.watchlist.includes(stock.acronym);
      const holding = getUserHolding(stock.id);
      const label = contextSignal(sig.signal, !!holding);

      let pnlNote = '';
      if (holding && sig.strength < 0 && holding.transactions && holding.transactions.length) {
        const lastTx = holding.transactions[holding.transactions.length - 1];
        const pnl = (stock.market.price - lastTx.price) * holding.shares;
        const pnlPct = lastTx.price > 0 ? ((stock.market.price - lastTx.price) / lastTx.price) * 100 : 0;
        pnlNote = `<div style="font-size:10px;color:${pnl >= 0 ? '#4caf50' : '#f44336'};margin-top:1px;">P&L: ${formatMoney(pnl)} (${formatPct(pnlPct)})</div>`;
      }

      html += `<div class="tpda-stock-row" data-stock="${escapeHtml(stock.acronym)}">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;">
            ${stockLogo(stock.id, 22, stock.acronym)}
            <span style="font-weight:700;color:${isWatchlisted ? '#ffd740' : '#fff'};">${escapeHtml(stock.acronym)}</span>
            ${holding ? '<span style="font-size:10px;color:#4caf50;">\u25CF owned</span>' : ''}
            <span style="font-size:11px;color:#888;">${escapeHtml(stock.name || '')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
            <span style="font-size:12px;">${formatPrice(stock.market.price)}</span>
            ${dayPct != null ? `<span style="font-size:11px;color:${getChangeColor(dayPct)};">${formatPct(dayPct)}</span>` : ''}
            ${history.length > 2 ? sparkline(history.slice(-30), 60, 18) : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <span class="tpda-stock-badge" style="background:${getSignalColor(label)}22;color:${getSignalColor(label)};">
            ${getSignalIcon(label)} ${escapeHtml(label)}
          </span>
          ${pnlNote}
        </div>
      </div>`;
    }
    html += `</div>`;

    if (!stocks.length) {
      html += `<div style="color:#888;text-align:center;padding:12px;">No stocks match your filters.</div>`;
    }

    return html;
  }

  function renderDetailTab() {
    const acronym = STATE.detailStock;
    const stock = STATE.marketStocks.find(s => s.acronym === acronym);
    if (!stock) return `<div class="tpda-stock-card" style="color:#888;">Stock not found.</div>`;

    const detail = STATE.stockDetails[acronym];
    const sig = STATE.signals[acronym] || { signal: 'HOLD', strength: 0, reasons: [] };
    const holding = getUserHolding(stock.id);
    const benefit = STOCK_BENEFITS[acronym];
    const isWatchlisted = STATE.watchlist.includes(acronym);
    const label = contextSignal(sig.signal, !!holding);

    let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <button class="tpda-stock-btn tpda-stock-back" style="background:#2a2e3a;color:#fff;">\u2190 Back</button>
      ${stockLogo(stock.id, 28, acronym)}
      <span style="font-weight:700;font-size:16px;">${escapeHtml(acronym)}</span>
      <span style="color:#888;">${escapeHtml(stock.name || '')}</span>
      <button class="tpda-stock-btn tpda-stock-watchlist-toggle" data-acr="${escapeHtml(acronym)}"
        style="background:${isWatchlisted ? '#ffd740' : '#2a2e3a'};color:${isWatchlisted ? '#1a1a2e' : '#888'};margin-left:auto;">
        ${isWatchlisted ? '\u2605 Watching' : '\u2606 Watch'}
      </button>
    </div>`;

    /* Price & signal card */
    html += `<div class="tpda-stock-card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:22px;font-weight:700;">${formatPrice(stock.market.price)}</div>
          <div style="font-size:12px;color:#888;">Cap: ${formatLargeNumber(stock.market.cap)} \u2022 Investors: ${formatNumber(stock.market.investors)}</div>
        </div>
        <div style="text-align:right;">
          <div class="tpda-stock-badge" style="background:${getSignalColor(label)}22;color:${getSignalColor(label)};font-size:14px;padding:4px 10px;">
            ${getSignalIcon(label)} ${escapeHtml(label)}
          </div>
          <div style="font-size:11px;color:#888;margin-top:4px;">Score: ${sig.score?.toFixed(1) || '0'}</div>
        </div>
      </div>
    </div>`;

    /* Chart */
    if (detail && detail.chart && detail.chart.history && detail.chart.history.length > 2) {
      const prices = detail.chart.history.map(h => h.price);
      html += `<div class="tpda-stock-card" style="text-align:center;">
        <div style="font-size:11px;color:#888;margin-bottom:4px;">Price History (${prices.length} points)</div>
        ${sparkline(prices, 360, 60)}
      </div>`;
    }

    /* Performance table */
    if (detail && detail.chart && detail.chart.performance) {
      const perf = detail.chart.performance;
      const periods = [
        ['1 Hour', perf.last_hour],
        ['1 Day', perf.last_day],
        ['1 Week', perf.last_week],
        ['1 Month', perf.last_month],
        ['1 Year', perf.last_year],
        ['All Time', perf.all_time]
      ];
      html += `<div class="tpda-stock-card">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Performance</div>
        <table style="width:100%;font-size:11px;border-collapse:collapse;color:#ccc;">
          <tr style="color:#888;"><th style="text-align:left;padding:2px 4px;">Period</th><th style="text-align:right;padding:2px 4px;">Change</th><th style="text-align:right;padding:2px 4px;">High</th><th style="text-align:right;padding:2px 4px;">Low</th></tr>`;
      for (const [label, p] of periods) {
        if (!p) continue;
        html += `<tr>
          <td style="padding:2px 4px;color:#ccc;">${label}</td>
          <td style="padding:2px 4px;text-align:right;color:${getChangeColor(p.change_percentage)};">${formatPct(p.change_percentage)}</td>
          <td style="padding:2px 4px;text-align:right;color:#ccc;">${formatPrice(p.high)}</td>
          <td style="padding:2px 4px;text-align:right;color:#ccc;">${formatPrice(p.low)}</td>
        </tr>`;
      }
      html += `</table></div>`;
    }

    /* Signal analysis */
    if (sig.reasons && sig.reasons.length) {
      html += `<div class="tpda-stock-card">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Signal Analysis</div>`;
      for (const reason of sig.reasons) {
        html += `<div style="font-size:11px;color:#bbb;padding:2px 0;">\u2022 ${escapeHtml(reason)}</div>`;
      }
      if (holding && sig.strength < 0 && holding.transactions && holding.transactions.length) {
        const lastTx = holding.transactions[holding.transactions.length - 1];
        const pnlPct = lastTx.price > 0 ? ((stock.market.price - lastTx.price) / lastTx.price) * 100 : 0;
        if (pnlPct < 0) {
          html += `<div style="font-size:11px;color:#ffd740;padding:4px 0 0;border-top:1px solid #2f3340;margin-top:4px;">\u26A0 You own this stock at ${formatPct(pnlPct)} P&L. Selling now locks in losses.</div>`;
        }
      }
      if (!holding && sig.strength < 0) {
        html += `<div style="font-size:11px;color:#888;padding:4px 0 0;border-top:1px solid #2f3340;margin-top:4px;">You don't own this stock \u2014 signal means "avoid buying."</div>`;
      }
      html += `</div>`;
    }

    /* User holding */
    if (holding) {
      const totalValue = holding.shares * stock.market.price;
      html += `<div class="tpda-stock-card">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Your Position</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
          <span>Shares:</span><span>${formatNumber(holding.shares)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
          <span>Value:</span><span>${formatMoney(totalValue)}</span>
        </div>`;
      if (holding.bonus) {
        html += `<div style="display:flex;justify-content:space-between;font-size:12px;">
          <span>Bonus:</span><span>${holding.bonus.available ? '\u2705 Available' : `Progress: ${holding.bonus.progress}/${holding.bonus.frequency} days`}</span>
        </div>`;
      }
      if (holding.transactions && holding.transactions.length) {
        const lastTx = holding.transactions[holding.transactions.length - 1];
        const avgBuy = lastTx.price;
        const pnl = (stock.market.price - avgBuy) * holding.shares;
        const pnlPct = avgBuy > 0 ? ((stock.market.price - avgBuy) / avgBuy) * 100 : 0;
        html += `<div style="display:flex;justify-content:space-between;font-size:12px;">
          <span>Last buy price:</span><span>${formatPrice(avgBuy)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
          <span>Unrealized P&L:</span><span style="color:${pnl >= 0 ? '#4caf50' : '#f44336'};">${formatMoney(pnl)} (${formatPct(pnlPct)})</span>
        </div>`;
      }
      html += `</div>`;
    }

    /* Benefit info */
    if (benefit) {
      const investmentCost = benefit.shares * stock.market.price;
      const annualReturn = (benefit.cashValue / benefit.freqDays) * 365;
      const roi = investmentCost > 0 ? (annualReturn / investmentCost) * 100 : 0;
      const paybackDays = annualReturn > 0 ? (investmentCost / annualReturn) * 365 : 0;
      html += `<div class="tpda-stock-card">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Benefit Block</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>Required:</span><span>${formatNumber(benefit.shares)} shares</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>Investment:</span><span>${formatMoney(investmentCost)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>Payout:</span><span>${benefit.label}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>Annual ROI:</span><span style="color:${roi > 3 ? '#4caf50' : '#ffd740'};">${roi.toFixed(2)}%</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>Payback:</span><span>${paybackDays.toFixed(0)} days</span></div>
      </div>`;
    }

    /* Technical indicators card */
    if (detail && detail.chart && detail.chart.history && detail.chart.history.length > 6) {
      const prices = detail.chart.history.map(h => h.price);
      const sma6 = computeSMA(prices, 6);
      const sma12 = computeSMA(prices, 12);
      const ema12 = computeEMA(prices, 12);
      const rsi = computeRSI(prices, 14);
      html += `<div class="tpda-stock-card">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Technical Indicators</div>`;
      if (sma6 !== null) html += `<div style="display:flex;justify-content:space-between;font-size:12px;"><span>SMA-6:</span><span>${formatPrice(sma6)}</span></div>`;
      if (sma12 !== null) html += `<div style="display:flex;justify-content:space-between;font-size:12px;"><span>SMA-12:</span><span>${formatPrice(sma12)}</span></div>`;
      if (ema12 !== null) html += `<div style="display:flex;justify-content:space-between;font-size:12px;"><span>EMA-12:</span><span>${formatPrice(ema12)}</span></div>`;
      if (rsi !== null) {
        const rsiColor = rsi < 30 ? '#4caf50' : rsi > 70 ? '#f44336' : '#ffd740';
        html += `<div style="display:flex;justify-content:space-between;font-size:12px;"><span>RSI-14:</span><span style="color:${rsiColor};">${rsi.toFixed(1)}</span></div>`;
      }
      html += `</div>`;
    }

    return html;
  }

  function renderHoldingsTab() {
    if (!STATE.userStocks.length) {
      return `<div class="tpda-stock-card" style="color:#888;text-align:center;">
        ${STATE.apiKey ? 'No stock holdings found. Buy stocks on the Torn stock market!' : 'Enter your API key to see your holdings.'}
      </div>`;
    }

    let totalValue = 0;
    let totalPnl = 0;
    let html = '';

    for (const us of STATE.userStocks) {
      const stock = STATE.marketStocks.find(s => s.id === us.id);
      if (!stock) continue;
      const value = us.shares * stock.market.price;
      totalValue += value;
      const sig = STATE.signals[stock.acronym] || { signal: 'HOLD', strength: 0 };

      let pnl = 0, pnlPct = 0;
      if (us.transactions && us.transactions.length) {
        const lastTx = us.transactions[us.transactions.length - 1];
        pnl = (stock.market.price - lastTx.price) * us.shares;
        pnlPct = lastTx.price > 0 ? ((stock.market.price - lastTx.price) / lastTx.price) * 100 : 0;
        totalPnl += pnl;
      }

      html += `<div class="tpda-stock-card" style="cursor:pointer;" data-stock="${escapeHtml(stock.acronym)}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:6px;">
            ${stockLogo(stock.id, 22, stock.acronym)}
            <span style="font-weight:700;">${escapeHtml(stock.acronym)}</span>
            <span style="font-size:11px;color:#888;">${escapeHtml(stock.name || '')}</span>
          </div>
          <span class="tpda-stock-badge" style="background:${getSignalColor(sig.signal)}22;color:${getSignalColor(sig.signal)};">
            ${getSignalIcon(sig.signal)} ${escapeHtml(sig.signal)}
          </span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:12px;">
          <span>${formatNumber(us.shares)} shares @ ${formatPrice(stock.market.price)}</span>
          <span>${formatMoney(value)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:2px;font-size:11px;">
          <span style="color:#888;">P&L</span>
          <span style="color:${pnl >= 0 ? '#4caf50' : '#f44336'};">${formatMoney(pnl)} (${formatPct(pnlPct)})</span>
        </div>
        ${pnl < 0 && sig.strength < 0 ? `<div style="font-size:10px;color:#ffd740;margin-top:3px;">\u26A0 Bearish trend \u2014 consider holding for recovery or cutting losses</div>` : ''}
        ${us.bonus ? `<div style="font-size:11px;color:#888;margin-top:2px;">Bonus: ${us.bonus.available ? '\u2705 Ready' : us.bonus.progress + '/' + us.bonus.frequency + ' days'}</div>` : ''}
      </div>`;
    }

    /* Portfolio summary */
    const summaryHtml = `<div class="tpda-stock-card" style="background:#1a1e2a;">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;">
        <span>Portfolio Value</span><span>${formatMoney(totalValue)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;">
        <span>Total P&L</span><span style="color:${totalPnl >= 0 ? '#4caf50' : '#f44336'};">${formatMoney(totalPnl)}</span>
      </div>
      <div style="font-size:11px;color:#888;margin-top:4px;">${STATE.userStocks.length} position(s) \u2022 Updated ${ageText(STATE.userFetchedAt)}</div>
    </div>`;

    return summaryHtml + html;
  }

  function settingRow(label, key, step, min, max) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#bbb;margin-bottom:4px;">
      <span>${label}</span>
      <input type="number" class="tpda-stock-num-setting" data-key="${key}" value="${STATE.settings[key]}"
        step="${step}" ${min != null ? 'min="' + min + '"' : ''} ${max != null ? 'max="' + max + '"' : ''}
        style="width:64px;background:#0f1116;color:#fff;border:1px solid #444;border-radius:6px;padding:3px 6px;font-size:12px;text-align:right;" />
    </div>`;
  }

  function renderSettingsTab() {
    let html = '';

    /* Signal score thresholds */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Signal Thresholds</div>
      <div style="font-size:10px;color:#666;margin-bottom:6px;">Score needed to trigger each signal level</div>
      ${settingRow('Strong Buy \u2265', 'strongBuyScore', 0.5, 0)}
      ${settingRow('Buy \u2265', 'buyScore', 0.5, 0)}
      ${settingRow('Lean Buy \u2265', 'leanBuyScore', 0.1, 0)}
      ${settingRow('Lean Sell \u2264', 'leanSellScore', 0.1, null, 0)}
      ${settingRow('Sell \u2264', 'sellScore', 0.5, null, 0)}
      ${settingRow('Strong Sell \u2264', 'strongSellScore', 0.5, null, 0)}
    </div>`;

    /* RSI thresholds */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">RSI Thresholds</div>
      ${settingRow('Oversold below', 'rsiOversold', 5, 5, 50)}
      ${settingRow('Overbought above', 'rsiOverbought', 5, 50, 95)}
    </div>`;

    /* Benefit ROI thresholds */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Benefit ROI</div>
      <div style="font-size:10px;color:#666;margin-bottom:6px;">Annual ROI % to boost buy signal for dividend stocks</div>
      ${settingRow('Good ROI \u2265', 'roiGoodPct', 0.5, 0)}
      ${settingRow('Great ROI \u2265', 'roiGreatPct', 0.5, 0)}
    </div>`;

    /* Watchlist management */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Watchlist (${STATE.watchlist.length} stocks)</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">`;
    for (const acr of STATE.watchlist) {
      html += `<span class="tpda-stock-badge tpda-stock-watchlist-remove" data-acr="${escapeHtml(acr)}"
        style="background:#ffd74033;color:#ffd740;cursor:pointer;">${escapeHtml(acr)} \u2715</span>`;
    }
    html += `</div>
      <div style="display:flex;gap:6px;">
        <input class="tpda-stock-watchlist-input" type="text" placeholder="Add ticker (e.g. TCT)"
          style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:8px;padding:6px 8px;font-size:12px;text-transform:uppercase;" />
        <button class="tpda-stock-btn tpda-stock-watchlist-add" style="background:#2a6df4;color:#fff;">Add</button>
      </div>
      <button class="tpda-stock-btn tpda-stock-watchlist-reset" style="background:#2a2e3a;color:#888;margin-top:6px;width:100%;">Reset to Defaults</button>
    </div>`;

    /* Notification settings */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Notifications</div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#bbb;cursor:pointer;margin-bottom:4px;">
        <input type="checkbox" class="tpda-stock-setting" data-key="notifyEnabled" ${STATE.settings.notifyEnabled ? 'checked' : ''} /> Enable notifications
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#bbb;cursor:pointer;margin-bottom:4px;">
        <input type="checkbox" class="tpda-stock-setting" data-key="notifyOnBuy" ${STATE.settings.notifyOnBuy ? 'checked' : ''} /> Notify on BUY signals
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#bbb;cursor:pointer;">
        <input type="checkbox" class="tpda-stock-setting" data-key="notifyOnSell" ${STATE.settings.notifyOnSell ? 'checked' : ''} /> Notify on SELL signals
      </label>
    </div>`;

    /* Data management */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Data</div>
      <div style="font-size:11px;color:#888;margin-bottom:6px;">
        History: ${Object.keys(STATE.priceHistory).length} stocks tracked \u2022 Last snapshot ${STATE.lastSnapshotAt ? ageText(STATE.lastSnapshotAt) : 'never'}<br/>
        Details cached: ${Object.keys(STATE.stockDetails).length} stocks
      </div>
      <div style="display:flex;gap:6px;">
        <button class="tpda-stock-btn tpda-stock-fetch-details" style="background:#2a6df4;color:#fff;flex:1;">Fetch Watchlist Details</button>
        <button class="tpda-stock-btn tpda-stock-clear-history" style="background:#f4433633;color:#f44336;flex:1;">Clear History</button>
      </div>
    </div>`;

    return html;
  }


  /* ══════════════════════════════════════════════════════════════
   *  EVENT HANDLING
   * ════════════════════════════════════════════════════════════ */

  function handlePanelClick(e, body) {
    /* Tab switch */
    const tab = e.target.closest('.tpda-stock-tab');
    if (tab) {
      STATE.activeTab = tab.dataset.tab;
      renderPanel();
      return;
    }

    /* Refresh */
    if (e.target.closest('.tpda-stock-refresh')) {
      STATE.marketFetchedAt = 0;
      STATE.userFetchedAt = 0;
      refreshIfStale();
      return;
    }

    /* Back from detail */
    if (e.target.closest('.tpda-stock-back')) {
      STATE.activeTab = STATE.previousTab || 'overview';
      STATE.detailStock = null;
      renderPanel();
      return;
    }

    /* Stock row click → detail */
    const stockRow = e.target.closest('[data-stock]');
    if (stockRow) {
      STATE.previousTab = STATE.activeTab;
      STATE.detailStock = stockRow.dataset.stock;
      STATE.activeTab = 'detail';
      renderPanel();
      /* Fetch detail if not cached */
      const detail = STATE.stockDetails[STATE.detailStock];
      if (!detail || Date.now() - detail.fetchedAt > DETAIL_CACHE_TTL) {
        const stock = STATE.marketStocks.find(s => s.acronym === STATE.detailStock);
        if (stock) {
          fetchStockDetail(stock.id).then(d => {
            if (d) {
              STATE.stockDetails[STATE.detailStock] = { ...d, fetchedAt: Date.now() };
              saveDetailCache();
              computeAllSignals();
              renderPanel();
            }
          });
        }
      }
      return;
    }

    /* Watchlist toggle */
    const wlToggle = e.target.closest('.tpda-stock-watchlist-toggle');
    if (wlToggle) {
      const acr = wlToggle.dataset.acr;
      const idx = STATE.watchlist.indexOf(acr);
      if (idx >= 0) STATE.watchlist.splice(idx, 1);
      else STATE.watchlist.push(acr);
      saveWatchlist();
      renderPanel();
      return;
    }

    /* Watchlist remove badge */
    const wlRemove = e.target.closest('.tpda-stock-watchlist-remove');
    if (wlRemove) {
      const acr = wlRemove.dataset.acr;
      const idx = STATE.watchlist.indexOf(acr);
      if (idx >= 0) STATE.watchlist.splice(idx, 1);
      saveWatchlist();
      renderPanel();
      return;
    }

    /* Watchlist add */
    if (e.target.closest('.tpda-stock-watchlist-add')) {
      const input = body.querySelector('.tpda-stock-watchlist-input');
      const acr = String(input?.value || '').trim().toUpperCase();
      if (acr && !STATE.watchlist.includes(acr)) {
        const exists = STATE.marketStocks.find(s => s.acronym === acr);
        if (exists) {
          STATE.watchlist.push(acr);
          saveWatchlist();
          addLog('Added ' + acr + ' to watchlist');
        } else {
          addLog('Unknown ticker: ' + acr);
        }
      }
      renderPanel();
      return;
    }

    /* Watchlist reset */
    if (e.target.closest('.tpda-stock-watchlist-reset')) {
      STATE.watchlist = DEFAULT_WATCHLIST.slice();
      saveWatchlist();
      addLog('Watchlist reset to defaults');
      renderPanel();
      return;
    }

    /* Fetch watchlist details */
    if (e.target.closest('.tpda-stock-fetch-details')) {
      fetchWatchlistDetails();
      return;
    }

    /* Clear history */
    if (e.target.closest('.tpda-stock-clear-history')) {
      STATE.priceHistory = {};
      STATE.lastSnapshotAt = 0;
      setStorage(HISTORY_KEY, { history: {}, lastSnapshotAt: 0 });
      addLog('Price history cleared');
      renderPanel();
      return;
    }

    /* Filter checkboxes */
    const filterCb = e.target.closest('.tpda-stock-filter');
    if (filterCb) {
      const key = filterCb.dataset.filter;
      STATE.settings[key] = filterCb.checked;
      if (key === 'showOnlyOwned' && filterCb.checked) STATE.settings.showOnlyNotOwned = false;
      if (key === 'showOnlyNotOwned' && filterCb.checked) STATE.settings.showOnlyOwned = false;
      saveSettings();
      renderPanel();
      return;
    }

    /* Settings checkboxes */
    const settingCb = e.target.closest('.tpda-stock-setting');
    if (settingCb) {
      STATE.settings[settingCb.dataset.key] = settingCb.checked;
      saveSettings();
      if (settingCb.dataset.key === 'notifyEnabled' && settingCb.checked) {
        tpdaRequestNotifyPermission();
      }
      return;
    }

    /* Number setting inputs — handled on click of +/- spinner */
    const numInput = e.target.closest('.tpda-stock-num-setting');
    if (numInput) {
      const val = parseFloat(numInput.value);
      if (!isNaN(val)) {
        STATE.settings[numInput.dataset.key] = val;
        saveSettings();
        computeAllSignals();
      }
      return;
    }

    /* Sort dropdown */
    const sortSel = e.target.closest('.tpda-stock-sort');
    if (sortSel) {
      STATE.settings.sortBy = sortSel.value;
      saveSettings();
      renderPanel();
      return;
    }
  }


  /* ══════════════════════════════════════════════════════════════
   *  NOTIFICATION CHECK
   * ════════════════════════════════════════════════════════════ */

  function checkNotifications() {
    if (!STATE.settings.notifyEnabled) return;
    for (const acr of STATE.watchlist) {
      const sig = STATE.signals[acr];
      if (!sig) continue;
      const stock = STATE.marketStocks.find(s => s.acronym === acr);
      const owned = stock ? !!getUserHolding(stock.id) : false;
      const label = contextSignal(sig.signal, owned);
      if (STATE.settings.notifyOnBuy && sig.signal.includes('BUY')) {
        tpdaNotify('stock_buy_' + acr, 'Stock BUY Signal: ' + acr,
          label + ' \u2014 ' + (sig.reasons[0] || ''), 30 * 60 * 1000);
      }
      if (STATE.settings.notifyOnSell && sig.signal.includes('SELL')) {
        tpdaNotify('stock_sell_' + acr, 'Stock ' + (owned ? 'SELL' : 'AVOID') + ' Signal: ' + acr,
          label + ' \u2014 ' + (sig.reasons[0] || ''), 30 * 60 * 1000);
      }
    }
  }


  /* ══════════════════════════════════════════════════════════════
   *  INIT
   * ════════════════════════════════════════════════════════════ */

  function initApiKey(pdaKey) {
    /* Priority 1: PDA injection */
    if (pdaKey && pdaKey.length >= 16 && !pdaKey.includes('#')) {
      STATE.apiKey = pdaKey;
      STATE.apiKeySource = 'pda';
      addLog('API key from Torn PDA');
      return;
    }
    /* Priority 2: shared manual key */
    const shared = getSharedApiKey();
    if (shared) {
      STATE.apiKey = shared;
      STATE.apiKeySource = 'manual';
      addLog('API key from shared storage');
      return;
    }
    addLog('No API key — will intercept from traffic');
  }

  async function init() {
    initApiKey(PDA_INJECTED_KEY);
    loadCachedData();
    ensureStyles();
    createBubble();
    createPanel();
    window.addEventListener('resize', onResize);
    addLog('Stock Trader initialized');
    if (STATE.marketStocks.length) {
      computeAllSignals();
    }
  }

  hookFetch();
  hookXHR();
  setTimeout(init, 1200);
})();
