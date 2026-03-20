// ==UserScript==
// @name         Dark Tools - Bounty Filter
// @namespace    alex.torn.pda.bountyfilter.bubble
// @version      1.0.0
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

  const CACHE_TTL_MS = 2 * 60 * 1000; /* 2-minute cache for bounty list */
  const STATUS_CACHE_TTL_MS = 60 * 1000; /* 1-minute cache for individual target status */
  const STATUS_FETCH_GAP_MS = 350; /* gap between status lookups (~170/min, shared with other scripts) */
  const MAX_STATUS_LOOKUPS = 30; /* max targets to enrich per refresh (controls API usage) */

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

  // #COMMON_CODE


  /* ── Panel expand/collapse hooks ─────────────────────────── */
  function onPanelExpand() {
    renderPanel();
    if (!STATE.fetching && (!STATE.lastFetchTs || Date.now() - STATE.lastFetchTs > CACHE_TTL_MS)) {
      fetchBounties();
    }
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
        const url = `https://api.torn.com/user/${tid}?selections=profile&key=${STATE.apiKey}&_tpda=1`;
        let data;
        if (typeof PDA_httpGet === 'function') {
          const resp = await PDA_httpGet(url, {});
          data = safeJsonParse(resp?.responseText);
        } else {
          const r = await fetch(url);
          data = await r.json();
        }

        if (data && !data.error) {
          const loc = inferLocationState(data);
          const timer = extractTimerInfo(data, loc.bucket);
          STATE.statusCache[tid] = {
            state: loc.bucket,
            label: loc.label,
            level: data.level || 0,
            name: data.name || '',
            remainingSec: timer.remainingSec,
            timerSource: timer.source,
            lastAction: data.last_action,
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
      } else if (el.type === 'number') {
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

          /* Name + level */
          h += `<div style="flex:1;min-width:0;">`;
          h += `<a class="tpda-bty-name-link" href="${profileUrl(b.targetId)}" target="_blank">${escapeHtml(b.targetName)}</a>`;
          h += ` <span style="color:#888;font-size:10px;">Lv${b.targetLevel}</span>`;
          h += `<div style="font-size:10px;color:${sColor};">${escapeHtml(b.stateLabel)}${timerStr}</div>`;
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
