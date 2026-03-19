// ==UserScript==
// @name         Torn PDA - War Online Bubble (Location + Timers)
// @namespace    alex.torn.pda.war.online.location.timers.bubble
// @version      3.5.0
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
  const SECTION_MEMBER_CAP = 15; /* Max members shown per section before "Show all" */

  /* ── Stat estimation (TornPDA algorithm) ─────────────────────── */
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
  const PROFILE_CACHE_KEY = `${SCRIPT_KEY}_profile_cache`;
  const PROFILE_CACHE_TTL = 30 * 60 * 1000; // 30 min
  const SCAN_API_GAP_MS   = 650; // ~92 calls/min, under 100 limit
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
    pollMs: loadPollMs(),
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

  // #COMMON_CODE


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

  /* ── Stat estimation ─────────────────────────────────────────── */

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

  function estimateStats(rank, level, crimesTotal, networth) {
    const rs = RANK_SCORES[rank];
    if (!rs) return null;
    const ls = LEVEL_TRIGGERS.filter(t => t <= (level || 0)).length;
    const cs = CRIMES_TRIGGERS.filter(t => t <= (crimesTotal || 0)).length;
    const ns = NW_TRIGGERS.filter(t => t <= (networth || 0)).length;
    const idx = Math.max(0, Math.min(STAT_RANGES.length - 1, rs - ls - cs - ns - 1));
    return { label: STAT_RANGES[idx], color: STAT_COLORS[idx], idx };
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

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function getManualEnemyFactionId() {
    return getStorage(`${SCRIPT_KEY}_enemy_faction_id`, '');
  }

  function setManualEnemyFactionId(id) {
    setStorage(`${SCRIPT_KEY}_enemy_faction_id`, id || '');
  }

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
      return `<span class="tpda-war-timer" data-end="${member.timerEndTs}">Time left: ${formatTimerFull(remaining)}</span>`;
    }
    return `Time left: ${formatSeconds(member.timerRemainingSec)}`;
  }

  function tickTimers() {
    if (STATE.ui.minimized) return;
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
      return `
        <div style="padding:6px 0;border-top:1px solid #2a2d38;">
          <div class="${cls}">
            <strong>${mname}</strong>
            ${m.level ? ` • Lv ${escapeHtml(m.level)}` : ''}
            ${m.position ? ` • ${escapeHtml(m.position)}` : ''}
            ${est ? ` <span style="font-size:11px;color:${est.color};font-weight:bold;margin-left:4px;">[${escapeHtml(est.label)}]</span>` : ''}
          </div>
          ${profile?.rank ? `<div style="font-size:11px;color:#c4a0e8;">${escapeHtml(profile.rank)}</div>` : ''}
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
            ? 'starts in ' + formatSeconds(STATE.detectedWarInfo.startsIn)
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
