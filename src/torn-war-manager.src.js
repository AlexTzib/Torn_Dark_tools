// ==UserScript==
// @name         Torn PDA - War Manager Bubble
// @namespace    alex.torn.pda.war.manager.bubble
// @version      1.0.0
// @description  War target assignment manager — scans both factions, estimates stats, assigns targets by stat percentage, generates copy-paste messages
// @author       Alex + ChatGPT
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-war-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-war-manager.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PDA_INJECTED_KEY = '###PDA-APIKEY###';

  const SCRIPT_KEY = 'tpda_war_manager_v1';
  const BUBBLE_ID = 'tpda-war-mgr-bubble';
  const PANEL_ID = 'tpda-war-mgr-panel';
  const HEADER_ID = 'tpda-war-mgr-header';
  const BUBBLE_SIZE = 56;

  const POLL_INTERVALS = [
    { label: '1 min', ms: 60000 },
    { label: '2 min', ms: 120000 },
    { label: '5 min', ms: 300000 },
    { label: '10 min', ms: 600000 }
  ];
  const DEFAULT_POLL_MS = 120000;
  const DEFAULT_THRESHOLD_PCT = 70;

  const STATE = {
    apiKey: null,
    apiKeySource: '',
    ownFactionId: null,
    ownFactionName: '',
    ownMembers: [],        // processed member objects
    enemyFactionId: null,
    enemyFactionName: '',
    enemyMembers: [],      // processed member objects
    detectedWarInfo: null,
    lastFetchTs: 0,
    lastError: '',
    pollMs: loadPollMs(),
    pollTimerId: null,
    thresholdPct: loadThresholdPct(),
    assignments: [],       // { own, enemy } pairs
    profileCache: {},      // id -> { rank, level, crimesTotal, networth, estimate, fetchedAt }
    scanning: false,
    scanProgress: 0,
    scanTotal: 0,
    ui: {
      minimized: true,
      zIndexBase: 999960
    },
    _logs: []
  };

  // #COMMON_CODE

  /* ── Storage helpers ───────────────────────────────────────── */

  function loadPollMs() {
    const saved = getStorage(`${SCRIPT_KEY}_poll_ms`, DEFAULT_POLL_MS);
    return POLL_INTERVALS.some(p => p.ms === saved) ? saved : DEFAULT_POLL_MS;
  }

  function savePollMs(ms) {
    setStorage(`${SCRIPT_KEY}_poll_ms`, ms);
  }

  function loadThresholdPct() {
    const saved = getStorage(`${SCRIPT_KEY}_threshold_pct`, DEFAULT_THRESHOLD_PCT);
    return Math.max(10, Math.min(100, Number(saved) || DEFAULT_THRESHOLD_PCT));
  }

  function saveThresholdPct(pct) {
    setStorage(`${SCRIPT_KEY}_threshold_pct`, pct);
  }

  function getManualEnemyFactionId() {
    return getStorage(`${SCRIPT_KEY}_enemy_faction_id`, '');
  }

  function setManualEnemyFactionId(id) {
    setStorage(`${SCRIPT_KEY}_enemy_faction_id`, String(id || ''));
  }

  /* ── Faction data fetching ─────────────────────────────────── */

  async function fetchOwnFactionMembers() {
    if (!STATE.apiKey) return;
    try {
      const url = `https://api.torn.com/faction/?selections=basic&key=${encodeURIComponent(STATE.apiKey)}`;
      addLog('Fetching own faction members...');
      const res = await fetch(url, { method: 'GET' });
      const data = await res.json();
      if (data?.error) {
        addLog('Own faction API error: ' + (data.error.error || JSON.stringify(data.error)));
        return;
      }
      STATE.ownFactionId = String(data?.ID || data?.id || '');
      STATE.ownFactionName = data?.name || '';
      addLog('Own faction: ' + (STATE.ownFactionName || STATE.ownFactionId));

      const raw = normalizeMembers(data);
      STATE.ownMembers = raw.map(m => {
        const action = memberLastActionInfo(m);
        const loc = inferLocationState(m);
        const timer = extractTimerInfo(m, loc.bucket);
        return {
          id: String(m.id || ''),
          name: String(m.name || ''),
          level: m.level || '',
          position: m.position || '',
          isOnline: action.isOnline,
          minutes: action.minutes,
          relative: action.relative,
          locationBucket: loc.bucket,
          locationLabel: loc.label,
          remainingSec: timer.remainingSec,
          timerSource: timer.source
        };
      });
      addLog(`Own faction: ${STATE.ownMembers.length} members loaded`);
    } catch (err) {
      STATE.lastError = 'Error fetching own faction: ' + (err?.message || err);
      addLog(STATE.lastError);
    }
  }

  async function fetchEnemyFactionMembers() {
    if (!STATE.apiKey || !STATE.enemyFactionId) return;
    STATE.lastError = '';
    try {
      const url = `https://api.torn.com/faction/${encodeURIComponent(STATE.enemyFactionId)}?selections=basic&key=${encodeURIComponent(STATE.apiKey)}`;
      addLog('Fetching enemy faction members...');
      const res = await fetch(url, { method: 'GET' });
      const data = await res.json();
      if (data?.error) {
        STATE.lastError = 'Enemy faction API error: ' + (data.error.error || JSON.stringify(data.error));
        addLog(STATE.lastError);
        return;
      }
      STATE.enemyFactionName = data?.name || STATE.enemyFactionName;

      const raw = normalizeMembers(data);
      STATE.enemyMembers = raw.map(m => {
        const action = memberLastActionInfo(m);
        const loc = inferLocationState(m);
        const timer = extractTimerInfo(m, loc.bucket);
        return {
          id: String(m.id || ''),
          name: String(m.name || ''),
          level: m.level || '',
          position: m.position || '',
          isOnline: action.isOnline,
          minutes: action.minutes,
          relative: action.relative,
          locationBucket: loc.bucket,
          locationLabel: loc.label,
          remainingSec: timer.remainingSec,
          timerSource: timer.source
        };
      });
      STATE.lastFetchTs = nowTs();
      addLog(`Enemy faction: ${STATE.enemyMembers.length} members loaded`);
    } catch (err) {
      STATE.lastError = 'Error fetching enemy faction: ' + (err?.message || err);
      addLog(STATE.lastError);
    }
  }

  async function detectEnemyFaction() {
    const manual = getManualEnemyFactionId();
    if (manual) {
      STATE.enemyFactionId = String(manual);
      addLog('Using manual enemy faction ID: ' + manual);
      return;
    }

    const warInfo = await fetchOwnFactionWars();
    if (warInfo) {
      STATE.enemyFactionId = warInfo.enemyId;
      STATE.enemyFactionName = warInfo.enemyName || '';
      STATE.detectedWarInfo = warInfo;
      addLog('Auto-detected enemy from API: ' + warInfo.enemyId);
    }
  }

  async function refreshAll() {
    await fetchOwnFactionMembers();
    await fetchEnemyFactionMembers();
    computeAssignments();
    renderPanel();
  }

  /* ── Stat scanning ─────────────────────────────────────────── */

  async function scanAllStats() {
    if (STATE.scanning) { STATE.scanning = false; return; }
    if (!STATE.apiKey) { addLog('No API key for scan'); return; }

    const allIds = [
      ...STATE.ownMembers.map(m => m.id),
      ...STATE.enemyMembers.map(m => m.id)
    ].filter(Boolean);

    const toScan = allIds.filter(id => {
      const c = STATE.profileCache[id];
      return !c || (nowTs() - c.fetchedAt) >= PROFILE_CACHE_TTL;
    });

    if (!toScan.length) {
      addLog('All profiles already cached');
      computeAssignments();
      renderPanel();
      return;
    }

    STATE.scanning = true;
    STATE.scanProgress = 0;
    STATE.scanTotal = toScan.length;
    addLog(`Scanning stats for ${toScan.length} members (${allIds.length - toScan.length} cached)...`);
    renderPanel();

    for (let i = 0; i < toScan.length; i++) {
      if (!STATE.scanning) break;
      STATE.scanProgress = i + 1;
      await fetchMemberProfile(toScan[i]);
      if (i < toScan.length - 1) await sleep(SCAN_API_GAP_MS);
      if ((i + 1) % 5 === 0 || i === toScan.length - 1) {
        computeAssignments();
        renderPanel();
      }
    }

    STATE.scanning = false;
    saveProfileCache();
    addLog('Stat scan complete');
    computeAssignments();
    renderPanel();
  }

  /* ── Target assignment algorithm ───────────────────────────── */

  function computeAssignments() {
    const pct = STATE.thresholdPct / 100;

    // Get online/available own members with stat data
    const ownAvailable = STATE.ownMembers
      .filter(m => m.isOnline && m.locationBucket === 'torn')
      .map(m => {
        const p = STATE.profileCache[m.id];
        return { ...m, estimate: p?.estimate || null, midpoint: p?.estimate ? STAT_MIDPOINTS[p.estimate.idx] : 0 };
      })
      .filter(m => m.estimate)
      .sort((a, b) => b.midpoint - a.midpoint); // strongest first

    // Get targetable enemies (not in jail, preferring online/torn/hospital)
    const enemies = STATE.enemyMembers
      .filter(m => m.locationBucket !== 'jail')
      .map(m => {
        const p = STATE.profileCache[m.id];
        return { ...m, estimate: p?.estimate || null, midpoint: p?.estimate ? STAT_MIDPOINTS[p.estimate.idx] : 0 };
      })
      .filter(m => m.estimate);

    // Sort enemies: online in Torn first, then hospital (soon out), then others
    enemies.sort((a, b) => {
      const prio = (m) => {
        if (m.isOnline && m.locationBucket === 'torn') return 0;
        if (m.locationBucket === 'hospital' && m.remainingSec != null && m.remainingSec < 600) return 1;
        if (m.isOnline) return 2;
        if (m.locationBucket === 'hospital') return 3;
        if (m.minutes <= 60) return 4;
        return 5;
      };
      return prio(a) - prio(b) || a.midpoint - b.midpoint;
    });

    const assigned = new Set();
    const assignments = [];

    for (const own of ownAvailable) {
      const maxTargetStats = own.midpoint * pct;
      const targets = enemies.filter(e =>
        !assigned.has(e.id) && e.midpoint <= maxTargetStats
      );

      if (targets.length > 0) {
        // Pick the strongest target within range
        const target = targets[targets.length - 1];
        assigned.add(target.id);
        assignments.push({ own, enemy: target });
      }
    }

    STATE.assignments = assignments;
    addLog(`Assignments computed: ${assignments.length} pairs (${ownAvailable.length} available, threshold ${STATE.thresholdPct}%)`);
  }

  /* ── Message generation ────────────────────────────────────── */

  function profileUrl(id) {
    return `https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}`;
  }

  function attackUrl(id) {
    return `https://www.torn.com/loader.php?sid=attack&user2ID=${encodeURIComponent(id)}`;
  }

  function generateAssignmentMessages() {
    if (!STATE.assignments.length) return 'No assignments yet. Scan stats first!';

    return STATE.assignments.map(({ own, enemy }) => {
      const ownName = own.name;
      const enemyName = enemy.name;
      const enemyProfile = profileUrl(enemy.id);
      const enemyAttack = attackUrl(enemy.id);
      const enemyEst = enemy.estimate ? ` [${enemy.estimate.label}]` : '';

      let hospNote = '';
      if (enemy.locationBucket === 'hospital' && enemy.remainingSec != null) {
        hospNote = ` (in hospital, out in ${formatSeconds(enemy.remainingSec)})`;
      }

      return `${ownName} -> ${enemyName}${enemyEst}${hospNote}\n  Profile: ${enemyProfile}\n  Attack: ${enemyAttack}`;
    }).join('\n\n');
  }

  function generateCompactMessages() {
    if (!STATE.assignments.length) return 'No assignments yet.';

    return STATE.assignments.map(({ own, enemy }) => {
      const est = enemy.estimate ? ` [${enemy.estimate.label}]` : '';
      let hospNote = '';
      if (enemy.locationBucket === 'hospital' && enemy.remainingSec != null) {
        hospNote = ` \u23F0 out in ${formatSeconds(enemy.remainingSec)}`;
      }
      return `${own.name} \u2192 ${enemy.name}${est}${hospNote} ${profileUrl(enemy.id)}`;
    }).join('\n');
  }

  /* ── UI ─────────────────────────────────────────────────────── */

  function onPanelExpand() {
    if (!STATE.apiKey) return;
    // Always refresh on open; detectEnemyFaction is cheap if already set
    if (!STATE.enemyFactionId) detectEnemyFaction();
    refreshAll();
  }

  function onPanelCollapse() {
    // Cancel any running scan to save API calls while minimized
    if (STATE.scanning) {
      STATE.scanning = false;
      addLog('Scan cancelled (panel closed)');
    }
  }

  function ensureStyles() {
    if (document.getElementById('tpda-war-mgr-styles')) return;
    const style = document.createElement('style');
    style.id = 'tpda-war-mgr-styles';
    style.textContent = `
      #${BUBBLE_ID} {
        position: fixed;
        width: ${BUBBLE_SIZE}px; height: ${BUBBLE_SIZE}px;
        border-radius: 50%;
        background: linear-gradient(135deg, #e67e22, #b35900);
        color: white;
        display: flex; align-items: center; justify-content: center;
        font-weight: bold; font-size: 11px;
        cursor: pointer; user-select: none;
        box-shadow: 0 2px 12px rgba(230,126,34,0.35);
        z-index: 999960;
        transition: box-shadow 0.2s;
      }
      #${BUBBLE_ID}:hover { box-shadow: 0 4px 20px rgba(230,126,34,0.6); }

      #${PANEL_ID} {
        position: fixed;
        width: 440px; max-height: 85vh;
        background: #181a20; color: #e0e0e0;
        border: 1px solid #2f3340; border-radius: 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.45);
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 13px;
        display: none; flex-direction: column;
        z-index: 999960;
        overflow: hidden;
      }
      #${HEADER_ID} {
        padding: 12px 14px;
        background: #1f2130;
        cursor: grab;
        display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid #2f3340;
        font-weight: bold; font-size: 14px;
      }
      #tpda-war-mgr-body {
        padding: 12px 14px;
        overflow-y: auto; flex: 1;
      }
      .mgr-own { color: #7ecfff; }
      .mgr-enemy { color: #ff8a8a; }
      .mgr-assign { padding: 8px; margin-bottom: 6px; border: 1px solid #2f3340; border-radius: 8px; background: #1a1c24; }
      .mgr-muted { color: #888; font-size: 12px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function createBubble() {
    if (document.getElementById(BUBBLE_ID)) return;
    const el = document.createElement('div');
    el.id = BUBBLE_ID;
    el.dataset.tpdaBubble = '1';
    el.textContent = 'MGR';

    const pos = getBubblePosition();
    const lt = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
    const clamped = clampToViewport(lt.left, lt.top, BUBBLE_SIZE, BUBBLE_SIZE);
    el.style.left = `${clamped.left}px`;
    el.style.top = `${clamped.top}px`;

    el.addEventListener('click', (e) => {
      if (el.dataset.dragged === '1') { el.dataset.dragged = '0'; return; }
      expandPanelNearBubble();
      renderPanel();
    });

    (document.body || document.documentElement).appendChild(el);
    makeDraggableBubble(el);
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div id="${HEADER_ID}">
        <span>\u2694\uFE0F War Manager</span>
        <button id="tpda-war-mgr-close"
                style="background:none;border:none;color:#e0e0e0;font-size:18px;cursor:pointer;padding:0 4px;">\u2715</button>
      </div>
      <div id="tpda-war-mgr-body"></div>
    `;
    (document.body || document.documentElement).appendChild(panel);

    document.getElementById('tpda-war-mgr-close').onclick = collapseToBubble;

    const body = document.getElementById('tpda-war-mgr-body');
    body.addEventListener('click', (e) => {
      // Copy buttons
      const copyBtn = e.target.closest('.tpda-mgr-copy-btn');
      if (copyBtn) {
        const text = copyBtn.dataset.copy;
        if (text) copyToClipboard(text, copyBtn);
        return;
      }

      // API key card
      if (handleApiKeyClick(e, body, () => renderPanel())) return;

      // Log card
      if (handleLogClick(e, body)) return;
    });

    makeDraggablePanel(panel, document.getElementById(HEADER_ID));
  }

  /* ── Rendering ──────────────────────────────────────────────── */

  let _rafId = null;
  function renderPanel() {
    if (_rafId) return;
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      _renderPanelNow();
    });
  }

  function _renderPanelNow() {
    const body = document.getElementById('tpda-war-mgr-body');
    if (!body) return;

    const ownOnline = STATE.ownMembers.filter(m => m.isOnline && m.locationBucket === 'torn');
    const enemyOnline = STATE.enemyMembers.filter(m => m.isOnline);
    const enemyHospital = STATE.enemyMembers.filter(m => m.locationBucket === 'hospital');
    const enemyAvailable = STATE.enemyMembers.filter(m => m.locationBucket !== 'jail');

    body.innerHTML = `
      ${renderWarStatusCard(ownOnline, enemyOnline, enemyHospital)}
      ${renderApiKeyCard()}
      ${renderFactionIdCard()}
      ${renderSettingsCard()}
      ${renderActionBar()}
      ${STATE.lastError ? `<div style="margin-bottom:10px;padding:10px;border:1px solid #5a2d2d;border-radius:10px;background:#221313;color:#ffb3b3;">${escapeHtml(STATE.lastError)}</div>` : ''}
      ${renderAssignmentsCard()}
      ${renderFactionList('Own Faction \u2014 Online in Torn', ownOnline, 'mgr-own')}
      ${renderFactionList('Enemy \u2014 Available Targets', enemyAvailable, 'mgr-enemy')}
      ${renderLogCard()}
    `;

    attachPanelHandlers();
  }

  function renderWarStatusCard(ownOnline, enemyOnline, enemyHospital) {
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">\u2694\uFE0F War Status</div>
        <div>Own faction: <strong>${escapeHtml(STATE.ownFactionName || 'Unknown')}</strong> (${ownOnline.length} online in Torn)</div>
        <div>Enemy faction: <strong>${escapeHtml(STATE.enemyFactionName || 'Unknown')}</strong> (${enemyOnline.length} online, ${enemyHospital.length} hospital)</div>
        <div>Enemy ID: ${escapeHtml(STATE.enemyFactionId || 'Not set')}</div>
        ${STATE.detectedWarInfo ? `<div style="color:#ffcc00;">
          ${escapeHtml(STATE.detectedWarInfo.type)}: ${STATE.detectedWarInfo.startsIn > 0
            ? 'starts in ' + formatSeconds(STATE.detectedWarInfo.startsIn)
            : 'in progress'}
        </div>` : ''}
        <div>Last refresh: ${ageText(STATE.lastFetchTs)}</div>
      </div>`;
  }

  function renderFactionIdCard() {
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="font-weight:bold;margin-bottom:6px;">Enemy Faction ID</div>
        <div style="display:flex;gap:8px;">
          <input id="tpda-mgr-faction-input" type="text" value="${escapeHtml(getManualEnemyFactionId())}" placeholder="Enemy faction ID"
                 style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:8px;padding:8px;" />
          <button id="tpda-mgr-save-id" style="background:#444;color:white;border:none;border-radius:8px;padding:8px 10px;">Save</button>
        </div>
      </div>`;
  }

  function renderSettingsCard() {
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="font-weight:bold;margin-bottom:6px;">Settings</div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <label style="font-size:12px;color:#bbb;white-space:nowrap;">Stat threshold:</label>
          <input id="tpda-mgr-threshold" type="number" min="10" max="100" step="5" value="${STATE.thresholdPct}"
                 style="width:60px;background:#0f1116;color:#fff;border:1px solid #444;border-radius:8px;padding:6px;text-align:center;" />
          <span style="font-size:12px;color:#bbb;">%</span>
          <span style="font-size:11px;color:#888;">Assign targets at most this % of attacker's estimated stats</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <label style="font-size:12px;color:#bbb;white-space:nowrap;">Refresh rate:</label>
          <select id="tpda-mgr-poll-select"
                  style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:8px;padding:6px;font-size:12px;">
            ${POLL_INTERVALS.map(p => `<option value="${p.ms}"${p.ms === STATE.pollMs ? ' selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
          </select>
        </div>
      </div>`;
  }

  function renderActionBar() {
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button id="tpda-mgr-scan" style="background:${STATE.scanning ? '#d64545' : '#e67e22'};color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;">
            ${STATE.scanning ? 'Stop Scan' : 'Scan All Stats'}
          </button>
          <button id="tpda-mgr-refresh" style="background:#2a6df4;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;">
            Refresh Data
          </button>
          <span style="font-size:11px;color:#bbb;">
            ${STATE.scanning
              ? `Scanning... ${STATE.scanProgress}/${STATE.scanTotal}`
              : `${Object.keys(STATE.profileCache).length} profiles cached`}
          </span>
        </div>
      </div>`;
  }

  function renderAssignmentsCard() {
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-weight:bold;">\uD83C\uDFAF Target Assignments (${STATE.assignments.length})</div>
          <div style="display:flex;gap:6px;">
            <button class="tpda-mgr-copy-btn" data-copy="${escapeHtml(generateCompactMessages())}"
                    style="font-size:11px;background:#e67e22;color:#fff;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;">
              Copy Compact
            </button>
            <button class="tpda-mgr-copy-btn" data-copy="${escapeHtml(generateAssignmentMessages())}"
                    style="font-size:11px;background:#2a6df4;color:#fff;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;">
              Copy Detailed
            </button>
          </div>
        </div>
        ${renderAssignments()}
      </div>`;
  }

  function renderFactionList(title, list, cls) {
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">${escapeHtml(title)} (${list.length})</div>
        ${renderMemberRows(list, cls)}
      </div>`;
  }

  function attachPanelHandlers() {
    const saveIdBtn = document.getElementById('tpda-mgr-save-id');
    if (saveIdBtn) {
      saveIdBtn.onclick = async () => {
        const input = document.getElementById('tpda-mgr-faction-input');
        const val = String(input?.value || '').trim();
        setManualEnemyFactionId(val);
        STATE.enemyFactionId = val || null;
        addLog('Enemy faction ID saved: ' + val);
        await refreshAll();
      };
    }

    const thresholdInput = document.getElementById('tpda-mgr-threshold');
    if (thresholdInput) {
      thresholdInput.onchange = () => {
        const val = Math.max(10, Math.min(100, Number(thresholdInput.value) || DEFAULT_THRESHOLD_PCT));
        STATE.thresholdPct = val;
        saveThresholdPct(val);
        computeAssignments();
        renderPanel();
      };
    }

    const pollSelect = document.getElementById('tpda-mgr-poll-select');
    if (pollSelect) {
      pollSelect.onchange = () => {
        const ms = Number(pollSelect.value);
        STATE.pollMs = ms;
        savePollMs(ms);
        restartPolling();
      };
    }

    const scanBtn = document.getElementById('tpda-mgr-scan');
    if (scanBtn) scanBtn.onclick = () => scanAllStats();

    const refreshBtn = document.getElementById('tpda-mgr-refresh');
    if (refreshBtn) refreshBtn.onclick = () => refreshAll();
  }

  function renderAssignments() {
    if (!STATE.assignments.length) {
      return '<div class="mgr-muted">No assignments yet. Scan stats and refresh data to generate target assignments.</div>';
    }

    return STATE.assignments.map(({ own, enemy }) => {
      const ownEst = own.estimate ? ` <span style="color:${own.estimate.color};font-size:11px;">[${escapeHtml(own.estimate.label)}]</span>` : '';
      const enemyEst = enemy.estimate ? ` <span style="color:${enemy.estimate.color};font-size:11px;">[${escapeHtml(enemy.estimate.label)}]</span>` : '';

      let hospNote = '';
      if (enemy.locationBucket === 'hospital' && enemy.remainingSec != null) {
        hospNote = `<div style="font-size:11px;color:#ffd166;">\u23F0 Out of hospital in ${formatSeconds(enemy.remainingSec)}</div>`;
      }

      const enemyStatus = enemy.isOnline
        ? '<span style="color:#4caf50;">Online</span>'
        : `<span style="color:#888;">Last action: ${escapeHtml(enemy.relative)}</span>`;

      return `
        <div class="mgr-assign">
          <div>
            <span class="mgr-own"><strong>${escapeHtml(own.name)}</strong></span>${ownEst}
            <span style="color:#bbb;"> \u2192 </span>
            <span class="mgr-enemy"><strong>${escapeHtml(enemy.name)}</strong></span>${enemyEst}
          </div>
          <div style="font-size:11px;color:#bbb;">
            ${enemyStatus} \u2022 ${escapeHtml(enemy.locationLabel)}
          </div>
          ${hospNote}
          <div style="margin-top:4px;display:flex;gap:6px;">
            <a href="${escapeHtml(attackUrl(enemy.id))}" target="_blank" rel="noopener"
               style="font-size:11px;background:#d64545;color:#fff;border:none;border-radius:6px;padding:3px 8px;text-decoration:none;">
              Attack
            </a>
            <a href="${escapeHtml(profileUrl(enemy.id))}" target="_blank" rel="noopener"
               style="font-size:11px;background:#444;color:#fff;border:none;border-radius:6px;padding:3px 8px;text-decoration:none;">
              Profile
            </a>
            <button class="tpda-mgr-copy-btn" data-copy="${escapeHtml(`${own.name} \u2192 ${enemy.name} ${enemy.estimate ? '[' + enemy.estimate.label + ']' : ''} ${profileUrl(enemy.id)}${enemy.locationBucket === 'hospital' && enemy.remainingSec != null ? ' (hospital, out in ' + formatSeconds(enemy.remainingSec) + ')' : ''}`)}"
                    style="font-size:11px;background:#2f3340;color:#bbb;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;">
              Copy
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderMemberRows(list, cls) {
    if (!list.length) return '<div class="mgr-muted">None</div>';
    const maxShow = 20;
    const visible = list.slice(0, maxShow);
    const hidden = list.length - visible.length;

    return visible.map(m => {
      const profile = STATE.profileCache[m.id];
      const est = profile?.estimate;
      let hospNote = '';
      if (m.locationBucket === 'hospital' && m.remainingSec != null) {
        hospNote = ` <span style="color:#ffd166;font-size:11px;">\u23F0 ${formatSeconds(m.remainingSec)}</span>`;
      }
      return `
        <div style="padding:4px 0;border-top:1px solid #2a2d38;font-size:12px;">
          <span class="${cls}"><strong>${escapeHtml(m.name)}</strong></span>
          ${m.level ? ` Lv${escapeHtml(m.level)}` : ''}
          ${est ? ` <span style="color:${est.color};font-weight:bold;">[${escapeHtml(est.label)}]</span>` : ''}
          <span style="color:#888;">\u2022 ${m.isOnline ? 'Online' : escapeHtml(m.relative)} \u2022 ${escapeHtml(m.locationLabel)}</span>
          ${hospNote}
        </div>
      `;
    }).join('') + (hidden > 0 ? `<div class="mgr-muted">+ ${hidden} more</div>` : '');
  }

  /* ── Polling ────────────────────────────────────────────────── */

  function startPolling() {
    if (STATE.pollTimerId) clearInterval(STATE.pollTimerId);
    STATE.pollTimerId = setInterval(async () => {
      if (STATE.ui.minimized) return;
      if (!STATE.apiKey) return;
      if (!STATE.enemyFactionId) {
        await detectEnemyFaction();
        if (STATE.enemyFactionId) renderPanel();
      }
      if (!STATE.enemyFactionId) return;
      await refreshAll();
      addLog('Poll cycle completed');
    }, STATE.pollMs);
  }

  function restartPolling() {
    startPolling();
  }

  /* ── Init ───────────────────────────────────────────────────── */

  async function init() {
    initApiKey(PDA_INJECTED_KEY);
    STATE.profileCache = loadProfileCache();

    ensureStyles();
    createBubble();
    createPanel();
    await detectEnemyFaction();
    window.addEventListener('resize', onResize);
    startPolling();
    console.log('[War Manager Bubble] Started.');
    addLog('War Manager initialized' + (STATE.apiKey ? '' : ' \u2014 waiting for API key'));
    if (STATE.enemyFactionId && STATE.apiKey) {
      await refreshAll();
    }
  }

  hookFetch();
  hookXHR();

  setTimeout(init, 1500);
})();
