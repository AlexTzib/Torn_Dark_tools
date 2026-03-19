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

  // #COMMON_CODE


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
