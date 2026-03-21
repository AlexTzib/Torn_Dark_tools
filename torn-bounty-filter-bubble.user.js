// ==UserScript==
// @name         Dark Tools - Bounty Filter
// @namespace    alex.torn.pda.bountyfilter.bubble
// @version      1.3.1
// @description  Fetches bounties from Torn API and filters by target state (hospital, jail, abroad, in Torn), hospital release timers, and level. Attack links for easy claiming.
// @author       Alex + Devin
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-bounty-filter-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-bounty-filter-bubble.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PDA_INJECTED_KEY = '###PDA-APIKEY###';

  const SCRIPT_KEY = 'tpda_bounty_filter_v1';
  const BUBBLE_ID = 'tpda-bounty-bubble';
  const PANEL_ID = 'tpda-bounty-panel';
  const HEADER_ID = 'tpda-bounty-header';
  const BUBBLE_SIZE = 56;

  const STATUS_CACHE_TTL_MS = 60 * 1000; /* 1-minute in-memory cache (skips already-fresh targets) */
  const STATUS_FETCH_GAP_MS = 350; /* gap between status lookups (~170/min, shared with other scripts) */
  const MAX_STATUS_LOOKUPS = 30; /* max targets to enrich per refresh (controls API usage) */

  const BOUNTY_CACHE_KEY = `${SCRIPT_KEY}_bounty_cache`;
  const STATUS_CACHE_KEY = `${SCRIPT_KEY}_status_cache`;
  const PERSIST_TTL_MS = 10 * 60 * 1000; /* 10-minute localStorage persistence */

  const FILTER_STORAGE_KEY = `${SCRIPT_KEY}_filters`;

  const STATE = {
    apiKey: null,
    apiKeySource: '',
    bounties: [],       /* raw bounty list from API */
    enriched: [],       /* bounties enriched with target status */
    lastFetchTs: 0,
    lastError: '',
    fetching: false,
    enriching: false,
    enrichProgress: 0,
    enrichTotal: 0,
    statusCache: {},    /* targetId → { state, description, until, level, fetchedAt } */
    filters: loadFilters(),
    ui: {
      minimized: true,
      zIndexBase: 999950
    },
    _logs: []
  };

  function defaultFilters() {
    return {
      showOkay: true,       /* In Torn & Okay */
      showHospital: true,   /* In hospital */
      showJail: false,      /* In jail */
      showAbroad: false,    /* Abroad / traveling */
      showUnknown: true,    /* Unknown state */
      maxLevel: 0,          /* 0 = no limit */
      minReward: 0,         /* 0 = no limit */
      maxStatIdx: -1,       /* -1 = no limit; 0-6 maps to STAT_RANGES */
      hideSoon: false,      /* hide hospital targets releasing in < 5 min (too late to hit) */
      soonMinutes: 5,       /* "soon" threshold in minutes */
    };
  }

  function loadFilters() {
    const saved = getStorage(FILTER_STORAGE_KEY, null);
    if (!saved) return defaultFilters();
    return { ...defaultFilters(), ...saved };
  }

  function saveFilters() {
    setStorage(FILTER_STORAGE_KEY, STATE.filters);
  }

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

  async function fetchMemberProfile(memberId) {
    const cached = STATE.profileCache[memberId];
    if (cached && (nowTs() - cached.fetchedAt) < PROFILE_CACHE_TTL) return cached;
    if (!STATE.apiKey) return null;

    try {
      const url = `https://api.torn.com/user/${encodeURIComponent(memberId)}?selections=profile,personalstats,criminalrecord&key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
      let data;
      if (typeof PDA_httpGet === 'function') {
        const resp = await PDA_httpGet(url, {});
        data = safeJsonParse(resp?.responseText);
      } else {
        const r = await fetch(url, { method: 'GET' });
        data = await r.json();
      }
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



  /* ── localStorage cache for bounties & target statuses ──── */

  function loadCachedBounties() {
    const c = getStorage(BOUNTY_CACHE_KEY, null);
    if (c && c.ts && Date.now() - c.ts < PERSIST_TTL_MS) {
      STATE.bounties = c.list || [];
      STATE.lastFetchTs = c.ts;
      return true;
    }
    return false;
  }

  function saveCachedBounties() {
    setStorage(BOUNTY_CACHE_KEY, { list: STATE.bounties, ts: STATE.lastFetchTs });
  }

  function loadCachedStatuses() {
    const c = getStorage(STATUS_CACHE_KEY, null);
    if (!c || typeof c !== 'object') return;
    const now = Date.now();
    for (const [tid, e] of Object.entries(c)) {
      if (e && e.fetchedAt && now - e.fetchedAt < PERSIST_TTL_MS && 'rank' in e) {
        STATE.statusCache[tid] = e;
      }
    }
  }

  function saveCachedStatuses() {
    const now = Date.now();
    const out = {};
    for (const [tid, e] of Object.entries(STATE.statusCache)) {
      if (e && e.fetchedAt && now - e.fetchedAt < PERSIST_TTL_MS) {
        out[tid] = e;
      }
    }
    setStorage(STATUS_CACHE_KEY, out);
  }


  /* ── Panel expand/collapse hooks ─────────────────────────── */
  function onPanelExpand() {
    applyEnrichment();
    renderPanel();
  }
  function onPanelCollapse() {}


  /* ── Bounty API fetching ─────────────────────────────────── */

  async function fetchBounties() {
    if (!STATE.apiKey) {
      STATE.lastError = 'No API key';
      addLog('Cannot fetch bounties — no API key');
      renderPanel();
      return;
    }
    STATE.fetching = true;
    STATE.lastError = '';
    renderPanel();

    try {
      const url = `https://api.torn.com/v2/torn/?selections=bounties&key=${STATE.apiKey}&_tpda=1`;
      addLog('Fetching bounties (v2)...');

      let resp, data;
      if (typeof PDA_httpGet === 'function') {
        resp = await PDA_httpGet(url, {});
        data = safeJsonParse(resp?.responseText);
      } else {
        const r = await fetch(url);
        data = await r.json();
      }

      if (data?.error) {
        STATE.lastError = `API error ${data.error.code}: ${data.error.error}`;
        addLog(STATE.lastError);
        STATE.fetching = false;
        renderPanel();
        return;
      }

      /* Parse bounties — v2 returns { bounties: [ {...}, ... ] } (array) */
      const raw = data?.bounties || data;
      const list = [];
      if (Array.isArray(raw)) {
        for (let i = 0; i < raw.length; i++) {
          const b = raw[i];
          if (!b || typeof b !== 'object') continue;
          list.push({
            bountyId: String(i),
            targetId: b.target_id || 0,
            targetName: b.target_name || `#${b.target_id || i}`,
            targetLevel: b.target_level || 0,
            reward: b.reward || 0,
            listedBy: b.lister_id || 0,
            listedByName: b.lister_name || '',
            isAnonymous: !!b.is_anonymous,
            quantity: b.quantity || 1,
            validUntil: b.valid_until || 0,
            reason: b.reason || '',
          });
        }
      } else if (raw && typeof raw === 'object') {
        for (const [id, b] of Object.entries(raw)) {
          if (!b || typeof b !== 'object') continue;
          list.push({
            bountyId: id,
            targetId: b.target_id || parseInt(id),
            targetName: b.target_name || `#${b.target_id || id}`,
            targetLevel: b.target_level || 0,
            reward: b.reward || 0,
            listedBy: b.listed_by || b.lister_id || 0,
            listedByName: b.listed_by_name || b.lister_name || '',
            isAnonymous: !!b.is_anonymous,
            quantity: b.quantity || 1,
            validUntil: b.valid_until || 0,
            reason: b.reason || '',
          });
        }
      }

      STATE.bounties = list;
      STATE.lastFetchTs = Date.now();
      saveCachedBounties();
      addLog(`Fetched ${list.length} bounties`);

      /* Enrich targets with status */
      await enrichBountyTargets();

    } catch (err) {
      STATE.lastError = `Fetch failed: ${err.message || err}`;
      addLog(STATE.lastError);
    }

    STATE.fetching = false;
    renderPanel();
  }


  /* ── Enrich bounty targets with status (hospital/jail/abroad/etc) ── */

  async function enrichBountyTargets() {
    /* De-duplicate target IDs and filter out those already cached */
    const uniqueTargets = new Map();
    for (const b of STATE.bounties) {
      if (!uniqueTargets.has(b.targetId)) {
        uniqueTargets.set(b.targetId, b);
      }
    }

    const toFetch = [];
    for (const [tid] of uniqueTargets) {
      const cached = STATE.statusCache[tid];
      if (cached && Date.now() - cached.fetchedAt < STATUS_CACHE_TTL_MS) continue;
      toFetch.push(tid);
    }

    if (toFetch.length === 0) {
      applyEnrichment();
      return;
    }

    STATE.enriching = true;
    STATE.enrichProgress = 0;
    STATE.enrichTotal = Math.min(toFetch.length, MAX_STATUS_LOOKUPS);
    renderPanel();

    const batch = toFetch.slice(0, MAX_STATUS_LOOKUPS);
    for (let i = 0; i < batch.length; i++) {
      const tid = batch[i];
      STATE.enrichProgress = i + 1;

      try {
        const url = `https://api.torn.com/v2/user/${tid}?selections=profile&key=${STATE.apiKey}&_tpda=1`;
        let data;
        if (typeof PDA_httpGet === 'function') {
          const resp = await PDA_httpGet(url, {});
          data = safeJsonParse(resp?.responseText);
        } else {
          const r = await fetch(url);
          data = await r.json();
        }

        if (data?.error) {
          addLog(`API error for #${tid}: ${data.error.error || data.error.code}`);
        } else if (data) {
          const p = data.profile || data;
          const merged = { ...p };
          if (!merged.status && data.status) merged.status = data.status;

          const loc = inferLocationState(merged);
          const timer = extractTimerInfo(merged, loc.bucket);
          const rank = merged.rank || data.rank || '';
          const statEst = estimateStats(rank, merged.level || 0, 0, 0);
          if (!rank) addLog(`#${tid} (${merged.name || '?'}): no rank in API response`);
          else if (!statEst) addLog(`#${tid}: rank "${rank}" not in RANK_SCORES`);
          STATE.statusCache[tid] = {
            state: loc.bucket,
            label: loc.label,
            level: merged.level || 0,
            name: merged.name || '',
            rank: rank,
            statEstimate: statEst,
            remainingSec: timer.remainingSec,
            timerSource: timer.source,
            lastAction: merged.last_action || data.last_action,
            fetchedAt: Date.now()
          };
        }
      } catch (err) {
        addLog(`Status fetch failed for ${tid}: ${err.message || err}`);
      }

      /* Rate limit */
      if (i < batch.length - 1) {
        await new Promise(r => setTimeout(r, STATUS_FETCH_GAP_MS));
      }

      /* Update UI periodically */
      if ((i + 1) % 5 === 0) renderPanel();
    }

    STATE.enriching = false;
    saveCachedStatuses();
    applyEnrichment();
    addLog(`Enriched ${batch.length} targets`);
    renderPanel();
  }

  function applyEnrichment() {
    STATE.enriched = STATE.bounties.map(b => {
      const status = STATE.statusCache[b.targetId] || null;
      return {
        ...b,
        targetLevel: status?.level || b.targetLevel,
        targetName: status?.name || b.targetName,
        state: status?.state || 'unknown',
        stateLabel: status?.label || 'Unknown',
        rank: status?.rank || '',
        statEstimate: status?.statEstimate || null,
        remainingSec: status?.remainingSec || 0,
        lastAction: status?.lastAction || null,
      };
    });
  }


  /* ── Filtering ───────────────────────────────────────────── */

  function filteredBounties() {
    const f = STATE.filters;
    return STATE.enriched.filter(b => {
      /* State filters */
      if (b.state === 'torn' && !f.showOkay) return false;
      if (b.state === 'hospital' && !f.showHospital) return false;
      if (b.state === 'jail' && !f.showJail) return false;
      if ((b.state === 'abroad' || b.state === 'traveling') && !f.showAbroad) return false;
      if (b.state === 'unknown' && !f.showUnknown) return false;

      /* Level filter */
      if (f.maxLevel > 0 && b.targetLevel > f.maxLevel) return false;

      /* Reward filter */
      if (f.minReward > 0 && b.reward < f.minReward) return false;

      /* Estimated stats filter — also block targets with unknown stats */
      if (f.maxStatIdx >= 0) {
        if (!b.statEstimate) return false;
        if (b.statEstimate.idx > f.maxStatIdx) return false;
      }

      /* "Soon" filter — hide hospital targets releasing in < N min */
      if (f.hideSoon && b.state === 'hospital' && b.remainingSec > 0 && b.remainingSec < f.soonMinutes * 60) return false;

      return true;
    });
  }


  /* ── State styling ───────────────────────────────────────── */

  function stateColor(state) {
    switch (state) {
      case 'torn':      return '#8dff8d';
      case 'hospital':  return '#ff9f9f';
      case 'jail':      return '#ffb347';
      case 'abroad':    return '#9cc9ff';
      case 'traveling': return '#9cc9ff';
      default:          return '#bbb';
    }
  }

  function stateIcon(state) {
    switch (state) {
      case 'torn':      return '\u2714'; /* ✔ */
      case 'hospital':  return '\u2695'; /* ⚕ */
      case 'jail':      return '\u26D4'; /* ⛔ */
      case 'abroad':    return '\u2708'; /* ✈ */
      case 'traveling': return '\u2708';
      default:          return '\u2753'; /* ❓ */
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
        background: linear-gradient(135deg, #e65100, #bf360c);
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
        width: 380px;
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
      .tpda-bty-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-bottom: 1px solid #1e2030;
        font-size: 12px;
      }
      .tpda-bty-row:hover {
        background: rgba(255,255,255,0.04);
      }
      .tpda-bty-attack {
        background: #d64545;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 11px;
        cursor: pointer;
        text-decoration: none;
        white-space: nowrap;
      }
      .tpda-bty-name-link {
        color: #42a5f5;
        text-decoration: none;
        font-weight: bold;
      }
      .tpda-bty-name-link:hover {
        text-decoration: underline;
      }
      .tpda-bty-filter-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 0;
        font-size: 11px;
      }
      .tpda-bty-filter-row label {
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .tpda-bty-filter-row input[type="checkbox"] {
        cursor: pointer;
      }
      .tpda-bty-filter-row input[type="number"] {
        width: 60px;
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


  /* ── Bubble & Panel ──────────────────────────────────────── */

  function createBubble() {
    if (getBubbleEl()) return;

    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.dataset.tpdaBubble = '1';
    bubble.innerHTML = 'BTY';

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
          <div style="font-weight:bold;">Bounty Filter</div>
          <div style="font-size:11px;color:#bbb;">Filter targets by state & timers</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="tpda-bty-refresh" style="background:#e65100;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">Refresh</button>
          <button id="tpda-bty-collapse" style="background:#444;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">\u25CB</button>
        </div>
      </div>
      <div id="tpda-bty-body" style="padding:8px;overflow-y:auto;flex:1 1 auto;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('tpda-bty-refresh').addEventListener('click', () => {
      fetchBounties();
    });
    document.getElementById('tpda-bty-collapse').addEventListener('click', collapseToBubble);

    /* Delegated click handler — attached ONCE here, never inside renderPanel() */
    const panelBody = document.getElementById('tpda-bty-body');
    panelBody.addEventListener('click', (e) => {
      if (handleApiKeyClick(e, panelBody, () => {
        fetchBounties();
      })) return;
      if (handleLogClick(e, panelBody)) return;

      /* Copy buttons */
      const copyBtn = e.target.closest('.tpda-bty-copy');
      if (copyBtn) {
        const text = copyBtn.dataset.copy || '';
        if (text) copyToClipboard(text, copyBtn);
        return;
      }
    });

    /* Delegated change handler for filters */
    panelBody.addEventListener('change', (e) => {
      const el = e.target;
      if (!el) return;
      const fKey = el.dataset.filter;
      if (!fKey) return;

      if (el.type === 'checkbox') {
        STATE.filters[fKey] = el.checked;
      } else if (el.type === 'number' || el.tagName === 'SELECT') {
        STATE.filters[fKey] = parseInt(el.value) || 0;
      }
      saveFilters();
      renderPanel();
    });

    makeDraggablePanel(panel, document.getElementById(HEADER_ID));
  }


  /* ── Render ──────────────────────────────────────────────── */

  function renderPanel() {
    const body = document.getElementById('tpda-bty-body');
    if (!body) return;

    let h = '';
    const f = STATE.filters;

    /* ─ Filters card ─ */
    h += `<div style="margin-bottom:8px;padding:8px;border:1px solid #2f3340;border-radius:10px;background:#141821;">`;
    h += `<div style="font-weight:bold;font-size:12px;margin-bottom:6px;">Filters</div>`;

    /* State toggles */
    h += `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:6px;">`;
    h += filterCheckbox('showOkay', 'In Torn', f.showOkay, '#8dff8d');
    h += filterCheckbox('showHospital', 'Hospital', f.showHospital, '#ff9f9f');
    h += filterCheckbox('showJail', 'Jail', f.showJail, '#ffb347');
    h += filterCheckbox('showAbroad', 'Abroad', f.showAbroad, '#9cc9ff');
    h += filterCheckbox('showUnknown', 'Unknown', f.showUnknown, '#bbb');
    h += `</div>`;

    /* Numeric filters */
    h += `<div style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11px;">`;
    h += `<div class="tpda-bty-filter-row">`;
    h += `<span style="color:#bbb;">Max Lvl:</span>`;
    h += `<input type="number" data-filter="maxLevel" value="${f.maxLevel || ''}" min="0" max="100" placeholder="any" />`;
    h += `</div>`;
    h += `<div class="tpda-bty-filter-row">`;
    h += `<span style="color:#bbb;">Min $:</span>`;
    h += `<input type="number" data-filter="minReward" value="${f.minReward || ''}" min="0" placeholder="any" />`;
    h += `</div>`;
    h += `</div>`;

    /* Estimated stats filter */
    h += `<div class="tpda-bty-filter-row" style="margin-top:4px;">`;
    h += `<span style="color:#bbb;font-size:11px;">Max Stats:</span>`;
    h += `<select data-filter="maxStatIdx" style="background:#0f1116;color:#fff;border:1px solid #444;border-radius:4px;padding:2px 4px;font-size:11px;">`;
    h += `<option value="-1"${f.maxStatIdx < 0 ? ' selected' : ''}>Any</option>`;
    for (let i = 0; i < STAT_RANGES.length; i++) {
      h += `<option value="${i}"${f.maxStatIdx === i ? ' selected' : ''} style="color:${STAT_COLORS[i]};">${STAT_RANGES[i]}</option>`;
    }
    h += `</select>`;
    h += `</div>`;

    /* Hospital timer filter */
    h += `<div class="tpda-bty-filter-row" style="margin-top:4px;">`;
    h += filterCheckbox('hideSoon', 'Hide hospital releasing in <', f.hideSoon, '#ffc107');
    h += `<input type="number" data-filter="soonMinutes" value="${f.soonMinutes}" min="1" max="60" style="width:40px;background:#0f1116;color:#fff;border:1px solid #444;border-radius:4px;padding:2px 4px;font-size:11px;" />`;
    h += `<span style="color:#bbb;font-size:11px;">min</span>`;
    h += `</div>`;

    h += `</div>`;

    /* ─ Status bar ─ */
    if (STATE.fetching) {
      h += `<div style="padding:6px;text-align:center;color:#ffc107;font-size:11px;">Fetching bounties...</div>`;
    } else if (STATE.enriching) {
      h += `<div style="padding:6px;text-align:center;color:#42a5f5;font-size:11px;">Checking targets... ${STATE.enrichProgress}/${STATE.enrichTotal}</div>`;
    } else if (STATE.lastError) {
      h += `<div style="padding:6px;text-align:center;color:#f44;font-size:11px;">${escapeHtml(STATE.lastError)}</div>`;
    } else if (STATE.lastFetchTs) {
      const filtered = filteredBounties();
      h += `<div style="padding:4px 6px;display:flex;justify-content:space-between;font-size:11px;color:#888;">`;
      h += `<span>${filtered.length} of ${STATE.enriched.length} bounties</span>`;
      h += `<span>Updated ${ageText(STATE.lastFetchTs)}</span>`;
      h += `</div>`;
    }

    /* ─ Bounty list ─ */
    if (STATE.enriched.length > 0 && !STATE.fetching) {
      const filtered = filteredBounties();

      if (filtered.length === 0) {
        h += `<div style="padding:12px;text-align:center;color:#888;font-size:12px;">No bounties match your filters</div>`;
      } else {
        h += `<div style="max-height:50vh;overflow-y:auto;">`;
        for (const b of filtered) {
          const timerStr = (b.state === 'hospital' || b.state === 'jail') && b.remainingSec > 0
            ? ` (${formatSecondsShort(b.remainingSec)})`
            : '';
          const sColor = stateColor(b.state);
          const sIcon = stateIcon(b.state);

          h += `<div class="tpda-bty-row">`;

          /* State icon */
          h += `<span style="color:${sColor};font-size:14px;min-width:18px;text-align:center;" title="${escapeHtml(b.stateLabel)}">${sIcon}</span>`;

          /* Name + level + stats */
          h += `<div style="flex:1;min-width:0;">`;
          h += `<a class="tpda-bty-name-link" href="${profileUrl(b.targetId)}" target="_blank">${escapeHtml(b.targetName)}</a>`;
          h += ` <span style="color:#888;font-size:10px;">Lv${b.targetLevel}</span>`;
          const statLine = b.statEstimate
            ? `<span style="color:${b.statEstimate.color};font-size:10px;"> ${escapeHtml(b.statEstimate.label)}</span>`
            : '';
          h += `<div style="font-size:10px;color:${sColor};">${escapeHtml(b.stateLabel)}${timerStr}${statLine}</div>`;
          h += `</div>`;

          /* Reward */
          h += `<div style="text-align:right;min-width:60px;">`;
          h += `<div style="font-size:11px;color:#4caf50;font-weight:bold;">${formatMoney(b.reward)}</div>`;
          if (b.quantity > 1) h += `<div style="font-size:9px;color:#888;">x${b.quantity}</div>`;
          h += `</div>`;

          /* Attack button */
          h += `<a class="tpda-bty-attack" href="${attackUrl(b.targetId)}" target="_blank">Attack</a>`;

          h += `</div>`;
        }
        h += `</div>`;
      }
    } else if (!STATE.fetching && !STATE.enriching && STATE.lastFetchTs === 0 && STATE.apiKey) {
      h += `<div style="padding:12px;text-align:center;color:#888;font-size:12px;">Tap Refresh to load bounties</div>`;
    } else if (!STATE.apiKey) {
      h += `<div style="padding:12px;text-align:center;color:#ffc107;font-size:12px;">Enter your API key below to fetch bounties</div>`;
    }

    /* ─ API key card ─ */
    h += renderApiKeyCard();

    /* ─ Debug log ─ */
    h += renderLogCard();

    body.innerHTML = h;
  }

  function filterCheckbox(key, label, checked, color) {
    return `<label class="tpda-bty-filter-row" style="color:${color};">` +
      `<input type="checkbox" data-filter="${key}" ${checked ? 'checked' : ''} />` +
      `${escapeHtml(label)}</label>`;
  }


  /* ── Init ────────────────────────────────────────────────── */

  async function init() {
    initApiKey(PDA_INJECTED_KEY);

    loadCachedStatuses();
    if (loadCachedBounties()) {
      applyEnrichment();
      addLog(`Loaded ${STATE.bounties.length} cached bounties`);
    }

    ensureStyles();
    createBubble();
    createPanel();
    window.addEventListener('resize', onResize);

    addLog('Bounty Filter initialized' + (STATE.apiKey ? '' : ' \u2014 waiting for API key'));
  }

  hookFetch();
  hookXHR();

  setTimeout(init, 1200);
})();
