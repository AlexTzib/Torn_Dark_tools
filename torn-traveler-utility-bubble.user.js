// ==UserScript==
// @name         Dark Tools - Traveler Utility
// @namespace    alex.torn.pda.traveler.bubble
// @version      1.4.0
// @description  Quick-travel buttons for Mexico, Cayman, Canada, Switzerland. Learns actual flight times (PI-aware). Auto-expands destination on travel page. Live hospital timer, live flight ETA, abroad shop links, Swiss Bank & Rehab info.
// @author       Alex + Devin
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-traveler-utility-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-traveler-utility-bubble.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PDA_INJECTED_KEY = '###PDA-APIKEY###';

  const SCRIPT_KEY = 'tpda_traveler_v1';
  const BUBBLE_ID = 'tpda-traveler-bubble';
  const PANEL_ID = 'tpda-traveler-panel';
  const HEADER_ID = 'tpda-traveler-header';
  const BUBBLE_SIZE = 56;

  /* ── Country data ────────────────────────────────────────── */

  const COUNTRIES = [
    { id: 'mexico',      name: 'Mexico',          flag: '\uD83C\uDDF2\uD83C\uDDFD', color: '#4caf50', items: 'Plushies',           flyTime: '~26 min' },
    { id: 'cayman',      name: 'Cayman Islands',   flag: '\uD83C\uDDF0\uD83C\uDDFE', color: '#42a5f5', items: 'Banking',            flyTime: '~35 min' },
    { id: 'canada',      name: 'Canada',           flag: '\uD83C\uDDE8\uD83C\uDDE6', color: '#e67e22', items: 'Flowers',            flyTime: '~41 min' },
    { id: 'switzerland', name: 'Switzerland',       flag: '\uD83C\uDDE8\uD83C\uDDED', color: '#dc143c', items: 'Swiss Bank / Rehab', flyTime: '~2h 33min' },
  ];

  const TRAVEL_URL = 'https://www.torn.com/page.php?sid=travel';
  const ABROAD_URL = 'https://www.torn.com/shops.php?step=abroad';

  const POLL_MS = 30000; /* refresh travel status every 30s when panel is open */

  const STATE = {
    apiKey: null,
    apiKeySource: '',
    travel: null,    /* { destination, departed, time_left, timestamp, status } */
    location: 'torn', /* 'torn' | 'abroad' | 'traveling' | 'unknown' */
    abroadCountry: '', /* e.g. 'Mexico' if currently abroad */
    hospital: { active: false, until: 0, description: '' },
    flightTimes: {},  /* destination → total seconds (learned from actual flights) */
    lastFetchTs: 0,
    lastError: '',
    fetching: false,
    pollTimerId: null,
    ui: {
      minimized: true,
      zIndexBase: 999935
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
  const PROFILE_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours — use Refresh Stats to force re-scan
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
  async function tornApiGet(url, retries) {
    if (retries == null) retries = 1;
    trackApiCall();
    let data;
    try {
      if (typeof PDA_httpGet === 'function') {
        const resp = await PDA_httpGet(url, {});
        data = safeJsonParse(resp?.responseText);
      } else {
        const r = await fetch(url, { method: 'GET' });
        data = await r.json();
      }
    } catch (err) {
      addLog(`API fetch error: ${err.message || err}`);
      return null;
    }
    if (data?.error) {
      const code = data.error.code || 0;
      if (code === 5 && retries > 0) {
        addLog('Rate limit hit — waiting 5s before retry...');
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


  /* ── Panel hooks ─────────────────────────────────────────── */

  function onPanelExpand() {
    fetchTravelStatus();
    startPolling();
    startTickTimer();
  }

  function onPanelCollapse() {
    stopPolling();
    stopTickTimer();
  }

  /* ── Polling ─────────────────────────────────────────────── */

  function startPolling() {
    stopPolling();
    STATE.pollTimerId = setInterval(() => {
      if (STATE.ui.minimized) return;
      fetchTravelStatus();
    }, POLL_MS);
  }

  function stopPolling() {
    if (STATE.pollTimerId) {
      clearInterval(STATE.pollTimerId);
      STATE.pollTimerId = null;
    }
  }

  /* ── 1-second countdown tick ────────────────────────────── */

  let _tickTimerId = null;

  function startTickTimer() {
    stopTickTimer();
    _tickTimerId = setInterval(tickCountdowns, 1000);
  }

  function stopTickTimer() {
    if (_tickTimerId) {
      clearInterval(_tickTimerId);
      _tickTimerId = null;
    }
  }

  function tickCountdowns() {
    if (STATE.ui.minimized) return;

    /* Hospital timer — count down from absolute until timestamp */
    if (STATE.hospital.active) {
      const remaining = Math.max(0, STATE.hospital.until - nowUnix());
      const timerEl = document.getElementById('tpda-trav-hosp-timer');
      if (timerEl) timerEl.textContent = formatSeconds(remaining);
      const barEl = document.getElementById('tpda-trav-hosp-bar');
      if (barEl) {
        const pct = remaining > 0 ? Math.max(0, Math.min(100, 100 - (remaining / (5 * 3600)) * 100)) : 100;
        barEl.style.width = pct + '%';
      }
      if (remaining <= 0) {
        STATE.hospital = { active: false, until: 0, description: '' };
        renderPanel();
        return;
      }
    }

    /* Flight ETA — subtract elapsed since last fetch */
    if (STATE.location === 'traveling' && STATE.travel && STATE.lastFetchTs) {
      const elapsed = Math.floor((Date.now() - STATE.lastFetchTs) / 1000);
      const timeLeft = Math.max(0, (STATE.travel.time_left || 0) - elapsed);
      const etaEl = document.getElementById('tpda-trav-flight-eta');
      if (etaEl) etaEl.textContent = formatSeconds(timeLeft);
      const barEl = document.getElementById('tpda-trav-flight-bar');
      if (barEl) {
        const maxSec = Number(barEl.dataset.max) || (45 * 60);
        const pct = Math.max(0, Math.min(100, 100 - (timeLeft / maxSec) * 100));
        barEl.style.width = pct + '%';
      }
      if (timeLeft <= 0) {
        fetchTravelStatus();
      }
    }
  }

  /* ── Flight time helpers ────────────────────────────────── */

  const FLIGHT_TIMES_KEY = SCRIPT_KEY + '_flight_times';

  function loadFlightTimes() {
    STATE.flightTimes = getStorage(FLIGHT_TIMES_KEY, {});
  }

  function saveFlightTimes() {
    setStorage(FLIGHT_TIMES_KEY, STATE.flightTimes);
  }

  function destToKey(destName) {
    const lower = String(destName || '').toLowerCase();
    const match = COUNTRIES.find(c => lower.includes(c.id));
    return match ? match.id : lower.replace(/\s+/g, '_');
  }

  function getActualFlyTime(countryId) {
    return STATE.flightTimes[countryId] || null;
  }

  function formatFlySeconds(sec) {
    if (sec >= 3600) {
      const h = Math.floor(sec / 3600);
      const m = Math.round((sec % 3600) / 60);
      return m > 0 ? h + 'h ' + m + 'min' : h + 'h';
    }
    return Math.round(sec / 60) + ' min';
  }

  /* ── Travel status fetch ─────────────────────────────────── */

  async function fetchTravelStatus() {
    if (!STATE.apiKey) return;
    STATE.fetching = true;

    try {
      const url = `https://api.torn.com/user/?selections=travel,profile&key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
      let data;
      if (typeof PDA_httpGet === 'function') {
        const resp = await PDA_httpGet(url, {});
        data = safeJsonParse(resp?.responseText);
      } else {
        const r = await fetch(url, { method: 'GET' });
        data = await r.json();
      }

      if (data?.error) {
        STATE.lastError = `API error: ${data.error.error || data.error.code}`;
        addLog(STATE.lastError);
        STATE.fetching = false;
        renderPanel();
        return;
      }

      STATE.lastError = '';
      parseTravelData(data);
      STATE.lastFetchTs = Date.now();

    } catch (err) {
      STATE.lastError = `Fetch failed: ${err.message || err}`;
      addLog(STATE.lastError);
    }

    STATE.fetching = false;
    renderPanel();
  }

  function parseTravelData(data) {
    const travel = data?.travel;
    STATE.travel = travel || null;

    /* Determine current location from status + travel data */
    const statusObj = data?.status || data?.profile?.status;
    const statusState = (typeof statusObj === 'string') ? statusObj : statusObj?.state;
    const statusDesc = String(statusObj?.description || statusObj || '').toLowerCase();

    if (travel && travel.time_left > 0) {
      STATE.location = 'traveling';
      STATE.abroadCountry = travel.destination || '';

      /* Learn actual flight time: total = elapsed + remaining */
      if (travel.departed > 0 && travel.destination) {
        const totalSec = nowUnix() - travel.departed + travel.time_left;
        const destKey = destToKey(travel.destination);
        if (totalSec > 0 && totalSec < 4 * 3600) {
          STATE.flightTimes[destKey] = totalSec;
          saveFlightTimes();
        }
      }

      addLog(`Traveling to ${STATE.abroadCountry}, ${travel.time_left}s remaining`);
    } else if (travel && travel.destination && travel.time_left === 0) {
      /* Arrived abroad — travel.destination is non-empty, time_left is 0.
         This works even when hospitalized abroad (status.state = "Hospital"). */
      STATE.location = 'abroad';
      STATE.abroadCountry = travel.destination || 'Unknown';
      addLog(`Abroad in ${STATE.abroadCountry}`);
    } else if (/abroad/.test(String(statusState || '').toLowerCase()) ||
               /^in\s(mexico|canada|cayman|hawaii|uk|argentina|switzerland|japan|china|uae|south africa)/i.test(statusDesc)) {
      STATE.location = 'abroad';
      STATE.abroadCountry = travel?.destination || extractCountryFromStatus(statusDesc) || 'Unknown';
      addLog(`Abroad in ${STATE.abroadCountry} (status-based)`);
    } else if (/traveling|travelling|in flight/i.test(statusDesc)) {
      STATE.location = 'traveling';
      STATE.abroadCountry = travel?.destination || '';
      addLog(`In flight to ${STATE.abroadCountry}`);
    } else {
      STATE.location = 'torn';
      STATE.abroadCountry = '';
    }

    /* Hospital detection — status.state === 'Hospital', status.until = unix ts */
    const hospState = String(statusObj?.state || '').toLowerCase();
    if (hospState === 'hospital') {
      const untilTs = Number(statusObj?.until || 0);
      STATE.hospital = {
        active: true,
        until: untilTs,
        description: statusObj?.description || 'In hospital'
      };
      const remaining = Math.max(0, untilTs - nowUnix());
      addLog(`In hospital — ${formatSeconds(remaining)} remaining`);
    } else {
      STATE.hospital = { active: false, until: 0, description: '' };
    }
  }

  function extractCountryFromStatus(desc) {
    const match = String(desc).match(/in\s+(mexico|canada|cayman islands|hawaii|united kingdom|argentina|switzerland|japan|china|uae|south africa)/i);
    return match ? match[1] : '';
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
        background: linear-gradient(135deg, #1565c0, #0d47a1);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-family: Arial, sans-serif;
        font-size: 18px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.18);
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
      }
      #${PANEL_ID} {
        position: fixed;
        width: 340px;
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
      .tpda-trav-btn {
        border: none;
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: #fff;
        transition: opacity 0.15s;
      }
      .tpda-trav-btn:hover { opacity: 0.85; }
      .tpda-trav-btn:active { opacity: 0.7; }
    `;
    document.head.appendChild(style);
  }

  /* ── Bubble & Panel ──────────────────────────────────────── */

  function createBubble() {
    if (getBubbleEl()) return;
    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.dataset.tpdaBubble = '1';
    bubble.textContent = '\u2708';

    const pos = getBubblePosition();
    bubble.style.right = `${pos.right}px`;
    bubble.style.bottom = `${pos.bottom}px`;
    bubble.style.zIndex = String(STATE.ui.zIndexBase);

    bubble.addEventListener('click', (e) => {
      if (bubble.dataset.dragged === '1') { bubble.dataset.dragged = '0'; return; }
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
          <div style="font-weight:bold;">\u2708\uFE0F Traveler Utility</div>
          <div style="font-size:11px;color:#bbb;">Quick-fly & abroad tools</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="tpda-trav-refresh" style="background:#1565c0;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">\u21BB</button>
          <button id="tpda-trav-collapse" style="background:#444;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">\u25CB</button>
        </div>
      </div>
      <div id="tpda-trav-body" style="padding:8px;overflow-y:auto;flex:1 1 auto;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('tpda-trav-refresh').addEventListener('click', () => fetchTravelStatus());
    document.getElementById('tpda-trav-collapse').addEventListener('click', collapseToBubble);

    const body = document.getElementById('tpda-trav-body');
    body.addEventListener('click', (e) => {
      if (handleApiKeyClick(e, body, () => fetchTravelStatus())) return;
      if (handleLogClick(e, body)) return;

      /* Fly buttons — navigate to travel agency with deep-link hash */
      const flyBtn = e.target.closest('.tpda-trav-fly');
      if (flyBtn) {
        const dest = flyBtn.dataset.dest;
        if (dest) {
          addLog(`Navigating to travel agency for ${dest}`);
          window.location.href = `${TRAVEL_URL}#tpda_fly=${dest}`;
        }
        return;
      }

      /* Shop button — navigate to abroad shops */
      const shopBtn = e.target.closest('.tpda-trav-shop');
      if (shopBtn) {
        addLog('Navigating to abroad shops');
        window.location.href = ABROAD_URL;
        return;
      }

      /* Return home button — navigate to travel agency */
      const returnBtn = e.target.closest('.tpda-trav-return');
      if (returnBtn) {
        addLog('Navigating to travel agency (return)');
        window.location.href = TRAVEL_URL;
        return;
      }
    });

    makeDraggablePanel(panel, document.getElementById(HEADER_ID));
  }

  /* ── Rendering ───────────────────────────────────────────── */

  function renderPanel() {
    const body = document.getElementById('tpda-trav-body');
    if (!body) return;

    body.innerHTML = `
      ${renderStatusCard()}
      ${renderHospitalCard()}
      ${renderApiKeyCard()}
      ${STATE.lastError ? `<div style="margin-bottom:10px;padding:10px;border:1px solid #5a2d2d;border-radius:10px;background:#221313;color:#ffb3b3;">${escapeHtml(STATE.lastError)}</div>` : ''}
      ${renderActionCards()}
      ${renderLogCard()}
    `;
  }

  function renderStatusCard() {
    const lastFetchLabel = STATE.lastFetchTs ? ageText(STATE.lastFetchTs) : 'never';
    let statusHtml = '';

    if (STATE.location === 'traveling') {
      const timeLeft = STATE.travel?.time_left || 0;
      const dest = STATE.abroadCountry || 'Unknown';
      statusHtml = `
        <div style="font-size:14px;color:#42a5f5;font-weight:bold;margin-bottom:4px;">\u2708\uFE0F In Flight</div>
        <div>Destination: <strong>${escapeHtml(dest)}</strong></div>
        ${timeLeft > 0 ? `<div>ETA: <strong style="color:#ffd700;">${formatSeconds(timeLeft)}</strong></div>` : '<div>Arriving soon...</div>'}
      `;
    } else if (STATE.location === 'abroad') {
      statusHtml = `
        <div style="font-size:14px;color:#4caf50;font-weight:bold;margin-bottom:4px;">\uD83C\uDF0D Abroad</div>
        <div>Currently in: <strong>${escapeHtml(STATE.abroadCountry || 'Unknown')}</strong></div>
      `;
    } else {
      statusHtml = `
        <div style="font-size:14px;color:#bbb;font-weight:bold;margin-bottom:4px;">\uD83C\uDFE0 In Torn City</div>
        <div style="font-size:11px;color:#888;">Ready to travel</div>
      `;
    }

    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        ${statusHtml}
        <div style="font-size:10px;color:#666;margin-top:6px;">Updated: ${escapeHtml(lastFetchLabel)}</div>
      </div>`;
  }

  function renderHospitalCard() {
    if (!STATE.hospital.active) return '';
    const remaining = Math.max(0, STATE.hospital.until - nowUnix());
    const desc = STATE.hospital.description || 'In hospital';
    const pct = remaining > 0 ? Math.max(0, Math.min(100, 100 - (remaining / (5 * 3600)) * 100)) : 100;

    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #5a2d2d;border-radius:10px;background:#221313;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="font-size:18px;">\uD83C\uDFE5</span>
          <div>
            <div style="font-size:14px;color:#f44;font-weight:bold;">In Hospital</div>
            <div style="font-size:11px;color:#ffb3b3;">${escapeHtml(desc)}</div>
          </div>
        </div>
        ${remaining > 0 ? `
          <div style="background:#2f3340;border-radius:6px;overflow:hidden;height:16px;margin-bottom:6px;">
            <div id="tpda-trav-hosp-bar" style="background:#f44;height:100%;width:${pct}%;transition:width 1s linear;"></div>
          </div>
          <div id="tpda-trav-hosp-timer" style="text-align:center;font-size:16px;font-weight:bold;color:#ffd700;">${formatSeconds(remaining)}</div>
          <div style="text-align:center;font-size:11px;color:#888;margin-top:2px;">until release</div>
        ` : `
          <div style="text-align:center;font-size:14px;color:#4caf50;font-weight:bold;">Released!</div>
        `}
      </div>`;
  }

  function renderActionCards() {
    if (STATE.location === 'traveling') {
      return renderTravelingCard();
    } else if (STATE.location === 'abroad') {
      return renderAbroadCard();
    } else {
      return renderTornCard();
    }
  }

  /* When in Torn City — show fly-to buttons */
  function renderTornCard() {
    let html = `<div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">`;
    html += `<div style="font-weight:bold;margin-bottom:8px;">\u2708\uFE0F Quick Travel</div>`;
    html += `<div style="font-size:11px;color:#888;margin-bottom:8px;">Tap a destination to open the travel agency page.</div>`;

    for (const c of COUNTRIES) {
      const actualSec = getActualFlyTime(c.id);
      const timeLabel = actualSec ? formatFlySeconds(actualSec) : c.flyTime;
      html += `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;margin-bottom:6px;border:1px solid #2f3340;border-radius:8px;background:#1a1d26;">
          <div>
            <div style="font-weight:bold;color:${c.color};">${c.flag} ${escapeHtml(c.name)}</div>
            <div style="font-size:11px;color:#888;">${escapeHtml(c.items)} \u2022 ${escapeHtml(timeLabel)}</div>
          </div>
          <a href="${escapeHtml(TRAVEL_URL + '#tpda_fly=' + c.id)}" class="tpda-trav-fly tpda-trav-btn" data-dest="${escapeHtml(c.id)}"
             style="background:${c.color};">
            Fly \u2708
          </a>
        </div>`;
    }

    html += `</div>`;
    return html;
  }

  /* When abroad — show buy & return buttons */
  function renderAbroadCard() {
    const country = COUNTRIES.find(c =>
      STATE.abroadCountry.toLowerCase().includes(c.id)
    );
    const countryName = country ? country.name : STATE.abroadCountry;
    const countryColor = country ? country.color : '#42a5f5';

    let html = `<div style="margin-bottom:10px;padding:10px;border:1px solid ${countryColor};border-radius:10px;background:#111a13;">`;
    html += `<div style="font-weight:bold;color:${countryColor};margin-bottom:8px;">\uD83C\uDF0D In ${escapeHtml(countryName)}</div>`;

    if (country && country.id === 'switzerland') {
      /* Switzerland — Swiss Bank + Rehab Centre */
      html += `
        <div style="margin-bottom:8px;padding:8px;border:1px solid #2f3340;border-radius:8px;background:#1a1d26;">
          <div style="font-size:12px;color:#dc143c;font-weight:bold;">\uD83C\uDFE6 Swiss Bank</div>
          <div style="font-size:11px;color:#bbb;margin-top:4px;">Deposit funds at higher interest rates than Cayman.</div>
        </div>
        <div style="margin-bottom:8px;padding:8px;border:1px solid #2f3340;border-radius:8px;background:#1a1d26;">
          <div style="font-size:12px;color:#4caf50;font-weight:bold;">\uD83C\uDFE5 Rehabilitation Centre</div>
          <div style="font-size:11px;color:#bbb;margin-top:4px;">Reset drug addiction and cooldowns.</div>
        </div>`;
    } else if (country && country.id === 'cayman') {
      /* Cayman banking */
      html += `
        <div style="margin-bottom:8px;padding:8px;border:1px solid #2f3340;border-radius:8px;background:#1a1d26;">
          <div style="font-size:12px;color:#42a5f5;font-weight:bold;">\uD83C\uDFE6 Cayman Banking</div>
          <div style="font-size:11px;color:#bbb;margin-top:4px;">Visit the bank page to deposit or withdraw funds.</div>
        </div>`;
    } else if (country) {
      /* Normal shopping destination */
      html += `
        <div style="margin-bottom:8px;">
          <a href="${escapeHtml(ABROAD_URL)}" class="tpda-trav-shop tpda-trav-btn" style="background:${countryColor};width:100%;justify-content:center;padding:10px;">
            \uD83D\uDED2 Buy ${escapeHtml(country.items)} (open shop)
          </a>
          <div style="font-size:10px;color:#888;margin-top:4px;text-align:center;">Opens the abroad shop page \u2014 use the Buy Max button on the page</div>
        </div>`;
    }

    /* Return home button */
    html += `
      <div>
        <a href="${escapeHtml(TRAVEL_URL)}" class="tpda-trav-return tpda-trav-btn" style="background:#d64545;width:100%;justify-content:center;padding:10px;">
          \uD83C\uDFE0 Fly Back to Torn
        </a>
        <div style="font-size:10px;color:#888;margin-top:4px;text-align:center;">Opens travel agency \u2014 confirm return on the page</div>
      </div>`;

    html += `</div>`;
    return html;
  }

  /* When traveling — show ETA countdown */
  function renderTravelingCard() {
    const dest = STATE.abroadCountry || 'Unknown';
    const timeLeft = STATE.travel?.time_left || 0;
    const country = COUNTRIES.find(c => dest.toLowerCase().includes(c.id));
    const color = country ? country.color : '#42a5f5';

    let html = `<div style="margin-bottom:10px;padding:10px;border:1px solid ${color};border-radius:10px;background:#111a1e;">`;
    html += `<div style="font-weight:bold;color:${color};margin-bottom:8px;">\u2708\uFE0F Flying to ${escapeHtml(dest)}</div>`;

    if (timeLeft > 0) {
      /* Use actual learned flight time for progress bar, or compute from departed */
      let maxSec;
      const destKey = destToKey(dest);
      const actualTotal = getActualFlyTime(destKey);
      if (actualTotal) {
        maxSec = actualTotal;
      } else if (STATE.travel?.departed > 0) {
        maxSec = nowUnix() - STATE.travel.departed + timeLeft;
      } else {
        maxSec = country ? 45 * 60 : 3 * 3600;
      }
      const pct = Math.max(0, Math.min(100, 100 - (timeLeft / maxSec) * 100));
      html += `
        <div style="background:#2f3340;border-radius:6px;overflow:hidden;height:20px;margin-bottom:8px;">
          <div id="tpda-trav-flight-bar" data-max="${maxSec}" style="background:${color};height:100%;width:${pct}%;transition:width 1s linear;"></div>
        </div>
        <div id="tpda-trav-flight-eta" style="text-align:center;font-size:16px;font-weight:bold;color:#ffd700;">${formatSeconds(timeLeft)}</div>
        <div style="text-align:center;font-size:11px;color:#888;margin-top:2px;">until arrival</div>`;
    } else {
      html += `<div style="text-align:center;font-size:14px;color:#4caf50;font-weight:bold;">Arriving now!</div>`;
    }

    /* What to do when you arrive */
    if (country) {
      let arrivalAdvice;
      if (country.id === 'switzerland') arrivalAdvice = '\uD83C\uDFE6 Visit Swiss Bank or \uD83C\uDFE5 Rehab Centre';
      else if (country.id === 'cayman') arrivalAdvice = '\uD83C\uDFE6 Visit the bank';
      else arrivalAdvice = '\uD83D\uDED2 Buy ' + escapeHtml(country.items) + ' at the shop';
      html += `
        <div style="margin-top:10px;padding:8px;border:1px solid #2f3340;border-radius:8px;background:#1a1d26;">
          <div style="font-size:11px;color:#bbb;">\uD83D\uDCCB When you arrive:</div>
          <div style="font-size:12px;color:${color};font-weight:bold;margin-top:4px;">${arrivalAdvice}</div>
        </div>`;
    }

    html += `</div>`;
    return html;
  }

  /* ── Travel page deep-link ─────────────────────────────────
   *  When the user taps a Fly button, we navigate to the travel
   *  page with #tpda_fly=<countryId> in the URL. On the travel
   *  page our script detects the hash, finds the matching country
   *  expand button, and clicks it automatically — saving one tap.
   *  The user still has to manually confirm the "Fly" button.
   *  This is a UI-navigation assist, not a game-action automation.
   * ─────────────────────────────────────────────────────────── */

  function handleTravelDeepLink() {
    if (!/sid=travel/i.test(window.location.search)) return;
    const match = window.location.hash.match(/tpda_fly=(\w+)/i);
    if (!match) return;

    const dest = match[1].toLowerCase();
    const country = COUNTRIES.find(c => c.id === dest);
    if (!country) return;

    history.replaceState(null, '', window.location.pathname + window.location.search);
    addLog(`Deep link: auto-expanding ${country.name}...`);

    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 20) { clearInterval(timer); addLog('Deep link timed out — expand manually'); return; }

      /* Strategy 1: find expand buttons inside a container that mentions the country name */
      const expandBtns = document.querySelectorAll('button[class*="expand"], [class*="expand"] button');
      for (const btn of expandBtns) {
        const wrapper = btn.closest('li') || btn.closest('[class*="panel"]') || btn.closest('[class*="item"]') || btn.parentElement?.parentElement;
        if (wrapper && wrapper.textContent.toLowerCase().includes(country.name.toLowerCase())) {
          btn.click();
          clearInterval(timer);
          addLog(`Auto-expanded ${country.name}`);
          return;
        }
      }

      /* Strategy 2: broader search — any clickable near the country name text */
      const allBtns = document.querySelectorAll('[class*="travel"] button, [class*="destination"] button, [class*="country"] button');
      for (const btn of allBtns) {
        const wrapper = btn.closest('li') || btn.parentElement?.parentElement;
        if (wrapper && wrapper.textContent.toLowerCase().includes(country.name.toLowerCase())) {
          btn.click();
          clearInterval(timer);
          addLog(`Auto-expanded ${country.name} (fallback)`);
          return;
        }
      }
    }, 500);
  }

  /* ── Init ───────────────────────────────────────────────── */

  async function init() {
    initApiKey(PDA_INJECTED_KEY);
    loadFlightTimes();
    ensureStyles();
    createBubble();
    createPanel();
    handleTravelDeepLink();
    window.addEventListener('resize', onResize);
    addLog('Traveler Utility initialized' + (STATE.apiKey ? '' : ' \u2014 waiting for API key'));
  }

  hookFetch();
  hookXHR();

  setTimeout(init, 1500);
})();
