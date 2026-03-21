// ==UserScript==
// @name         Dark Tools - War Bubble
// @namespace    alex.torn.pda.war.online.location.timers.bubble
// @version      3.6.0
// @description  Local-only war bubble showing enemy faction members online/recently active, location buckets, timers, and faster-than-expected timer drops
// @author       Alex + ChatGPT
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-war-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-war-bubble.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Torn PDA replaces this placeholder with the real API key at injection time.
  // Outside PDA (e.g. Tampermonkey) it stays as the literal placeholder string.
  const PDA_INJECTED_KEY = '###PDA-APIKEY###';

  const SCRIPT_KEY = 'tpda_war_online_location_timers_bubble_v3';
  const BUBBLE_ID = 'tpda-war-online-bubble';
  const PANEL_ID = 'tpda-war-online-panel';
  const HEADER_ID = 'tpda-war-online-header';
  const BUBBLE_SIZE = 56;
  const POLL_INTERVALS = [
    { label: '30s',  ms: 30000 },
    { label: '1 min', ms: 60000 },
    { label: '2 min', ms: 120000 },
    { label: '5 min', ms: 300000 },
    { label: '10 min', ms: 600000 }
  ];
  const DEFAULT_POLL_MS = 60000;
  const TIMER_TRACK_KEY = `${SCRIPT_KEY}_timer_track`;

  const TIMER_TRACK_MAX_ENTRIES = 500;
  const TIMER_TRACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const SECTION_MEMBER_CAP = 15; /* Max members shown per section before "Show all" */

  const SECTION_META = {
    onlineTorn:   { title: 'Online in Torn',                     cls: 'war-on' },
    onlineAway:   { title: 'Online abroad / in flight',          cls: 'war-abroad' },
    recentTorn:   { title: 'Recently active in Torn',            cls: 'war-recent' },
    recentAway:   { title: 'Recently active abroad / in flight', cls: 'war-abroad' },
    hospital:     { title: 'Hospital',                            cls: 'war-bad' },
    jail:         { title: 'Jail',                                cls: 'war-bad' },
    shortOffline: { title: 'Offline 1\u201324h',                  cls: 'war-muted' },
    longOffline:  { title: 'Offline >24h',                        cls: 'war-unknown' }
  };
  const SECTION_KEYS = Object.keys(SECTION_META);

  const STATE = {
    apiKey: null, // memory only — never persisted to storage
    apiKeySource: '', // 'manual' | 'intercepted'
    enemyFactionId: null,
    enemyFactionName: '',
    enemyMembers: [],
    detectedWarInfo: null,
    lastFetchTs: 0,
    lastError: '',
    pollMs: DEFAULT_POLL_MS, // updated in init() via loadPollMs()
    pollTimerId: null,
    timerTickId: null,
    timerTrack: loadTimerTrack(),
    collapsed: loadCollapsedState(),
    showAll: {}, /* tracks which sections are expanded beyond SECTION_MEMBER_CAP */
    profileCache: {}, /* id → { rank, level, crimesTotal, networth, estimate, fetchedAt } */
    scanning: false,
    scanProgress: 0,
    scanTotal: 0,
    ui: {
      minimized: true,
      zIndexBase: 999970
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



  /* War-bubble uses formatSecondsShort() from common for display (omits
     seconds when d/h present) and formatSeconds() from common for full
     timers.  formatTimerFull was removed — it was identical to common's
     formatSeconds. */

  /* loadPollMs/savePollMs use common.js versions (parameterized) */

  function loadTimerTrack() {
    return getStorage(TIMER_TRACK_KEY, {});
  }

  function saveTimerTrack() {
    pruneTimerTrack();
    setStorage(TIMER_TRACK_KEY, STATE.timerTrack);
  }

  function pruneTimerTrack() {
    const entries = Object.entries(STATE.timerTrack);
    if (entries.length <= TIMER_TRACK_MAX_ENTRIES) return;

    const now = nowTs();
    const pruned = {};
    for (const [key, val] of entries) {
      if (val && typeof val.seenAt === 'number' && (now - val.seenAt) < TIMER_TRACK_MAX_AGE_MS) {
        pruned[key] = val;
      }
    }
    STATE.timerTrack = pruned;
  }

  function loadCollapsedState() {
    return getStorage(`${SCRIPT_KEY}_collapsed`, {});
  }

  function saveCollapsedState() {
    setStorage(`${SCRIPT_KEY}_collapsed`, STATE.collapsed);
  }

  /* ── War bubble stat scan ───────────────────────────────────── */

  async function scanMemberStats() {
    if (STATE.scanning) { STATE.scanning = false; return; } // cancel
    const ids = STATE.enemyMembers.map(m => m.id).filter(Boolean);
    if (!ids.length) { addLog('No members to scan'); return; }
    if (!STATE.apiKey) { addLog('No API key for stat scan'); return; }

    // Skip members already cached
    const toScan = ids.filter(id => {
      const c = STATE.profileCache[id];
      return !c || (nowTs() - c.fetchedAt) >= PROFILE_CACHE_TTL;
    });

    STATE.scanning = true;
    STATE.scanProgress = 0;
    STATE.scanTotal = toScan.length;
    addLog(`Scanning stats for ${toScan.length} members (${ids.length - toScan.length} cached)...`);
    renderPanel();

    for (let i = 0; i < toScan.length; i++) {
      if (!STATE.scanning) break;
      STATE.scanProgress = i + 1;
      await fetchMemberProfile(toScan[i]);
      if (i < toScan.length - 1) await sleep(SCAN_API_GAP_MS);
      // Update display every 5 members
      if ((i + 1) % 5 === 0 || i === toScan.length - 1) renderPanel();
    }

    STATE.scanning = false;
    saveProfileCache();
    addLog('Stat scan complete');
    renderPanel();
  }

  /* getManualEnemyFactionId/setManualEnemyFactionId use common.js versions */

  /* ── Panel expand/collapse hooks (called by common code) ──── */

  function onPanelExpand() {
    /* Start timer tick only while panel is open */
    if (!STATE.timerTickId) {
      STATE.timerTickId = setInterval(tickTimers, 1000);
    }
    detectEnemyFaction();
    renderPanel();
    refreshEnemyFactionData().then(renderPanel);
  }

  function onPanelCollapse() {
    /* Stop timer tick to save CPU while minimized */
    if (STATE.timerTickId) {
      clearInterval(STATE.timerTickId);
      STATE.timerTickId = null;
    }
  }

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
        background: linear-gradient(135deg, #d64545, #8f2222);
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
        width: 390px;
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
      .war-on { color: #8dff8d; }
      .war-recent { color: #ffd166; }
      .war-abroad { color: #9cc9ff; }
      .war-bad { color: #ff9f9f; }
      .war-muted { color: #bbb; }
      .war-unknown { color: #d5c5ff; }
      .war-fastdrop { color: #7cf0ff; font-weight: bold; }
    `;
    document.head.appendChild(style);
  }

  function createBubble() {
    if (getBubbleEl()) return;

    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.dataset.tpdaBubble = '1';
    bubble.innerHTML = 'WAR';

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
          <div style="font-weight:bold;">War Online Watch</div>
          <div style="font-size:11px;color:#bbb;">Local-only • key stays in memory only</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="tpda-war-refresh" style="background:#d64545;color:white;border:none;border-radius:8px;padding:6px 10px;">Refresh</button>
          <button id="tpda-war-collapse" style="background:#444;color:white;border:none;border-radius:8px;padding:6px 10px;">○</button>
        </div>
      </div>
      <div id="tpda-war-body" style="padding:12px;overflow-y:auto;max-height:70vh;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('tpda-war-refresh').addEventListener('click', async () => {
      detectEnemyFaction();
      await refreshEnemyFactionData();
      renderPanel();
    });

    document.getElementById('tpda-war-collapse').addEventListener('click', collapseToBubble);

    /* Delegated click handler — attached ONCE here, never inside renderPanel().
       innerHTML replacement destroys child nodes but #tpda-war-body itself persists,
       so this single listener handles all clicks on dynamically rendered content. */
    const warBody = document.getElementById('tpda-war-body');
    warBody.addEventListener('click', (e) => {
      /* Common API key card */
      if (handleApiKeyClick(e, warBody, async () => {
        await refreshEnemyFactionData();
        renderPanel();
      })) return;
      /* Common log card */
      if (handleLogClick(e, warBody)) return;

      const btn = e.target.closest('.tpda-war-copy-btn');
      if (btn) {
        const text = btn.dataset.copy || '';
        if (text) copyToClipboard(text, btn);
        return;
      }
      if (e.target.closest('.tpda-war-collapse-all')) {
        SECTION_KEYS.forEach(k => { STATE.collapsed[k] = true; STATE.showAll[k] = false; });
        saveCollapsedState();
        SECTION_KEYS.forEach(k => toggleSectionDOM(k));
        return;
      }
      if (e.target.closest('.tpda-war-expand-all')) {
        SECTION_KEYS.forEach(k => { STATE.collapsed[k] = false; });
        saveCollapsedState();
        SECTION_KEYS.forEach(k => toggleSectionDOM(k));
        return;
      }
      const showAll = e.target.closest('.tpda-war-show-all');
      if (showAll) {
        const key = showAll.dataset.section;
        if (key) {
          STATE.showAll[key] = true;
          showAllSectionDOM(key);
        }
        return;
      }
      const toggle = e.target.closest('.tpda-war-section-toggle');
      if (toggle) {
        const key = toggle.dataset.section;
        if (key) {
          const current = (STATE.collapsed[key] !== undefined) ? STATE.collapsed[key] : true;
          STATE.collapsed[key] = !current;
          if (STATE.collapsed[key]) STATE.showAll[key] = false;
          saveCollapsedState();
          toggleSectionDOM(key);
        }
      }
    });

    makeDraggablePanel(panel, document.getElementById(HEADER_ID));
  }

  async function detectEnemyFaction() {
    const manual = getManualEnemyFactionId();
    if (manual) {
      STATE.enemyFactionId = String(manual);
      addLog('Using manual faction ID: ' + manual);
      return;
    }

    const url = location.href;
    const pageText = document.body?.innerText || '';

    const patterns = [
      /[?&]factionID=(\d+)/i,
      /[?&]factionid=(\d+)/i,
      /[?&]ID=(\d+)/i,
      /\/faction\/(\d+)/i
    ];

    for (const re of patterns) {
      const m = url.match(re);
      if (m) {
        STATE.enemyFactionId = m[1];
        addLog('Detected faction ID from URL: ' + STATE.enemyFactionId);
        return;
      }
    }

    const links = Array.from(document.querySelectorAll('a[href*="faction"], a[href*="factions"]'));
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const text = (a.textContent || '').trim().toLowerCase();
      const m = href.match(/(?:factionID|factionid|ID)=(\d+)/i) || href.match(/\/faction\/(\d+)/i);
      if (m && (/enemy|opponent|rival|war/.test(text) || pageText.toLowerCase().includes('ranked war'))) {
        STATE.enemyFactionId = m[1];
        addLog('Detected faction ID from link: ' + STATE.enemyFactionId);
        return;
      }
    }

    // Fallback: query own faction API for active/upcoming wars
    const warInfo = await fetchOwnFactionWars();
    if (warInfo) {
      STATE.enemyFactionId = warInfo.enemyId;
      STATE.enemyFactionName = warInfo.enemyName || STATE.enemyFactionName;
      STATE.detectedWarInfo = warInfo;
      addLog('Auto-detected enemy faction from API: ' + warInfo.enemyId + ' (' + (warInfo.enemyName || 'unknown') + ')');
      return;
    }
  }

  function analyzeTimerChange(memberId, stateBucket, remainingSec) {
    if (!memberId || remainingSec == null || remainingSec < 0) {
      return {
        fasterThanExpected: false,
        deltaSec: null
      };
    }

    const key = `${STATE.enemyFactionId || 'unknown'}:${memberId}:${stateBucket}`;
    const now = nowTs();
    const prev = STATE.timerTrack[key];

    let fasterThanExpected = false;
    let deltaSec = null;

    if (prev && typeof prev.remainingSec === 'number' && typeof prev.seenAt === 'number') {
      const elapsedSec = Math.max(0, Math.round((now - prev.seenAt) / 1000));
      const expectedRemaining = Math.max(0, prev.remainingSec - elapsedSec);
      deltaSec = expectedRemaining - remainingSec;

      if (deltaSec > 45) {
        fasterThanExpected = true;
      }
    }

    STATE.timerTrack[key] = {
      remainingSec,
      seenAt: now
    };

    return {
      fasterThanExpected,
      deltaSec
    };
  }

  async function refreshEnemyFactionData() {
    STATE.lastError = '';
    addLog('Refreshing enemy faction data...');

    if (!STATE.enemyFactionId) {
      STATE.lastError = 'No enemy faction detected. Will auto-detect from scheduled wars, or set the faction ID manually.';
      addLog('No enemy faction ID set');
      return;
    }

    if (!STATE.apiKey) {
      STATE.lastError = 'Torn PDA key not captured yet. Open a page that triggers Torn PDA API calls, then refresh.';
      addLog('No API key available');
      return;
    }

    try {
      const url = `https://api.torn.com/faction/${encodeURIComponent(STATE.enemyFactionId)}?selections=basic&key=${encodeURIComponent(STATE.apiKey)}`;
      const res = await fetch(url, { method: 'GET' });
      const data = await res.json();

      if (data?.error) {
        STATE.lastError = data.error.error || 'Faction API error';
        return;
      }

      STATE.enemyFactionName = data?.name || data?.basic?.name || `Faction ${STATE.enemyFactionId}`;

      const rawMembers = normalizeMembers(data);
      // Log first member's raw data for debugging location inference
      if (rawMembers.length > 0) {
        const sample = rawMembers[0];
        addLog('Sample member raw — status type: ' + typeof sample.status +
               ', status: ' + JSON.stringify(sample.status)?.substring(0, 150) +
               ', last_action: ' + JSON.stringify(sample.last_action)?.substring(0, 100));
      }

      STATE.enemyMembers = rawMembers.map(m => {
        const action = memberLastActionInfo(m);
        const location = inferLocationState(m);
        const timer = extractTimerInfo(m, location.bucket);
        const timerCheck = analyzeTimerChange(
          m.id || m.player_id || m.user_id || '',
          location.bucket,
          timer.remainingSec
        );

        return {
          id: m.id || m.player_id || m.user_id || '',
          name: m.name || m.player_name || 'Unknown',
          level: m.level || '',
          position: m.position || '',
          days_in_faction: m.days_in_faction || '',
          locationBucket: location.bucket,
          locationLabel: location.label,
          timerRemainingSec: timer.remainingSec,
          timerEndTs: timer.remainingSec != null ? nowUnix() + timer.remainingSec : null,
          timerSource: timer.source,
          fasterThanExpected: timerCheck.fasterThanExpected,
          timerDeltaSec: timerCheck.deltaSec,
          ...action
        };
      });

      STATE.enemyMembers.sort((a, b) => a.minutes - b.minutes);
      STATE.lastFetchTs = nowTs();
      saveTimerTrack();

      // Log bucket distribution
      const bucketCounts = {};
      for (const m of STATE.enemyMembers) {
        bucketCounts[m.locationBucket] = (bucketCounts[m.locationBucket] || 0) + 1;
      }
      addLog('Fetched ' + STATE.enemyMembers.length + ' members — buckets: ' + JSON.stringify(bucketCounts));
    } catch (err) {
      STATE.lastError = String(err?.message || err || 'Unknown error');
      addLog('Fetch error: ' + STATE.lastError);
    }
  }

  function groupedMembers() {
    const groups = {
      onlineTorn: [],
      onlineAway: [],
      recentTorn: [],
      recentAway: [],
      hospital: [],
      jail: [],
      shortOffline: [],
      longOffline: []
    };

    for (const m of STATE.enemyMembers) {
      const away = m.locationBucket === 'abroad' || m.locationBucket === 'traveling';

      if (m.locationBucket === 'hospital') {
        groups.hospital.push(m);
        continue;
      }

      if (m.locationBucket === 'jail') {
        groups.jail.push(m);
        continue;
      }

      if (m.isOnline) {
        if (away) groups.onlineAway.push(m);
        else groups.onlineTorn.push(m);
        continue;
      }

      if (m.minutes <= 60) {
        if (away) groups.recentAway.push(m);
        else groups.recentTorn.push(m);
        continue;
      }

      if (m.minutes <= 1440) {
        groups.shortOffline.push(m);
      } else {
        groups.longOffline.push(m);
      }
    }

    return groups;
  }

  /* ── Cached grouped members — only recomputed when data changes ── */
  let _cachedGroups = null;
  let _cachedGroupsTs = 0;
  function getCachedGroups() {
    if (_cachedGroups && _cachedGroupsTs === STATE.lastFetchTs) return _cachedGroups;
    _cachedGroups = groupedMembers();
    _cachedGroupsTs = STATE.lastFetchTs;
    return _cachedGroups;
  }

  function timerHtml(member) {
    if (member.timerRemainingSec == null) return 'Time left: unknown';
    const bucket = member.locationBucket;
    const showFull = bucket === 'hospital' || bucket === 'jail' || bucket === 'traveling';
    if (showFull && member.timerEndTs) {
      const remaining = Math.max(0, member.timerEndTs - nowUnix());
      return `<span class="tpda-war-timer" data-end="${member.timerEndTs}">Time left: ${formatSeconds(remaining)}</span>`;
    }
    return `Time left: ${formatSecondsShort(member.timerRemainingSec)}`;
  }

  function tickTimers() {
    if (STATE.ui.minimized) return;
    const now = nowUnix();
    document.querySelectorAll('.tpda-war-timer[data-end]').forEach(el => {
      const end = Number(el.dataset.end);
      if (!end) return;
      const remaining = Math.max(0, end - now);
      el.textContent = 'Time left: ' + formatSeconds(remaining);
    });
  }

  function verifyText(member) {
    if (!member.fasterThanExpected) return '';
    const delta = member.timerDeltaSec != null ? ` • faster by ${formatSecondsShort(member.timerDeltaSec)}` : '';
    return `<div class="war-fastdrop">Timer dropped faster than expected${escapeHtml(delta)}</div>`;
  }

  /* attackUrl/profileUrl use common.js versions */

  function renderMemberList(list, cls) {
    if (!list.length) {
      return `<div class="war-muted">None</div>`;
    }

    return list.map(m => {
      const mid = escapeHtml(m.id);
      const mname = escapeHtml(m.name);
      const atkUrl = attackUrl(m.id);
      const profile = STATE.profileCache[m.id];
      const est = profile?.estimate;
      const rank = profile?.rank;
      const mid2 = est?.midpoint;
      const statDisplay = rank
        ? ` <span style="color:${est?.color || '#bbb'};font-weight:bold;">[${escapeHtml(rank)} ~${formatStatCompact(mid2)}]</span>`
        : (est ? ` <span style="color:${est.color};font-weight:bold;">[${escapeHtml(est.label)}]</span>` : '');
      return `
        <div style="padding:6px 0;border-top:1px solid #2a2d38;">
          <div class="${cls}">
            <strong>${mname}</strong>
            ${m.level ? ` <span style="color:#bbb;font-size:12px;">Lv ${escapeHtml(m.level)}</span>` : ''}
            ${statDisplay}
          </div>
          ${m.position ? `<div style="font-size:11px;color:#888;">${escapeHtml(m.position)}</div>` : ''}
          <div style="font-size:12px;color:#bbb;">
            ${m.isOnline ? 'Online now' : `Last action: ${escapeHtml(m.relative || `${m.minutes}m`)}`} • ${escapeHtml(m.locationLabel)}
          </div>
          <div style="font-size:12px;color:#bbb;">${timerHtml(m)}</div>
          ${verifyText(m)}
          <div style="margin-top:4px;display:flex;gap:6px;">
            <button class="tpda-war-copy-btn" data-copy="${escapeHtml(atkUrl)}"
                    style="font-size:11px;background:#2a6df4;color:#fff;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;">
              Attack URL
            </button>
            <button class="tpda-war-copy-btn" data-copy="${mname}"
                    style="font-size:11px;background:#444;color:#fff;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;">
              Copy Name
            </button>
            <a href="${escapeHtml(atkUrl)}" target="_blank" rel="noopener"
               style="font-size:11px;background:#d64545;color:#fff;border:none;border-radius:6px;padding:3px 8px;text-decoration:none;display:inline-block;">
              Go Attack
            </a>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderSectionContent(key, list, cls) {
    const capped = !STATE.showAll[key] && list.length > SECTION_MEMBER_CAP;
    const visible = capped ? list.slice(0, SECTION_MEMBER_CAP) : list;
    const hiddenCount = list.length - visible.length;
    return renderMemberList(visible, cls) +
      (hiddenCount > 0 ? `<div class="tpda-war-show-all" data-section="${key}" style="margin-top:6px;text-align:center;cursor:pointer;color:#6ea8fe;font-size:12px;padding:6px;border-top:1px solid #2f3340;">Show all ${formatNumber(list.length)} members (+${hiddenCount} more)</div>` : '');
  }

  function renderSection(key, title, list, cls) {
    const collapsed = (STATE.collapsed[key] !== undefined) ? STATE.collapsed[key] : true;
    const arrow = collapsed ? '\u25B6' : '\u25BC';
    return `
      <div data-section-wrap="${key}" style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div class="tpda-war-section-toggle" data-section="${key}" style="font-weight:bold;cursor:pointer;user-select:none;">
          ${arrow} ${title} (${formatNumber(list.length)})
        </div>
        ${collapsed ? '' : `<div data-section-content="${key}" style="margin-top:6px;">${renderSectionContent(key, list, cls)}</div>`}
      </div>
    `;
  }

  /* ── Incremental section toggle — avoids full panel re-render ── */

  function toggleSectionDOM(key) {
    const wrap = document.querySelector(`[data-section-wrap="${key}"]`);
    if (!wrap) return;
    const toggle = wrap.querySelector('.tpda-war-section-toggle');
    if (!toggle) return;
    const collapsed = STATE.collapsed[key];

    // Update arrow
    toggle.textContent = toggle.textContent.replace(/[\u25B6\u25BC]/, collapsed ? '\u25B6' : '\u25BC');

    const existing = wrap.querySelector('[data-section-content]');
    if (collapsed) {
      if (existing) existing.remove();
    } else {
      if (existing) return; // already expanded
      const groups = getCachedGroups();
      const list = groups[key] || [];
      const meta = SECTION_META[key];
      if (!meta) return;
      const el = document.createElement('div');
      el.setAttribute('data-section-content', key);
      el.style.marginTop = '6px';
      el.innerHTML = renderSectionContent(key, list, meta.cls);
      wrap.appendChild(el);
    }
  }

  function showAllSectionDOM(key) {
    const wrap = document.querySelector(`[data-section-wrap="${key}"]`);
    if (!wrap) return;
    const existing = wrap.querySelector('[data-section-content]');
    if (!existing) return;
    const groups = getCachedGroups();
    const list = groups[key] || [];
    const meta = SECTION_META[key];
    if (!meta) return;
    existing.innerHTML = renderSectionContent(key, list, meta.cls);
  }

  /* Debounced render — collapses rapid-fire renderPanel() calls into one frame */
  let _renderRAF = 0;
  function renderPanel() {
    if (_renderRAF) return;             // already scheduled
    _renderRAF = requestAnimationFrame(() => {
      _renderRAF = 0;
      _renderPanelNow();
    });
  }

  function _renderPanelNow() {
    const body = document.getElementById('tpda-war-body');
    if (!body) return;

    // Recalculate startsIn for live countdown
    if (STATE.detectedWarInfo && STATE.detectedWarInfo.start) {
      STATE.detectedWarInfo.startsIn = Math.max(0, STATE.detectedWarInfo.start - Math.floor(Date.now() / 1000));
    }

    const groups = getCachedGroups();

    body.innerHTML = `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Target</div>
        <div>Enemy faction: ${escapeHtml(STATE.enemyFactionName || 'Unknown')}</div>
        <div>Faction ID: ${escapeHtml(STATE.enemyFactionId || 'Not set')}</div>
        ${STATE.detectedWarInfo ? `<div style="color:#ffcc00;">
          ${escapeHtml(STATE.detectedWarInfo.type)}: ${STATE.detectedWarInfo.startsIn > 0
            ? 'starts in ' + formatSecondsShort(STATE.detectedWarInfo.startsIn)
            : 'in progress'}
          ${STATE.detectedWarInfo.start ? ' (' + new Date(STATE.detectedWarInfo.start * 1000).toLocaleString() + ')' : ''}
        </div>` : ''}
        ${!STATE.enemyFactionId ? '<div style="color:#ffb3b3;font-size:11px;">No war detected. Waiting for scheduled war or set faction ID manually below.</div>' : ''}
        <div>API key: ${STATE.apiKey ? `Active (${escapeHtml(STATE.apiKeySource || 'unknown source')})` : 'Not available'}</div>
        <div>Last refresh: ${ageText(STATE.lastFetchTs)}</div>
      </div>

      ${renderApiKeyCard()}

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="font-weight:bold;margin-bottom:6px;">Manual faction ID override</div>
        <div style="display:flex;gap:8px;">
          <input id="tpda-war-faction-id-input" type="text" value="${escapeHtml(getManualEnemyFactionId())}" placeholder="Enemy faction ID"
                 style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:8px;padding:8px;" />
          <button id="tpda-war-save-id" style="background:#444;color:white;border:none;border-radius:8px;padding:8px 10px;">Save</button>
        </div>
      </div>

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="font-weight:bold;margin-bottom:6px;">Refresh rate</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <select id="tpda-war-poll-select"
                  style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:8px;padding:8px;font-size:13px;">
            ${POLL_INTERVALS.map(p => `<option value="${p.ms}"${p.ms === STATE.pollMs ? ' selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
          </select>
          <span style="font-size:11px;color:#bbb;">Auto-refresh while panel is open</span>
        </div>
      </div>

      ${STATE.lastError ? `
        <div style="margin-bottom:10px;padding:10px;border:1px solid #5a2d2d;border-radius:10px;background:#221313;color:#ffb3b3;">
          ${escapeHtml(STATE.lastError)}
        </div>
      ` : ''}

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="tpda-war-scan-stats" style="background:${STATE.scanning ? '#d64545' : '#4a3d7a'};color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;">
            ${STATE.scanning ? 'Stop Scan' : 'Scan Stats'}
          </button>
          <span style="font-size:11px;color:#bbb;">
            ${STATE.scanning
              ? `Scanning... ${STATE.scanProgress}/${STATE.scanTotal}`
              : `Estimate enemy battle stats via TornPDA algorithm`}
          </span>
        </div>
        ${Object.keys(STATE.profileCache).length > 0 ? `<div style="font-size:11px;color:#888;margin-top:4px;">${Object.keys(STATE.profileCache).length} profiles cached</div>` : ''}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <button class="tpda-war-collapse-all" style="flex:1;background:#2f3340;color:#bbb;border:none;border-radius:8px;padding:6px 10px;font-size:11px;cursor:pointer;">Collapse All</button>
        <button class="tpda-war-expand-all" style="flex:1;background:#2f3340;color:#bbb;border:none;border-radius:8px;padding:6px 10px;font-size:11px;cursor:pointer;">Expand All</button>
      </div>

      ${SECTION_KEYS.map(k => renderSection(k, SECTION_META[k].title, groups[k] || [], SECTION_META[k].cls)).join('\n      ')}

      ${renderLogCard()}
    `;

    const saveBtn = document.getElementById('tpda-war-save-id');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const input = document.getElementById('tpda-war-faction-id-input');
        const val = String(input?.value || '').trim();
        setManualEnemyFactionId(val);
        STATE.enemyFactionId = val || null;
        addLog('Manual faction ID saved: ' + val);
        await refreshEnemyFactionData();
        renderPanel();
      };
    }

    const pollSelect = document.getElementById('tpda-war-poll-select');
    if (pollSelect) {
      pollSelect.onchange = () => {
        const ms = Number(pollSelect.value);
        STATE.pollMs = ms;
        savePollMs(ms);
        restartPolling();
      };
    }

    const scanBtn = document.getElementById('tpda-war-scan-stats');
    if (scanBtn) {
      scanBtn.onclick = () => scanMemberStats();
    }
  }

  function startPolling() {
    if (STATE.pollTimerId) clearInterval(STATE.pollTimerId);
    STATE.pollTimerId = setInterval(async () => {
      if (STATE.ui.minimized) return;
      if (!STATE.apiKey) return;

      // If no enemy faction yet, retry detection (catches scheduled wars via API)
      if (!STATE.enemyFactionId) {
        await detectEnemyFaction();
        if (STATE.enemyFactionId) {
          addLog('Enemy faction found during poll — starting data fetch');
          renderPanel();
        }
      }

      if (!STATE.enemyFactionId) return;
      await refreshEnemyFactionData();
      addLog('Poll cycle completed');
      renderPanel();
    }, STATE.pollMs);
  }

  function restartPolling() {
    startPolling();
  }

  async function init() {
    initApiKey(PDA_INJECTED_KEY);
    STATE.profileCache = loadProfileCache();
    STATE.pollMs = loadPollMs(POLL_INTERVALS, DEFAULT_POLL_MS);

    ensureStyles();
    createBubble();
    createPanel();
    await detectEnemyFaction();
    window.addEventListener('resize', onResize);
    startPolling();
    addLog('War Bubble initialized' + (STATE.apiKey ? '' : ' — waiting for API key'));
    if (STATE.enemyFactionId) {
      await refreshEnemyFactionData();
      renderPanel();
    }
  }

  // Install network hooks immediately so we capture API calls made before init runs
  hookFetch();
  hookXHR();

  setTimeout(init, 1200);
})();
