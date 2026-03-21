// ==UserScript==
// @name         Dark Tools - Traveler Utility
// @namespace    alex.torn.pda.traveler.bubble
// @version      1.0.0
// @description  Quick-travel buttons for Mexico, Cayman Islands, and Canada. Shows travel status, flight ETA, and links to abroad shops. One tap to navigate — game actions are always manual.
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
    { id: 'mexico',  name: 'Mexico',          flag: '\uD83C\uDDF2\uD83C\uDDFD', color: '#4caf50', items: 'Plushies',       flyTime: '~26 min' },
    { id: 'cayman',  name: 'Cayman Islands',   flag: '\uD83C\uDDF0\uD83C\uDDFE', color: '#42a5f5', items: 'Banking',        flyTime: '~35 min' },
    { id: 'canada',  name: 'Canada',           flag: '\uD83C\uDDE8\uD83C\uDDE6', color: '#e67e22', items: 'Flowers',        flyTime: '~41 min' },
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
  }

  function onPanelCollapse() {
    stopPolling();
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
      addLog(`Traveling to ${STATE.abroadCountry}, ${travel.time_left}s remaining`);
    } else if (/abroad/.test(String(statusState || '').toLowerCase()) ||
               /^in\s(mexico|canada|cayman|hawaii|uk|argentina|switzerland|japan|china|uae|south africa)/i.test(statusDesc)) {
      STATE.location = 'abroad';
      STATE.abroadCountry = travel?.destination || extractCountryFromStatus(statusDesc) || 'Unknown';
      addLog(`Abroad in ${STATE.abroadCountry}`);
    } else if (/traveling|travelling|in flight/i.test(statusDesc)) {
      STATE.location = 'traveling';
      STATE.abroadCountry = travel?.destination || '';
      addLog(`In flight to ${STATE.abroadCountry}`);
    } else {
      STATE.location = 'torn';
      STATE.abroadCountry = '';
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

      /* Fly buttons — navigate to travel agency */
      const flyBtn = e.target.closest('.tpda-trav-fly');
      if (flyBtn) {
        const dest = flyBtn.dataset.dest;
        if (dest) {
          addLog(`Navigating to travel agency for ${dest}`);
          window.location.href = TRAVEL_URL;
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
      html += `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;margin-bottom:6px;border:1px solid #2f3340;border-radius:8px;background:#1a1d26;">
          <div>
            <div style="font-weight:bold;color:${c.color};">${c.flag} ${escapeHtml(c.name)}</div>
            <div style="font-size:11px;color:#888;">${escapeHtml(c.items)} \u2022 ${escapeHtml(c.flyTime)}</div>
          </div>
          <a href="${escapeHtml(TRAVEL_URL)}" class="tpda-trav-fly tpda-trav-btn" data-dest="${escapeHtml(c.id)}"
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
    const countryItems = country ? country.items : 'Items';
    const countryColor = country ? country.color : '#42a5f5';

    let html = `<div style="margin-bottom:10px;padding:10px;border:1px solid ${countryColor};border-radius:10px;background:#111a13;">`;
    html += `<div style="font-weight:bold;color:${countryColor};margin-bottom:8px;">\uD83C\uDF0D In ${escapeHtml(countryName)}</div>`;

    /* Buy items button */
    if (country && country.items !== 'Banking') {
      html += `
        <div style="margin-bottom:8px;">
          <a href="${escapeHtml(ABROAD_URL)}" class="tpda-trav-shop tpda-trav-btn" style="background:${countryColor};width:100%;justify-content:center;padding:10px;">
            \uD83D\uDED2 Buy ${escapeHtml(countryItems)} (open shop)
          </a>
          <div style="font-size:10px;color:#888;margin-top:4px;text-align:center;">Opens the abroad shop page \u2014 use the Buy Max button on the page</div>
        </div>`;
    }

    /* Cayman banking note */
    if (country && country.items === 'Banking') {
      html += `
        <div style="margin-bottom:8px;padding:8px;border:1px solid #2f3340;border-radius:8px;background:#1a1d26;">
          <div style="font-size:12px;color:#42a5f5;font-weight:bold;">\uD83C\uDFE6 Cayman Banking</div>
          <div style="font-size:11px;color:#bbb;margin-top:4px;">Visit the bank page to deposit or withdraw funds.</div>
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
      const pct = Math.max(0, Math.min(100, 100 - (timeLeft / (45 * 60)) * 100));
      html += `
        <div style="background:#2f3340;border-radius:6px;overflow:hidden;height:20px;margin-bottom:8px;">
          <div style="background:${color};height:100%;width:${pct}%;transition:width 0.5s;"></div>
        </div>
        <div style="text-align:center;font-size:16px;font-weight:bold;color:#ffd700;">${formatSeconds(timeLeft)}</div>
        <div style="text-align:center;font-size:11px;color:#888;margin-top:2px;">until arrival</div>`;
    } else {
      html += `<div style="text-align:center;font-size:14px;color:#4caf50;font-weight:bold;">Arriving now!</div>`;
    }

    /* What to do when you arrive */
    if (country) {
      html += `
        <div style="margin-top:10px;padding:8px;border:1px solid #2f3340;border-radius:8px;background:#1a1d26;">
          <div style="font-size:11px;color:#bbb;">\uD83D\uDCCB When you arrive:</div>
          <div style="font-size:12px;color:${color};font-weight:bold;margin-top:4px;">${country.items === 'Banking' ? '\uD83C\uDFE6 Visit the bank' : '\uD83D\uDED2 Buy ' + escapeHtml(country.items) + ' at the shop'}</div>
        </div>`;
    }

    html += `</div>`;
    return html;
  }

  /* ── Init ───────────────────────────────────────────────── */

  async function init() {
    initApiKey(PDA_INJECTED_KEY);
    ensureStyles();
    createBubble();
    createPanel();
    window.addEventListener('resize', onResize);
    addLog('Traveler Utility initialized' + (STATE.apiKey ? '' : ' \u2014 waiting for API key'));
  }

  hookFetch();
  hookXHR();

  setTimeout(init, 1500);
})();
