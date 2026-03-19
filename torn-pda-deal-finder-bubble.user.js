// ==UserScript==
// @name         Torn PDA - Plushie Prices
// @namespace    alex.torn.pda.plushieprices.bubble
// @version      2.6.0
// @description  Fetches item market and bazaar floor prices for all 13 Torn plushies. Bazaar data via TornW3B. Shows a sortable table with best prices and set costs.
// @author       Alex + Devin
// @match        https://www.torn.com/*
// @connect      weav3r.dev
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-pda-deal-finder-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-pda-deal-finder-bubble.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* ── constants ─────────────────────────────────────────────── */
  const PDA_INJECTED_KEY = '###PDA-APIKEY###';
  const SCRIPT_KEY = 'tpda_plushie_prices_v1';
  const BUBBLE_ID = 'tpda-plushie-bubble';
  const PANEL_ID = 'tpda-plushie-panel';
  const HEADER_ID = 'tpda-plushie-header';
  const BUBBLE_SIZE = 56;
  const API_DELAY_MS = 250;
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  const PLUSHIES = [
    { id: 186, name: 'Sheep Plushie' },
    { id: 187, name: 'Teddy Bear Plushie' },
    { id: 215, name: 'Kitten Plushie' },
    { id: 258, name: 'Jaguar Plushie' },
    { id: 261, name: 'Wolverine Plushie' },
    { id: 266, name: 'Nessie Plushie' },
    { id: 268, name: 'Red Fox Plushie' },
    { id: 269, name: 'Monkey Plushie' },
    { id: 273, name: 'Chamois Plushie' },
    { id: 274, name: 'Panda Plushie' },
    { id: 281, name: 'Lion Plushie' },
    { id: 384, name: 'Camel Plushie' },
    { id: 618, name: 'Stingray Plushie' },
  ];

  /* ── state ─────────────────────────────────────────────────── */
  const STATE = {
    apiKey: '',
    apiKeySource: '',
    prices: {},
    fetching: false,
    fetchProgress: 0,
    lastFetchAt: 0,
    sortCol: 'name',
    sortAsc: true,
    ui: { minimized: true, zIndexBase: 999980 },
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



  /* ── utilities ─────────────────────────────────────────────── */
  /* ── storage ───────────────────────────────────────────────── */
  function loadCachedPrices() {
    const cached = getStorage(`${SCRIPT_KEY}_prices`, null);
    if (!cached) return;
    STATE.prices = cached.prices || {};
    STATE.lastFetchAt = cached.fetchedAt || 0;
    addLog('Loaded cached prices (' + ageText(STATE.lastFetchAt) + ')');
  }

  function saveCachedPrices() {
    setStorage(`${SCRIPT_KEY}_prices`, {
      prices: STATE.prices,
      fetchedAt: STATE.lastFetchAt
    });
  }

  /* ── bubble / panel position ───────────────────────────────── */
  /* ── UI helpers ────────────────────────────────────────────── */
  /* ── styles ────────────────────────────────────────────────── */
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
        background: linear-gradient(135deg, #9b59b6, #6c3483);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-family: Arial, sans-serif;
        font-size: 24px;
        text-align: center;
        line-height: 1.1;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.18);
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
      }
      #${PANEL_ID} {
        position: fixed;
        width: 420px;
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
      .tpda-plush-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        color: #e0e0e0;
      }
      .tpda-plush-table th {
        background: #1c1d24;
        color: #ccc;
        padding: 6px 8px;
        text-align: left;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
        border-bottom: 1px solid #333;
      }
      .tpda-plush-table th:hover { background: #2a2c36; }
      .tpda-plush-table td {
        padding: 5px 8px;
        color: #e0e0e0;
        border-bottom: 1px solid #1e1f28;
        white-space: nowrap;
      }
      .tpda-plush-table tr:hover td { background: rgba(155,89,182,0.08); }
      .tpda-plush-best { color: #8dff8d; font-weight: bold; }
      .tpda-plush-table a.tpda-price-link {
        color: inherit;
        text-decoration: none;
        border-bottom: 1px dashed rgba(255,255,255,0.2);
        cursor: pointer;
      }
      .tpda-plush-table a.tpda-price-link:hover {
        border-bottom-color: #9b59b6;
        color: #d9aaff;
      }
      .tpda-plush-table .total-row td {
        border-top: 2px solid #9b59b6;
        font-weight: bold;
        padding-top: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  /* ── create bubble ─────────────────────────────────────────── */
  function createBubble() {
    if (getBubbleEl()) return;
    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.dataset.tpdaBubble = '1';
    bubble.textContent = '\uD83E\uDDF8';

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

  /* ── create panel ──────────────────────────────────────────── */
  function createPanel() {
    if (getPanelEl()) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.display = 'none';
    panel.style.zIndex = String(STATE.ui.zIndexBase);

    panel.innerHTML = `
      <div id="${HEADER_ID}" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#1c1d24;border-bottom:1px solid #333;flex:0 0 auto;">
        <div>
          <div style="font-weight:bold;">\uD83E\uDDF8 Plushie Prices</div>
          <div style="font-size:11px;color:#bbb;">Item Market Floor &amp; Avg</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="tpda-plush-refresh" style="background:#9b59b6;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">Refresh</button>
          <button id="tpda-plush-collapse" style="background:#444;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">\u25CB</button>
        </div>
      </div>
      <div id="tpda-plush-body" style="padding:12px;overflow-y:auto;flex:1 1 auto;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('tpda-plush-refresh').addEventListener('click', () => {
      fetchAllPrices(true);
    });
    document.getElementById('tpda-plush-collapse').addEventListener('click', collapseToBubble);

    makeDraggablePanel(panel, document.getElementById(HEADER_ID));

    // Delegated click handler for common API-key and log cards
    const panelBody = document.getElementById('tpda-plush-body');
    panelBody.addEventListener('click', (e) => {
      if (handleApiKeyClick(e, panelBody, () => { fetchAllPrices(true); renderPanel(); })) return;
      handleLogClick(e, panelBody);
    });
  }

  /* ── expand / collapse hooks ─────────────────────────────────── */
  function onPanelExpand() {
    renderPanel();
    fetchAllPrices();
  }

  function onPanelCollapse() {
    if (STATE.refreshTimer) { clearInterval(STATE.refreshTimer); STATE.refreshTimer = null; }
  }

  /* ── draggable ─────────────────────────────────────────────── */
  /* ── network hooks are provided by common.js ────────────────── */

  /* ── cross-origin GET helper (PDA native → plain fetch) ───── */
  async function crossOriginGet(url) {
    /* PDA native HTTP — bypasses WebView restrictions entirely */
    if (typeof PDA_httpGet === 'function') {
      addLog('[W3B] using PDA_httpGet');
      const r = await PDA_httpGet(url, {});
      if (r && r.responseText) return JSON.parse(r.responseText);
      throw new Error(`PDA_httpGet status ${r?.status || 'unknown'}`);
    }
    /* Plain fetch — works in Tampermonkey (weav3r.dev sends CORS: *) */
    addLog('[W3B] using fetch');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  /* ── fetch plushie prices from Torn API ────────────────────── */

  async function fetchMarketData(itemId) {
    if (!STATE.apiKey) throw new Error('No API key');
    const url = `https://api.torn.com/v2/market/${itemId}/itemmarket?key=${STATE.apiKey}`;
    addLog(`[API] GET /v2/market/${itemId}/itemmarket`);
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error) throw new Error(`API error ${data.error.code}: ${data.error.error}`);
    /* v2 /market/{id}/itemmarket returns:
       { itemmarket: { item: { id, name, type, average_price }, listings: [{price, amount}, ...], cache_timestamp }, _metadata } */
    const im = data.itemmarket || {};
    const listings = im.listings || [];
    addLog(`[API] itemmarket ${itemId}: ${listings.length} listings, avg=${im.item?.average_price ?? 'n/a'}`);
    return {
      floor: listings.length ? listings[0].price : null,
      avg: im.item?.average_price ?? null,
      count: listings.length
    };
  }

  async function fetchBazaarData(itemId) {
    const url = `https://weav3r.dev/api/marketplace/${itemId}`;
    addLog(`[W3B] GET /api/marketplace/${itemId}`);
    try {
      const data = await crossOriginGet(url);
      const listings = data.listings || [];
      const top = listings[0] || {};
      const bazaarFloor = top.price ?? null;
      const bazaarSellerId = top.player_id ?? null;
      const bazaarAvg = data.bazaar_average ?? null;
      addLog(`[W3B] bazaar ${itemId}: floor=${bazaarFloor ?? 'n/a'} avg=${bazaarAvg ?? 'n/a'} (${listings.length} listings)`);
      return { bazaarFloor, bazaarAvg, bazaarCount: listings.length, bazaarSellerId };
    } catch (err) {
      addLog(`[W3B] bazaar ${itemId}: ${err.message}`);
      return { bazaarFloor: null, bazaarAvg: null, bazaarCount: 0, bazaarSellerId: null };
    }
  }

  async function fetchAllPrices(force) {
    if (STATE.fetching) { addLog('Fetch already in progress'); return; }
    if (!STATE.apiKey) {
      addLog('No API key \u2014 enter one or let PDA inject it');
      renderPanel();
      return;
    }

    STATE.fetching = true;
    STATE.fetchProgress = 0;
    addLog('Fetching prices for ' + PLUSHIES.length + ' plushies\u2026');
    renderPanel();

    for (let i = 0; i < PLUSHIES.length; i++) {
      const p = PLUSHIES[i];
      STATE.fetchProgress = i;
      try {
        /* Fetch item market (Torn API) and bazaar (TornW3B) in parallel */
        const [market, bazaar] = await Promise.all([
          fetchMarketData(p.id),
          fetchBazaarData(p.id)
        ]);
        const best = Math.min(
          market.floor ?? Infinity,
          bazaar.bazaarFloor ?? Infinity
        );
        STATE.prices[p.id] = {
          floor: market.floor,
          avg: market.avg,
          listingCount: market.count,
          bazaarFloor: bazaar.bazaarFloor,
          bazaarAvg: bazaar.bazaarAvg,
          bazaarCount: bazaar.bazaarCount,
          bazaarSellerId: bazaar.bazaarSellerId,
          best: best === Infinity ? null : best,
          fetchedAt: nowTs()
        };
        addLog(`${p.name}: market=${formatMoney(market.floor)} bazaar=${formatMoney(bazaar.bazaarFloor)} best=${formatMoney(best === Infinity ? null : best)}`);
      } catch (err) {
        addLog(`ERROR fetching ${p.name}: ${err.message}`);
      }
      if (!STATE.ui.minimized) renderPanel();
      if (i < PLUSHIES.length - 1) await sleep(API_DELAY_MS);
    }

    STATE.fetchProgress = PLUSHIES.length;
    STATE.lastFetchAt = nowTs();
    STATE.fetching = false;
    saveCachedPrices();
    setSharedApiKey(STATE.apiKey);
    addLog('All prices fetched');
    renderPanel();
  }

  /* ── render panel ──────────────────────────────────────────── */
  function getSortedPlushies() {
    const rows = PLUSHIES.map(p => {
      const d = STATE.prices[p.id] || {};
      const floor = d.floor || null;
      const bazaar = d.bazaarFloor || null;
      const best = d.best || null;
      const bazaarSellerId = d.bazaarSellerId || null;
      return { ...p, floor, bazaar, best, bazaarSellerId };
    });

    const col = STATE.sortCol;
    const dir = STATE.sortAsc ? 1 : -1;
    rows.sort((a, b) => {
      if (col === 'name') return dir * a.name.localeCompare(b.name);
      const av = a[col] || Infinity;
      const bv = b[col] || Infinity;
      return dir * (av - bv);
    });
    return rows;
  }

  function renderPanel() {
    const body = document.getElementById('tpda-plush-body');
    if (!body) return;

    let html = '';

    // API key card (common)
    html += renderApiKeyCard();

    // Status bar
    const fetchAge = STATE.lastFetchAt ? ageText(STATE.lastFetchAt) : 'never';
    const keyInfo = STATE.apiKey ? `Key: \u2022\u2022\u2022${STATE.apiKey.slice(-4)} (${STATE.apiKeySource})` : 'No API key';
    html += `<div style="margin-bottom:8px;font-size:11px;color:#888;">`;
    html += escapeHtml(keyInfo) + ' \u2022 Updated: ' + fetchAge;
    if (STATE.fetching) html += ` \u2022 Fetching ${STATE.fetchProgress + 1}/${PLUSHIES.length}\u2026`;
    html += `</div>`;

    // Price table
    const rows = getSortedPlushies();
    const arrow = (col) => STATE.sortCol === col ? (STATE.sortAsc ? ' \u25B2' : ' \u25BC') : '';

    html += `<div style="overflow-x:auto;"><table class="tpda-plush-table"><thead><tr>`;
    html += `<th data-col="name">Plushie${arrow('name')}</th>`;
    html += `<th data-col="floor">Market${arrow('floor')}</th>`;
    html += `<th data-col="bazaar">Bazaar${arrow('bazaar')}</th>`;
    html += `<th data-col="best">Best${arrow('best')}</th>`;
    html += `</tr></thead><tbody>`;

    let totalBest = 0;
    let allHavePrices = true;

    for (const r of rows) {
      if (r.best) totalBest += r.best; else allHavePrices = false;

      /* Highlight the source that provides the best price */
      const floorIsBest = r.floor && r.best && r.floor === r.best;
      const bazaarIsBest = r.bazaar && r.best && r.bazaar === r.best;
      const marketUrl = `https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${r.id}`;
      const bazaarUrl = r.bazaarSellerId
        ? `https://www.torn.com/bazaar.php?userId=${r.bazaarSellerId}#/`
        : marketUrl;
      const bestUrl = bazaarIsBest ? bazaarUrl : marketUrl;

      const priceLink = (val, url, cls) => {
        const text = formatMoney(val);
        if (!val) return `<td${cls ? ` class="${cls}"` : ''}>${text}</td>`;
        return `<td${cls ? ` class="${cls}"` : ''}><a class="tpda-price-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${text}</a></td>`;
      };

      html += `<tr>`;
      html += `<td>${escapeHtml(r.name)}</td>`;
      html += priceLink(r.floor, marketUrl, floorIsBest ? 'tpda-plush-best' : '');
      html += priceLink(r.bazaar, bazaarUrl, bazaarIsBest ? 'tpda-plush-best' : '');
      html += priceLink(r.best, bestUrl, 'tpda-plush-best');
      html += `</tr>`;
    }

    html += `<tr class="total-row">`;
    html += `<td>Full Set (13)</td><td></td><td></td>`;
    html += `<td class="tpda-plush-best">${allHavePrices ? formatMoney(totalBest) : '\u2014'}</td>`;
    html += `</tr></tbody></table></div>`;

    // Debug log (common)
    html += renderLogCard();

    body.innerHTML = html;

    // Wire up: sort headers
    body.querySelectorAll('.tpda-plush-table th[data-col]').forEach(th => {
      th.onclick = () => {
        const col = th.dataset.col;
        if (STATE.sortCol === col) STATE.sortAsc = !STATE.sortAsc;
        else { STATE.sortCol = col; STATE.sortAsc = true; }
        renderPanel();
      };
    });
  }

  /* ── resize handler ────────────────────────────────────────── */
  /* ── init ───────────────────────────────────────────────────── */
  function init() {
    initApiKey(PDA_INJECTED_KEY);
    loadCachedPrices();
    ensureStyles();
    createBubble();
    createPanel();
    window.addEventListener('resize', onResize);
    addLog('Plushie Prices initialized');
    console.log('[Plushie Prices] Started.');
  }

  // Install network hooks immediately so we capture API keys from PDA traffic
  hookFetch();
  hookXHR();

  setTimeout(init, 1200);
})();
