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

  // #COMMON_CODE

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
      const timeStr = formatSeconds(timeLeft);

      /* Update all ETA displays */
      const etaEl = document.getElementById('tpda-trav-flight-eta');
      if (etaEl) etaEl.textContent = timeStr;
      const statusEta = document.getElementById('tpda-trav-status-eta');
      if (statusEta) statusEta.textContent = timeStr;

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
        e.preventDefault();
        const dest = flyBtn.dataset.dest;
        if (dest) {
          const url = TRAVEL_URL + '#tpda_fly=' + dest;
          addLog('Navigating to: ' + url);
          window.location.href = url;
        }
        return;
      }

      /* Shop button — navigate to abroad shops */
      const shopBtn = e.target.closest('.tpda-trav-shop');
      if (shopBtn) {
        e.preventDefault();
        addLog('Navigating to: ' + ABROAD_URL);
        window.location.href = ABROAD_URL;
        return;
      }

      /* Return home button — navigate to travel agency */
      const returnBtn = e.target.closest('.tpda-trav-return');
      if (returnBtn) {
        e.preventDefault();
        addLog('Navigating to: ' + TRAVEL_URL);
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
      const elapsed = STATE.lastFetchTs ? Math.floor((Date.now() - STATE.lastFetchTs) / 1000) : 0;
      const timeLeft = Math.max(0, (STATE.travel?.time_left || 0) - elapsed);
      const dest = STATE.abroadCountry || 'Unknown';
      statusHtml = `
        <div style="font-size:14px;color:#42a5f5;font-weight:bold;margin-bottom:4px;">\u2708\uFE0F In Flight</div>
        <div>Destination: <strong>${escapeHtml(dest)}</strong></div>
        ${timeLeft > 0 ? `<div>ETA: <strong id="tpda-trav-status-eta" style="color:#ffd700;">${formatSeconds(timeLeft)}</strong></div>` : '<div>Arriving soon...</div>'}
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
    const elapsed = STATE.lastFetchTs ? Math.floor((Date.now() - STATE.lastFetchTs) / 1000) : 0;
    const timeLeft = Math.max(0, (STATE.travel?.time_left || 0) - elapsed);
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
