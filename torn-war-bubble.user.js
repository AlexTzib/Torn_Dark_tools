// ==UserScript==
// @name         Torn PDA - War Online Bubble (Location + Timers)
// @namespace    alex.torn.pda.war.online.location.timers.bubble
// @version      3.0.0
// @description  Local-only war bubble showing enemy faction members online/recently active, location buckets, timers, and faster-than-expected timer drops
// @author       Alex + ChatGPT
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_KEY = 'tpda_war_online_location_timers_bubble_v3';
  const BUBBLE_ID = 'tpda-war-online-bubble';
  const PANEL_ID = 'tpda-war-online-panel';
  const HEADER_ID = 'tpda-war-online-header';
  const BUBBLE_SIZE = 56;
  const POLL_MS = 60000;
  const TIMER_TRACK_KEY = `${SCRIPT_KEY}_timer_track`;

  const TIMER_TRACK_MAX_ENTRIES = 500;
  const TIMER_TRACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const STATE = {
    apiKey: null, // memory only — never persisted to storage
    apiKeySource: '', // 'manual' | 'intercepted'
    enemyFactionId: null,
    enemyFactionName: '',
    enemyMembers: [],
    lastFetchTs: 0,
    lastError: '',
    timerTrack: loadTimerTrack(),
    ui: {
      minimized: true,
      zIndexBase: 999970
    }
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
    if (STATE.apiKeySource === 'manual') return; // manual key takes priority
    try {
      const u = new URL(url, location.origin);
      const key = u.searchParams.get('key');
      if (key && key.length >= 16) {
        STATE.apiKey = key;
        STATE.apiKeySource = 'intercepted';
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

  function detectEnemyFaction() {
    const manual = getManualEnemyFactionId();
    if (manual) {
      STATE.enemyFactionId = String(manual);
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
        return;
      }
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
    const combined = normalizeText(
      member?.status,
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

    if (/\bfederal jail\b/.test(combined)) {
      return { bucket: 'jail', label: 'Federal Jail' };
    }

    if (/\bjail\b/.test(combined)) {
      return { bucket: 'jail', label: 'Jail' };
    }

    if (/traveling|travelling|in flight|flying|returning/.test(combined)) {
      return { bucket: 'traveling', label: 'In flight' };
    }

    if (/abroad|mexico|canada|argentina|hawaii|cayman|switzerland|japan|china|uae|united arab emirates|south africa/.test(combined)) {
      return { bucket: 'abroad', label: 'Abroad' };
    }

    if (/torn|okay/.test(combined)) {
      return { bucket: 'torn', label: 'In Torn' };
    }

    if (!combined) {
      return { bucket: 'unknown', label: 'Unknown location' };
    }

    return { bucket: 'unknown', label: 'Unknown location' };
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
    const candidates = [
      member?.status_detail,
      member?.status_description,
      member?.description,
      member?.details,
      member?.status,
      member?.travel?.time_left,
      member?.travel?.remaining,
      member?.travel?.description,
      member?.hospital_time,
      member?.jail_time,
      member?.last_action?.relative
    ];

    const unixCandidates = [
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

    if (!STATE.enemyFactionId) {
      STATE.lastError = 'No enemy faction detected. Open the war/opponent page or set the faction ID manually.';
      return;
    }

    if (!STATE.apiKey) {
      STATE.lastError = 'Torn PDA key not captured yet. Open a page that triggers Torn PDA API calls, then refresh.';
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

      STATE.enemyMembers = normalizeMembers(data).map(m => {
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
          timerSource: timer.source,
          fasterThanExpected: timerCheck.fasterThanExpected,
          timerDeltaSec: timerCheck.deltaSec,
          ...action
        };
      });

      STATE.enemyMembers.sort((a, b) => a.minutes - b.minutes);
      STATE.lastFetchTs = nowTs();
      saveTimerTrack();
    } catch (err) {
      STATE.lastError = String(err?.message || err || 'Unknown error');
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
      unknown: []
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
        if (m.locationBucket === 'torn') groups.onlineTorn.push(m);
        else if (away) groups.onlineAway.push(m);
        else groups.unknown.push(m);
        continue;
      }

      if (m.minutes <= 60) {
        if (m.locationBucket === 'torn') groups.recentTorn.push(m);
        else if (away) groups.recentAway.push(m);
        else groups.unknown.push(m);
        continue;
      }

      groups.unknown.push(m);
    }

    return groups;
  }

  function timerText(member) {
    if (member.timerRemainingSec == null) return 'Time left: unknown';
    return `Time left: ${formatSeconds(member.timerRemainingSec)}`;
  }

  function verifyText(member) {
    if (!member.fasterThanExpected) return '';
    const delta = member.timerDeltaSec != null ? ` • faster by ${formatSeconds(member.timerDeltaSec)}` : '';
    return `<div class="war-fastdrop">Timer dropped faster than expected${escapeHtml(delta)}</div>`;
  }

  function renderMemberList(list, cls) {
    if (!list.length) {
      return `<div class="war-muted">None</div>`;
    }

    return list.map(m => `
      <div style="padding:6px 0;border-top:1px solid #2a2d38;">
        <div class="${cls}">
          <strong>${escapeHtml(m.name)}</strong>
          ${m.level ? ` • Lv ${escapeHtml(m.level)}` : ''}
          ${m.position ? ` • ${escapeHtml(m.position)}` : ''}
        </div>
        <div style="font-size:12px;color:#bbb;">
          ${m.isOnline ? 'Online now' : `Last action: ${escapeHtml(m.relative || `${m.minutes}m`)}`} • ${escapeHtml(m.locationLabel)}
        </div>
        <div style="font-size:12px;color:#bbb;">${escapeHtml(timerText(m))}</div>
        ${verifyText(m)}
      </div>
    `).join('');
  }

  function renderPanel() {
    const body = document.getElementById('tpda-war-body');
    if (!body) return;

    const groups = groupedMembers();

    body.innerHTML = `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Target</div>
        <div>Enemy faction: ${escapeHtml(STATE.enemyFactionName || 'Unknown')}</div>
        <div>Faction ID: ${escapeHtml(STATE.enemyFactionId || 'Not set')}</div>
        <div>API key: ${STATE.apiKey ? `Active (${escapeHtml(STATE.apiKeySource || 'unknown source')})` : 'Not available'}</div>
        <div>Last refresh: ${ageText(STATE.lastFetchTs)}</div>
      </div>

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="font-weight:bold;margin-bottom:6px;">API key</div>
        <div style="font-size:11px;color:#bbb;margin-bottom:6px;">
          Preferred: paste your key below. It is stored in localStorage only.<br>
          Fallback: the script can detect the key from Torn PDA network traffic (read-only, memory-only, never sent externally).
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

      ${STATE.lastError ? `
        <div style="margin-bottom:10px;padding:10px;border:1px solid #5a2d2d;border-radius:10px;background:#221313;color:#ffb3b3;">
          ${escapeHtml(STATE.lastError)}
        </div>
      ` : ''}

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Online in Torn (${formatNumber(groups.onlineTorn.length)})</div>
        ${renderMemberList(groups.onlineTorn, 'war-on')}
      </div>

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Online abroad / in flight (${formatNumber(groups.onlineAway.length)})</div>
        ${renderMemberList(groups.onlineAway, 'war-abroad')}
      </div>

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Recently active in Torn (${formatNumber(groups.recentTorn.length)})</div>
        ${renderMemberList(groups.recentTorn, 'war-recent')}
      </div>

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Recently active abroad / in flight (${formatNumber(groups.recentAway.length)})</div>
        ${renderMemberList(groups.recentAway, 'war-abroad')}
      </div>

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Hospital (${formatNumber(groups.hospital.length)})</div>
        ${renderMemberList(groups.hospital, 'war-bad')}
      </div>

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Jail (${formatNumber(groups.jail.length)})</div>
        ${renderMemberList(groups.jail, 'war-bad')}
      </div>

      <div style="padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Unknown / other (${formatNumber(groups.unknown.length)})</div>
        ${renderMemberList(groups.unknown, 'war-unknown')}
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
        await refreshEnemyFactionData();
        renderPanel();
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
    setInterval(async () => {
      if (STATE.ui.minimized) return;
      if (!STATE.enemyFactionId || !STATE.apiKey) return;
      await refreshEnemyFactionData();
      renderPanel();
    }, POLL_MS);
  }

  function init() {
    // Load manually saved API key if available
    const savedKey = getManualApiKey();
    if (savedKey) {
      STATE.apiKey = savedKey;
      STATE.apiKeySource = 'manual';
    }

    ensureStyles();
    hookFetch();
    hookXHR();
    createBubble();
    createPanel();
    detectEnemyFaction();
    window.addEventListener('resize', onResize);
    startPolling();
    console.log('[War Online Bubble - Location + Timers] Started.');
  }

  setTimeout(init, 1200);
})();
