// ==UserScript==
// @name         Torn PDA - War Online Bubble (Location + Timers)
// @namespace    alex.torn.pda.war.online.location.timers.bubble
// @version      3.1.0
// @description  Local-only war bubble showing enemy faction members online/recently active, location buckets, timers, and faster-than-expected timer drops
// @author       Alex + ChatGPT
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
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

  const STATE = {
    apiKey: null, // memory only — never persisted to storage
    apiKeySource: '', // 'manual' | 'intercepted'
    enemyFactionId: null,
    enemyFactionName: '',
    enemyMembers: [],
    detectedWarInfo: null,
    lastFetchTs: 0,
    lastError: '',
    pollMs: loadPollMs(),
    pollTimerId: null,
    timerTickId: null,
    timerTrack: loadTimerTrack(),
    collapsed: loadCollapsedState(),
    ui: {
      minimized: true,
      zIndexBase: 999970
    },
    _logs: []
  };

  function nowTs() {
    return Date.now();
  }

  function nowUnix() {
    return Math.floor(Date.now() / 1000);
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString();
  }

  function formatSeconds(sec) {
    sec = Number(sec || 0);
    if (!Number.isFinite(sec) || sec <= 0) return 'now';
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

  function formatTimerFull(sec) {
    sec = Number(sec || 0);
    if (!Number.isFinite(sec) || sec <= 0) return 'now';
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

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString();
    STATE._logs.push(`[${ts}] ${msg}`);
    if (STATE._logs.length > 100) STATE._logs.shift();
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

  function loadPollMs() {
    const saved = getStorage(`${SCRIPT_KEY}_poll_ms`, DEFAULT_POLL_MS);
    const valid = POLL_INTERVALS.find(p => p.ms === saved);
    return valid ? saved : DEFAULT_POLL_MS;
  }

  function savePollMs(ms) {
    setStorage(`${SCRIPT_KEY}_poll_ms`, ms);
  }

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

  function getDefaultBubblePosition() {
    const existing = document.querySelectorAll('[data-tpda-bubble="1"]').length;
    return {
      right: 12,
      bottom: 12 + existing * 68
    };
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

  function getManualEnemyFactionId() {
    return getStorage(`${SCRIPT_KEY}_enemy_faction_id`, '');
  }

  function setManualEnemyFactionId(id) {
    setStorage(`${SCRIPT_KEY}_enemy_faction_id`, id || '');
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
      const clamped = clampToViewport(saved.left, saved.top, panel.offsetWidth || 390, panel.offsetHeight || 500);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = '';
      panel.style.bottom = '';
    } else {
      const bRect = bubble.getBoundingClientRect();
      let left = bRect.left - 290;
      let top = bRect.top - 120;
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      const clamped = clampToViewport(left, top, panel.offsetWidth || 390, panel.offsetHeight || 500);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = '';
      panel.style.bottom = '';
      setPanelPosition(clamped);
    }

    detectEnemyFaction();
    refreshEnemyFactionData().then(renderPanel);
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
    let startX = null;
    let startY = null;
    let originLeft = 0;
    let originTop = 0;
    let dragging = false;

    el.addEventListener('pointerdown', (e) => {
      dragging = false;
      el.dataset.dragged = '0';
      el.setPointerCapture?.(e.pointerId);
      bringToFront(el);

      const pos = getBubblePosition();
      const current = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
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

      const nextLeft = originLeft + dx;
      const nextTop = originTop + dy;
      const clamped = clampToViewport(nextLeft, nextTop, BUBBLE_SIZE, BUBBLE_SIZE);

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
        setBubblePosition(leftTopToBubbleRightBottom(left, top, BUBBLE_SIZE));
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
      if (e.target.closest('button') || e.target.closest('input')) return;
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
      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(originLeft + dx, originTop + dy, rect.width, rect.height);

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

  function getManualApiKey() {
    return getStorage(`${SCRIPT_KEY}_api_key`, '');
  }

  function setManualApiKey(key) {
    setStorage(`${SCRIPT_KEY}_api_key`, key || '');
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

      // Check ranked_wars
      const rankedWars = data?.ranked_wars || data?.rankedwars || {};
      for (const [warId, war] of Object.entries(rankedWars)) {
        const start = Number(war?.war?.start || war?.start || 0);
        const end = Number(war?.war?.end || war?.end || 0);
        if (start <= 0) continue;
        if (end > 0 && end < now) continue; // war already ended

        // Find enemy faction from factions object
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

      // Check territory_wars
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

      // Check raid_wars
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

      // Prefer in-progress wars (startsIn === 0) first, then soonest upcoming
      candidates.sort((a, b) => a.startsIn - b.startsIn);
      const best = candidates[0];
      addLog(`War detected: ${best.type} vs ${best.enemyName || best.enemyId} (${best.startsIn === 0 ? 'in progress' : 'starts in ' + formatSeconds(best.startsIn)})`);
      return best;
    } catch (err) {
      addLog('Error fetching own faction wars: ' + (err?.message || err));
      return null;
    }
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
    // Torn API returns member.status as an object: {state, description, details, color, until}
    // Extract the string fields from it rather than stringifying the object
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
      return { bucket: 'traveling', label: 'In flight' };
    }

    if (/abroad|mexico|canada|argentina|hawaii|cayman|switzerland|japan|china|uae|united arab emirates|south africa|uk|united kingdom/.test(combined)) {
      return { bucket: 'abroad', label: 'Abroad' };
    }

    if (/\bokay\b|\bin torn\b/.test(combined)) {
      return { bucket: 'torn', label: 'In Torn' };
    }

    // Fallback: check status.color — green typically means Okay/available
    if (statusObj?.color === 'green') {
      return { bucket: 'torn', label: 'In Torn' };
    }

    // Fallback: if member is online and no negative status detected, assume Torn
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
    // member.status is an object {state, description, details, color, until} — extract fields
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

  function timerHtml(member) {
    if (member.timerRemainingSec == null) return 'Time left: unknown';
    const bucket = member.locationBucket;
    const showFull = bucket === 'hospital' || bucket === 'jail' || bucket === 'traveling';
    if (showFull && member.timerEndTs) {
      const remaining = Math.max(0, member.timerEndTs - nowUnix());
      return `<span class="tpda-war-timer" data-end="${member.timerEndTs}">Time left: ${formatTimerFull(remaining)}</span>`;
    }
    return `Time left: ${formatSeconds(member.timerRemainingSec)}`;
  }

  function tickTimers() {
    const now = nowUnix();
    document.querySelectorAll('.tpda-war-timer[data-end]').forEach(el => {
      const end = Number(el.dataset.end);
      if (!end) return;
      const remaining = Math.max(0, end - now);
      el.textContent = 'Time left: ' + formatTimerFull(remaining);
    });
  }

  function verifyText(member) {
    if (!member.fasterThanExpected) return '';
    const delta = member.timerDeltaSec != null ? ` • faster by ${formatSeconds(member.timerDeltaSec)}` : '';
    return `<div class="war-fastdrop">Timer dropped faster than expected${escapeHtml(delta)}</div>`;
  }

  function attackUrl(memberId) {
    return `https://www.torn.com/loader.php?sid=attack&user2ID=${encodeURIComponent(memberId)}`;
  }

  function copyToClipboard(text, buttonEl) {
    navigator.clipboard.writeText(text).then(() => {
      if (buttonEl) {
        const orig = buttonEl.textContent;
        buttonEl.textContent = 'Copied!';
        setTimeout(() => { buttonEl.textContent = orig; }, 1200);
      }
    }).catch(() => {});
  }

  function renderMemberList(list, cls) {
    if (!list.length) {
      return `<div class="war-muted">None</div>`;
    }

    return list.map(m => {
      const mid = escapeHtml(m.id);
      const mname = escapeHtml(m.name);
      const atkUrl = attackUrl(m.id);
      return `
        <div style="padding:6px 0;border-top:1px solid #2a2d38;">
          <div class="${cls}">
            <strong>${mname}</strong>
            ${m.level ? ` • Lv ${escapeHtml(m.level)}` : ''}
            ${m.position ? ` • ${escapeHtml(m.position)}` : ''}
          </div>
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

  function renderSection(key, title, list, cls) {
    const collapsed = STATE.collapsed[key] || false;
    const arrow = collapsed ? '\u25B6' : '\u25BC';
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div class="tpda-war-section-toggle" data-section="${key}" style="font-weight:bold;cursor:pointer;user-select:none;">
          ${arrow} ${title} (${formatNumber(list.length)})
        </div>
        ${collapsed ? '' : `<div style="margin-top:6px;">${renderMemberList(list, cls)}</div>`}
      </div>
    `;
  }

  function renderPanel() {
    const body = document.getElementById('tpda-war-body');
    if (!body) return;

    // Recalculate startsIn for live countdown
    if (STATE.detectedWarInfo && STATE.detectedWarInfo.start) {
      STATE.detectedWarInfo.startsIn = Math.max(0, STATE.detectedWarInfo.start - Math.floor(Date.now() / 1000));
    }

    const groups = groupedMembers();

    body.innerHTML = `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Target</div>
        <div>Enemy faction: ${escapeHtml(STATE.enemyFactionName || 'Unknown')}</div>
        <div>Faction ID: ${escapeHtml(STATE.enemyFactionId || 'Not set')}</div>
        ${STATE.detectedWarInfo ? `<div style="color:#ffcc00;">
          ${escapeHtml(STATE.detectedWarInfo.type)}: ${STATE.detectedWarInfo.startsIn > 0
            ? 'starts in ' + formatSeconds(STATE.detectedWarInfo.startsIn)
            : 'in progress'}
          ${STATE.detectedWarInfo.start ? ' (' + new Date(STATE.detectedWarInfo.start * 1000).toLocaleString() + ')' : ''}
        </div>` : ''}
        ${!STATE.enemyFactionId ? '<div style="color:#ffb3b3;font-size:11px;">No war detected. Waiting for scheduled war or set faction ID manually below.</div>' : ''}
        <div>API key: ${STATE.apiKey ? `Active (${escapeHtml(STATE.apiKeySource || 'unknown source')})` : 'Not available'}</div>
        <div>Last refresh: ${ageText(STATE.lastFetchTs)}</div>
      </div>

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="font-weight:bold;margin-bottom:6px;">API key</div>
        <div style="font-size:11px;color:#bbb;margin-bottom:6px;">
          ${STATE.apiKeySource === 'pda'
            ? 'Using Torn PDA key automatically. Manual entry below is optional (overrides PDA key).'
            : 'In Torn PDA the key is loaded automatically. Outside PDA, paste your key below.'}
        </div>
        <div style="display:flex;gap:8px;">
          <input id="tpda-war-api-key-input" type="password" value="${escapeHtml(getManualApiKey())}" placeholder="Your Torn API key"
                 style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:8px;padding:8px;" />
          <button id="tpda-war-save-key" style="background:#444;color:white;border:none;border-radius:8px;padding:8px 10px;">Save</button>
        </div>
      </div>

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

      ${renderSection('onlineTorn', 'Online in Torn', groups.onlineTorn, 'war-on')}
      ${renderSection('onlineAway', 'Online abroad / in flight', groups.onlineAway, 'war-abroad')}
      ${renderSection('recentTorn', 'Recently active in Torn', groups.recentTorn, 'war-recent')}
      ${renderSection('recentAway', 'Recently active abroad / in flight', groups.recentAway, 'war-abroad')}
      ${renderSection('hospital', 'Hospital', groups.hospital, 'war-bad')}
      ${renderSection('jail', 'Jail', groups.jail, 'war-bad')}
      ${renderSection('shortOffline', 'Offline 1\u201324h', groups.shortOffline, 'war-muted')}
      ${renderSection('longOffline', 'Offline >24h', groups.longOffline, 'war-unknown')}

      <div style="margin-top:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#0f1116;">
        <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" id="tpda-war-log-toggle">
          <div style="font-weight:bold;font-size:12px;">Debug Log (${STATE._logs.length})</div>
          <div style="display:flex;gap:6px;">
            <button id="tpda-war-log-copy" style="font-size:11px;background:#444;color:#fff;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;">Copy Log</button>
            <span style="font-size:11px;color:#bbb;">tap to toggle</span>
          </div>
        </div>
        <div id="tpda-war-log-body" style="display:none;margin-top:8px;max-height:200px;overflow-y:auto;font-size:11px;color:#aaa;font-family:monospace;white-space:pre-wrap;word-break:break-all;">
${STATE._logs.map(l => escapeHtml(l)).join('\n')}
        </div>
      </div>
    `;

    const saveKeyBtn = document.getElementById('tpda-war-save-key');
    if (saveKeyBtn) {
      saveKeyBtn.onclick = async () => {
        const input = document.getElementById('tpda-war-api-key-input');
        const val = String(input?.value || '').trim();
        setManualApiKey(val);
        if (val) {
          STATE.apiKey = val;
          STATE.apiKeySource = 'manual';
        } else {
          STATE.apiKeySource = '';
        }
        addLog('Manual API key saved');
        await refreshEnemyFactionData();
        renderPanel();
      };
    }

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

    // Delegated click handler for copy buttons
    const warBody = document.getElementById('tpda-war-body');
    if (warBody) {
      warBody.addEventListener('click', (e) => {
        const btn = e.target.closest('.tpda-war-copy-btn');
        if (btn) {
          const text = btn.dataset.copy || '';
          if (text) copyToClipboard(text, btn);
          return;
        }
        const toggle = e.target.closest('.tpda-war-section-toggle');
        if (toggle) {
          const key = toggle.dataset.section;
          if (key) {
            STATE.collapsed[key] = !STATE.collapsed[key];
            saveCollapsedState();
            renderPanel();
          }
        }
      });
    }

    // Start live timer ticking for hospital/jail/flight seconds
    if (!STATE.timerTickId) {
      STATE.timerTickId = setInterval(tickTimers, 1000);
    }

    const logToggle = document.getElementById('tpda-war-log-toggle');
    if (logToggle) {
      logToggle.onclick = (e) => {
        if (e.target.closest('button')) return;
        const logBody = document.getElementById('tpda-war-log-body');
        if (logBody) logBody.style.display = logBody.style.display === 'none' ? 'block' : 'none';
      };
    }

    const logCopyBtn = document.getElementById('tpda-war-log-copy');
    if (logCopyBtn) {
      logCopyBtn.onclick = () => {
        const text = STATE._logs.join('\n');
        navigator.clipboard.writeText(text).then(() => {
          logCopyBtn.textContent = 'Copied!';
          setTimeout(() => { logCopyBtn.textContent = 'Copy Log'; }, 1200);
        }).catch(() => {});
      };
    }
  }

  function onResize() {
    const bubble = getBubbleEl();
    const panel = getPanelEl();

    if (bubble && bubble.style.display !== 'none') {
      const pos = getBubblePosition();
      const current = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
      const clamped = clampToViewport(current.left, current.top, BUBBLE_SIZE, BUBBLE_SIZE);
      const next = leftTopToBubbleRightBottom(clamped.left, clamped.top, BUBBLE_SIZE);
      setBubblePosition(next);
      bubble.style.left = '';
      bubble.style.top = '';
      bubble.style.right = `${next.right}px`;
      bubble.style.bottom = `${next.bottom}px`;
    }

    if (panel && panel.style.display !== 'none') {
      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(rect.left, rect.top, rect.width, rect.height);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = '';
      panel.style.bottom = '';
      setPanelPosition({ left: clamped.left, top: clamped.top });
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
    // Priority 1: PDA-injected key (automatic, zero config)
    if (PDA_INJECTED_KEY.length >= 16 && !PDA_INJECTED_KEY.includes('#')) {
      STATE.apiKey = PDA_INJECTED_KEY;
      STATE.apiKeySource = 'pda';
      addLog('API key loaded from Torn PDA');
    }

    // Priority 2: manually saved key
    if (!STATE.apiKey) {
      const savedKey = getManualApiKey();
      if (savedKey) {
        STATE.apiKey = savedKey;
        STATE.apiKeySource = 'manual';
        addLog('API key loaded from manual entry');
      }
    }

    // Priority 3: network interception (hookFetch/hookXHR) fills it in later

    ensureStyles();
    createBubble();
    createPanel();
    await detectEnemyFaction();
    window.addEventListener('resize', onResize);
    startPolling();
    console.log('[War Online Bubble - Location + Timers] Started.');
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
