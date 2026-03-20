// ==UserScript==
// @name         Dark Tools - Market Sniper
// @namespace    alex.torn.pda.marketsniper.bubble
// @version      1.2.0
// @description  Market profit finder — scans item market and bazaar for underpriced deals. Shows buy/sell prices, estimated profit, ROI%, and alerts on high-value opportunities.
// @author       Alex + Devin
// @match        https://www.torn.com/*
// @connect      weav3r.dev
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-market-sniper-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-market-sniper-bubble.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PDA_INJECTED_KEY = '###PDA-APIKEY###';

  const SCRIPT_KEY = 'tpda_market_sniper_v1';
  const BUBBLE_ID = 'tpda-sniper-bubble';
  const PANEL_ID = 'tpda-sniper-panel';
  const HEADER_ID = 'tpda-sniper-header';
  const BUBBLE_SIZE = 56;
  const API_DELAY_MS = 300; /* gap between items (~100 calls at 200/min shared with other scripts) */
  const CACHE_TTL_MS = 5 * 60 * 1000; /* 5-minute price cache */
  const DISMISS_TTL_MS = 60 * 60 * 1000; /* 1-hour dismiss expiry */
  const NOTIFY_DEDUP_MS = 5 * 60 * 1000; /* 5-minute notification dedup per item */

  /* ── Default watchlist — 50+ popular tradeable items ─────── */
  const DEFAULT_WATCHLIST = [
    /* ── Drugs (11) ─────────────────────────────────────────── */
    { id: 206, name: 'Xanax' },
    { id: 197, name: 'Ecstasy' },
    { id: 205, name: 'Vicodin' },
    { id: 196, name: 'Cannabis' },
    { id: 198, name: 'Ketamine' },
    { id: 199, name: 'LSD' },
    { id: 200, name: 'Opium' },
    { id: 201, name: 'PCP' },
    { id: 203, name: 'Shrooms' },
    { id: 204, name: 'Speed' },
    { id: 870, name: 'Love Juice' },
    /* ── Plushies (13) ──────────────────────────────────────── */
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
    /* ── Flowers (11) ───────────────────────────────────────── */
    { id: 260, name: 'Dahlia' },
    { id: 263, name: 'Crocus' },
    { id: 264, name: 'Orchid' },
    { id: 267, name: 'Heather' },
    { id: 271, name: 'Ceibo Flower' },
    { id: 272, name: 'Edelweiss' },
    { id: 276, name: 'Peony' },
    { id: 277, name: 'Cherry Blossom' },
    { id: 282, name: 'African Violet' },
    { id: 385, name: 'Tribulus Omanense' },
    { id: 617, name: 'Banana Orchid' },
    /* ── Boosters & Supply Packs (5) ────────────────────────── */
    { id: 366, name: 'Erotic DVD' },
    { id: 367, name: 'Feathery Hotel Coupon' },
    { id: 283, name: 'Donator Pack' },
    { id: 370, name: 'Drug Pack' },
    { id: 365, name: 'Box of Medical Supplies' },
    /* ── Medical (3) ────────────────────────────────────────── */
    { id: 66, name: 'Morphine' },
    { id: 67, name: 'First Aid Kit' },
    { id: 68, name: 'Small First Aid Kit' },
    /* ── Temporary Weapons & Other Popular (7) ──────────────── */
    { id: 220, name: 'Grenade' },
    { id: 222, name: 'Flash Grenade' },
    { id: 226, name: 'Smoke Grenade' },
    { id: 229, name: 'Claymore Mine' },
    { id: 256, name: 'Tear Gas' },
    { id: 392, name: 'Pepper Spray' },
    { id: 530, name: 'Can of Munster' },
  ];

  const SETTINGS_KEY = `${SCRIPT_KEY}_settings`;
  const WATCHLIST_KEY = `${SCRIPT_KEY}_watchlist`;
  const DISMISSED_KEY = `${SCRIPT_KEY}_dismissed`;
  const PRICES_KEY = `${SCRIPT_KEY}_prices`;

  function defaultSettings() {
    return {
      minProfit: 0,       /* 0 = no limit */
      minRoi: 0,          /* 0 = no limit */
      profitableOnly: true,
      hideDismissed: true,
      considerQty: false,  /* when true, sum profit across all listings below sell price */
      sortBy: 'netProfit', /* 'netProfit' | 'roiPct' | 'discoveredAt' */
      sortAsc: false,      /* descending by default — best deals first */
      taxPct: 0,           /* configurable tax estimate (Torn has no explicit tax, but allows conservative estimates) */
      notifyEnabled: true,
      notifyMinProfit: 100000,
      notifyMinRoi: 10,
    };
  }

  function loadSettings() {
    const saved = getStorage(SETTINGS_KEY, null);
    if (!saved) return defaultSettings();
    return { ...defaultSettings(), ...saved };
  }

  function saveSettings() {
    setStorage(SETTINGS_KEY, STATE.settings);
  }

  function loadWatchlist() {
    const saved = getStorage(WATCHLIST_KEY, null);
    if (!saved) return DEFAULT_WATCHLIST.map(i => ({ ...i }));
    return saved;
  }

  function saveWatchlist() {
    setStorage(WATCHLIST_KEY, STATE.watchlist);
  }

  function loadDismissed() {
    const parsed = getStorage(DISMISSED_KEY, {});
    const now = Date.now();
    const pruned = {};
    for (const [k, ts] of Object.entries(parsed)) {
      if (now - ts < DISMISS_TTL_MS) pruned[k] = ts;
    }
    return pruned;
  }

  function saveDismissed() {
    setStorage(DISMISSED_KEY, STATE.dismissed);
  }

  function loadCachedPrices() {
    const parsed = getStorage(PRICES_KEY, null);
    if (!parsed) return;
    STATE.prices = parsed.prices || {};
    STATE.lastScanAt = parsed.lastScanAt || 0;
    addLog('Loaded cached prices (' + ageText(STATE.lastScanAt) + ')');
  }

  function saveCachedPrices() {
    setStorage(PRICES_KEY, {
      prices: STATE.prices,
      lastScanAt: STATE.lastScanAt
    });
  }

  /* ── state ─────────────────────────────────────────────────── */
  const STATE = {
    apiKey: null,
    apiKeySource: '',
    watchlist: loadWatchlist(),
    settings: loadSettings(),
    dismissed: loadDismissed(),
    prices: {},         /* itemId → { floor, avg, listingCount, bazaarFloor, bazaarAvg, bazaarCount, bazaarSellerId, fetchedAt } */
    deals: [],          /* computed deal objects */
    scanning: false,
    scanProgress: 0,
    lastScanAt: 0,
    lastError: '',
    dealCount: 0,       /* count of profitable deals (for bubble badge) */
    _showWatchlistEdit: false,
    ui: {
      minimized: true,
      zIndexBase: 999940
    },
    _logs: []
  };

  // #COMMON_CODE


  /* ── Panel expand/collapse hooks ─────────────────────────── */
  function onPanelExpand() {
    renderPanel();
    if (!STATE.scanning && (!STATE.lastScanAt || Date.now() - STATE.lastScanAt > CACHE_TTL_MS)) {
      scanAllItems();
    }
  }
  function onPanelCollapse() {}


  /* ── Cross-origin GET helper (PDA native -> plain fetch) ─── */


  /* ── Fetch item market data from Torn API v2 ─────────────── */
  async function fetchItemMarketData(itemId) {
    if (!STATE.apiKey) throw new Error('No API key');
    const url = `https://api.torn.com/v2/market/${itemId}/itemmarket?key=${STATE.apiKey}&_tpda=1`;
    addLog(`[API] GET /v2/market/${itemId}/itemmarket`);

    let data;
    if (typeof PDA_httpGet === 'function') {
      const resp = await PDA_httpGet(url, {});
      data = safeJsonParse(resp?.responseText);
    } else {
      const r = await fetch(url);
      data = await r.json();
    }

    if (data?.error) throw new Error(`API error ${data.error.code}: ${data.error.error}`);

    const im = data?.itemmarket || {};
    const listings = im.listings || [];
    const itemName = im.item?.name || '';
    const avgPrice = im.item?.average_price ?? null;
    addLog(`[API] itemmarket ${itemId}: ${listings.length} listings, avg=${avgPrice ?? 'n/a'}`);
    return {
      floor: listings.length ? listings[0].price : null,
      avg: avgPrice,
      count: listings.length,
      itemName,
      listings: listings.slice(0, 50).map(l => ({ price: l.price, qty: l.quantity || 1 }))
    };
  }


  /* ── Fetch bazaar data from TornW3B ────────────────────────── */
  async function fetchItemBazaarData(itemId) {
    const url = `https://weav3r.dev/api/marketplace/${itemId}`;
    addLog(`[W3B] GET /api/marketplace/${itemId}`);
    try {
      const data = await crossOriginGet(url);
      const listings = data.listings || [];
      const top = listings[0] || {};
      const bazaarFloor = top.price ?? null;
      const bazaarSellerId = top.player_id ?? null;
      const bazaarAvg = data.bazaar_average ?? null;
      addLog(`[W3B] bazaar ${itemId}: floor=${bazaarFloor ?? 'n/a'} avg=${bazaarAvg ?? 'n/a'} (${listings.length})`);
      return {
        bazaarFloor, bazaarAvg, bazaarCount: listings.length, bazaarSellerId,
        bazaarListings: listings.slice(0, 50).map(l => ({ price: l.price, qty: l.quantity || 1 }))
      };
    } catch (err) {
      addLog(`[W3B] bazaar ${itemId}: ${err.message}`);
      return { bazaarFloor: null, bazaarAvg: null, bazaarCount: 0, bazaarSellerId: null, bazaarListings: [] };
    }
  }


  /* ── Scan all watchlist items ──────────────────────────────── */
  async function scanAllItems() {
    if (STATE.scanning) { addLog('Scan already in progress'); return; }
    if (!STATE.apiKey) {
      STATE.lastError = 'No API key';
      addLog('Cannot scan \u2014 no API key');
      renderPanel();
      return;
    }

    STATE.scanning = true;
    STATE.scanProgress = 0;
    STATE.lastError = '';
    addLog(`Scanning ${STATE.watchlist.length} items\u2026`);
    renderPanel();

    for (let i = 0; i < STATE.watchlist.length; i++) {
      const item = STATE.watchlist[i];
      STATE.scanProgress = i;

      try {
        const [market, bazaar] = await Promise.all([
          fetchItemMarketData(item.id),
          fetchItemBazaarData(item.id)
        ]);

        /* Update item name from API if available */
        if (market.itemName && !item.nameFromApi) {
          item.name = market.itemName;
          item.nameFromApi = true;
        }

        STATE.prices[item.id] = {
          floor: market.floor,
          avg: market.avg,
          listingCount: market.count,
          listings: market.listings || [],
          bazaarFloor: bazaar.bazaarFloor,
          bazaarAvg: bazaar.bazaarAvg,
          bazaarCount: bazaar.bazaarCount,
          bazaarSellerId: bazaar.bazaarSellerId,
          bazaarListings: bazaar.bazaarListings || [],
          fetchedAt: nowTs()
        };

        const bestBuy = [market.floor, bazaar.bazaarFloor].filter(p => p != null && p > 0);
        const buyPrice = bestBuy.length ? Math.min(...bestBuy) : null;
        if (buyPrice && market.avg) {
          addLog(`${item.name}: buy=${formatMoney(buyPrice)} sell=${formatMoney(market.avg)}`);
        }
      } catch (err) {
        addLog(`ERROR scanning ${item.name}: ${err.message}`);
      }

      if (!STATE.ui.minimized) renderPanel();
      if (i < STATE.watchlist.length - 1) await sleep(API_DELAY_MS);
    }

    STATE.scanProgress = STATE.watchlist.length;
    STATE.lastScanAt = nowTs();
    STATE.scanning = false;
    saveCachedPrices();
    saveWatchlist();
    buildDeals();
    checkNotifications();
    addLog(`Scan complete \u2014 ${STATE.dealCount} profitable deal${STATE.dealCount !== 1 ? 's' : ''}`);
    updateBubbleBadge();
    renderPanel();
  }


  /* ── Build deals from cached prices ────────────────────────── */
  function buildDeals() {
    const s = STATE.settings;
    const deals = [];

    for (const item of STATE.watchlist) {
      const p = STATE.prices[item.id];
      if (!p) continue;

      const bestBuy = [p.floor, p.bazaarFloor].filter(v => v != null && v > 0);
      const buyPrice = bestBuy.length ? Math.min(...bestBuy) : null;
      const sellPrice = p.avg;
      const buySource = (buyPrice != null && buyPrice === p.bazaarFloor) ? 'bazaar' : 'market';

      const profit = calcDealProfit(buyPrice, sellPrice, s.taxPct, 0);
      if (!profit) continue;

      const deal = {
        itemId: item.id,
        itemName: item.name,
        buyPrice: profit.buyPrice,
        sellPrice: profit.sellPrice,
        buySource,
        taxAmount: profit.taxAmount,
        netProfit: profit.netProfit,
        roiPct: profit.roiPct,
        marketFloor: p.floor,
        bazaarFloor: p.bazaarFloor,
        bazaarSellerId: p.bazaarSellerId,
        listingCount: (p.listingCount || 0) + (p.bazaarCount || 0),
        discoveredAt: p.fetchedAt || nowTs(),
        totalQty: 0,
        totalCost: 0,
        totalProfit: 0
      };

      if (s.considerQty && sellPrice > 0) {
        const merged = mergeListingsBelowSell(p.listings || [], p.bazaarListings || [], sellPrice, s.taxPct);
        deal.totalQty = merged.totalQty;
        deal.totalCost = merged.totalCost;
        deal.totalProfit = merged.totalProfit;
      }

      deals.push(deal);
    }

    STATE.deals = deals;
    STATE.dealCount = deals.filter(d => d.netProfit > 0).length;
  }

  function mergeListingsBelowSell(marketListings, bazaarListings, sellPrice, taxPct) {
    const all = [];
    for (const l of marketListings) {
      if (l.price > 0 && l.price < sellPrice) all.push(l);
    }
    for (const l of bazaarListings) {
      if (l.price > 0 && l.price < sellPrice) all.push(l);
    }
    all.sort((a, b) => a.price - b.price);

    let totalQty = 0, totalCost = 0, totalProfit = 0;
    const taxMul = (100 - (Number(taxPct) || 0)) / 100;
    for (const l of all) {
      const qty = l.qty || 1;
      const cost = l.price * qty;
      const revenue = Math.round(sellPrice * taxMul) * qty;
      totalQty += qty;
      totalCost += cost;
      totalProfit += revenue - cost;
    }
    return { totalQty, totalCost, totalProfit };
  }


  /* ── Filter and sort deals ─────────────────────────────────── */
  function filteredDeals() {
    const s = STATE.settings;
    let list = STATE.deals.filter(d => {
      if (s.profitableOnly && d.netProfit <= 0) return false;
      if (s.minProfit > 0 && d.netProfit < s.minProfit) return false;
      if (s.minRoi > 0 && d.roiPct < s.minRoi) return false;
      if (s.hideDismissed) {
        const key = `${d.itemId}:${d.buyPrice}`;
        if (STATE.dismissed[key]) return false;
      }
      return true;
    });

    const dir = s.sortAsc ? 1 : -1;
    list.sort((a, b) => {
      if (s.sortBy === 'roiPct') return dir * (a.roiPct - b.roiPct);
      if (s.sortBy === 'discoveredAt') return dir * (a.discoveredAt - b.discoveredAt);
      return dir * (a.netProfit - b.netProfit);
    });

    return list;
  }


  /* ── Notifications ─────────────────────────────────────────── */
  function checkNotifications() {
    const s = STATE.settings;
    if (!s.notifyEnabled) return;

    for (const d of STATE.deals) {
      if (d.netProfit <= 0) continue;
      if (s.notifyMinProfit > 0 && d.netProfit < s.notifyMinProfit) continue;
      if (s.notifyMinRoi > 0 && d.roiPct < s.notifyMinRoi) continue;

      const key = `sniper_${d.itemId}`;
      tpdaNotify(
        key,
        `Deal: ${d.itemName}`,
        `Profit: ${formatMoney(d.netProfit)} (${d.roiPct.toFixed(1)}% ROI)`,
        NOTIFY_DEDUP_MS
      );
    }
  }


  /* ── Bubble badge ──────────────────────────────────────────── */
  function updateBubbleBadge() {
    const bubble = getBubbleEl();
    if (!bubble) return;
    const count = filteredDeals().length;
    const badge = bubble.querySelector('.tpda-sniper-badge');
    if (count > 0) {
      if (badge) {
        badge.textContent = String(count);
        badge.style.display = 'flex';
      }
    } else if (badge) {
      badge.style.display = 'none';
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
        background: linear-gradient(135deg, #2ecc40, #1b8c2a);
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
        width: 400px;
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
      .tpda-sniper-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 18px;
        height: 18px;
        border-radius: 9px;
        background: #f44;
        color: #fff;
        font-size: 10px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        border: 2px solid #0d0f14;
      }
      .tpda-sniper-row {
        padding: 8px;
        border-bottom: 1px solid #1e2030;
        font-size: 12px;
      }
      .tpda-sniper-row:hover {
        background: rgba(46,204,64,0.06);
      }
      .tpda-sniper-profit { color: #4caf50; font-weight: bold; }
      .tpda-sniper-loss { color: #f44; }
      .tpda-sniper-roi { color: #ffd700; font-size: 11px; }
      .tpda-sniper-buy-link {
        background: #2ecc40;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 11px;
        cursor: pointer;
        text-decoration: none;
        white-space: nowrap;
      }
      .tpda-sniper-dismiss {
        background: #333;
        color: #aaa;
        border: none;
        border-radius: 6px;
        padding: 3px 6px;
        font-size: 10px;
        cursor: pointer;
      }
      .tpda-sniper-filter-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 0;
        font-size: 11px;
      }
      .tpda-sniper-filter-row label {
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .tpda-sniper-filter-row input[type="checkbox"] {
        cursor: pointer;
      }
      .tpda-sniper-filter-row input[type="number"] {
        width: 70px;
        background: #0f1116;
        color: #fff;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 2px 4px;
        font-size: 11px;
      }
      .tpda-sniper-filter-row select {
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


  /* ── Bubble ────────────────────────────────────────────────── */

  function createBubble() {
    if (getBubbleEl()) return;

    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.dataset.tpdaBubble = '1';
    bubble.innerHTML = 'MKT<span class="tpda-sniper-badge" style="display:none;">0</span>';

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


  /* ── Panel ─────────────────────────────────────────────────── */

  function createPanel() {
    if (getPanelEl()) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.display = 'none';
    panel.style.zIndex = String(STATE.ui.zIndexBase);

    panel.innerHTML = `
      <div id="${HEADER_ID}" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#1c1d24;border-bottom:1px solid #333;flex:0 0 auto;">
        <div>
          <div style="font-weight:bold;">Market Sniper</div>
          <div style="font-size:11px;color:#bbb;">Profit finder &amp; deal alerts</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="tpda-sniper-scan" style="background:#2ecc40;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">Scan</button>
          <button id="tpda-sniper-collapse" style="background:#444;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">\u25CB</button>
        </div>
      </div>
      <div id="tpda-sniper-body" style="padding:8px;overflow-y:auto;flex:1 1 auto;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('tpda-sniper-scan').addEventListener('click', () => {
      scanAllItems();
    });
    document.getElementById('tpda-sniper-collapse').addEventListener('click', collapseToBubble);

    /* Delegated click handler — attached ONCE here, never inside renderPanel() */
    const panelBody = document.getElementById('tpda-sniper-body');
    panelBody.addEventListener('click', (e) => {
      if (handleApiKeyClick(e, panelBody, () => { scanAllItems(); })) return;
      if (handleLogClick(e, panelBody)) return;

      /* Dismiss buttons */
      const dismissBtn = e.target.closest('.tpda-sniper-dismiss');
      if (dismissBtn) {
        const key = dismissBtn.dataset.dismissKey;
        if (key) {
          STATE.dismissed[key] = Date.now();
          saveDismissed();
          renderPanel();
          updateBubbleBadge();
        }
        return;
      }

      /* Clear dismissed */
      if (e.target.closest('.tpda-sniper-clear-dismissed')) {
        STATE.dismissed = {};
        saveDismissed();
        renderPanel();
        updateBubbleBadge();
        return;
      }

      /* Watchlist edit toggle */
      if (e.target.closest('.tpda-sniper-watchlist-toggle')) {
        STATE._showWatchlistEdit = !STATE._showWatchlistEdit;
        renderPanel();
        return;
      }

      /* Remove watchlist item */
      const removeBtn = e.target.closest('.tpda-sniper-wl-remove');
      if (removeBtn) {
        const itemId = parseInt(removeBtn.dataset.itemId);
        if (itemId) {
          STATE.watchlist = STATE.watchlist.filter(w => w.id !== itemId);
          saveWatchlist();
          renderPanel();
        }
        return;
      }

      /* Add watchlist item */
      if (e.target.closest('.tpda-sniper-wl-add')) {
        const idInput = panelBody.querySelector('.tpda-sniper-wl-id');
        const nameInput = panelBody.querySelector('.tpda-sniper-wl-name');
        const id = parseInt(idInput?.value);
        const name = String(nameInput?.value || '').trim();
        if (id > 0 && name) {
          if (!STATE.watchlist.some(w => w.id === id)) {
            STATE.watchlist.push({ id, name });
            saveWatchlist();
            addLog(`Added ${name} (ID ${id}) to watchlist`);
          }
          renderPanel();
        }
        return;
      }

      /* Reset watchlist to defaults */
      if (e.target.closest('.tpda-sniper-wl-reset')) {
        STATE.watchlist = DEFAULT_WATCHLIST.map(w => ({ ...w }));
        saveWatchlist();
        addLog(`Watchlist reset to defaults (${DEFAULT_WATCHLIST.length} items)`);
        renderPanel();
        return;
      }
    });

    /* Delegated change handler for settings/filters */
    panelBody.addEventListener('change', (e) => {
      const el = e.target;
      if (!el) return;
      const sKey = el.dataset.setting;
      if (!sKey) return;

      if (el.type === 'checkbox') {
        STATE.settings[sKey] = el.checked;
      } else if (el.type === 'number') {
        STATE.settings[sKey] = parseFloat(el.value) || 0;
      } else if (el.tagName === 'SELECT') {
        STATE.settings[sKey] = el.value;
      }
      saveSettings();
      buildDeals();
      updateBubbleBadge();
      renderPanel();
    });

    makeDraggablePanel(panel, document.getElementById(HEADER_ID));
  }


  /* ── Render ────────────────────────────────────────────────── */

  function renderPanel() {
    const body = document.getElementById('tpda-sniper-body');
    if (!body) return;

    let h = '';
    const s = STATE.settings;

    /* ─ Filters card ─ */
    h += `<div style="margin-bottom:8px;padding:8px;border:1px solid #2f3340;border-radius:10px;background:#141821;">`;
    h += `<div style="font-weight:bold;font-size:12px;margin-bottom:6px;">Filters &amp; Sort</div>`;

    h += `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:6px;">`;
    h += settingCheckbox('profitableOnly', 'Profitable only', s.profitableOnly, '#4caf50');
    h += settingCheckbox('hideDismissed', 'Hide dismissed', s.hideDismissed, '#bbb');
    h += settingCheckbox('considerQty', 'Consider quantities', s.considerQty, '#42a5f5');
    h += `</div>`;

    h += `<div style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11px;">`;
    h += `<div class="tpda-sniper-filter-row">`;
    h += `<span style="color:#bbb;">Min Profit:</span>`;
    h += `<input type="number" data-setting="minProfit" value="${s.minProfit || ''}" min="0" placeholder="any" />`;
    h += `</div>`;
    h += `<div class="tpda-sniper-filter-row">`;
    h += `<span style="color:#bbb;">Min ROI%:</span>`;
    h += `<input type="number" data-setting="minRoi" value="${s.minRoi || ''}" min="0" step="0.1" placeholder="any" />`;
    h += `</div>`;
    h += `<div class="tpda-sniper-filter-row">`;
    h += `<span style="color:#bbb;">Tax%:</span>`;
    h += `<input type="number" data-setting="taxPct" value="${s.taxPct || ''}" min="0" max="100" step="0.1" placeholder="0" />`;
    h += `</div>`;
    h += `</div>`;

    h += `<div class="tpda-sniper-filter-row" style="margin-top:4px;">`;
    h += `<span style="color:#bbb;">Sort by:</span>`;
    h += `<select data-setting="sortBy">`;
    h += `<option value="netProfit" ${s.sortBy === 'netProfit' ? 'selected' : ''}>Net Profit</option>`;
    h += `<option value="roiPct" ${s.sortBy === 'roiPct' ? 'selected' : ''}>ROI %</option>`;
    h += `<option value="discoveredAt" ${s.sortBy === 'discoveredAt' ? 'selected' : ''}>Newest</option>`;
    h += `</select>`;
    h += settingCheckbox('sortAsc', 'Ascending', s.sortAsc, '#bbb');
    h += `</div>`;

    h += `</div>`;

    /* ─ Notification settings ─ */
    h += `<div style="margin-bottom:8px;padding:8px;border:1px solid #2f3340;border-radius:10px;background:#141821;">`;
    h += `<div style="font-weight:bold;font-size:12px;margin-bottom:6px;">Notifications</div>`;
    h += `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;">`;
    h += settingCheckbox('notifyEnabled', 'Alert on deals', s.notifyEnabled, '#ffd700');
    h += `</div>`;
    if (s.notifyEnabled) {
      h += `<div style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11px;margin-top:4px;">`;
      h += `<div class="tpda-sniper-filter-row">`;
      h += `<span style="color:#bbb;">Min $:</span>`;
      h += `<input type="number" data-setting="notifyMinProfit" value="${s.notifyMinProfit || ''}" min="0" placeholder="100000" />`;
      h += `</div>`;
      h += `<div class="tpda-sniper-filter-row">`;
      h += `<span style="color:#bbb;">Min ROI%:</span>`;
      h += `<input type="number" data-setting="notifyMinRoi" value="${s.notifyMinRoi || ''}" min="0" step="0.1" placeholder="10" />`;
      h += `</div>`;
      h += `</div>`;
    }
    h += `</div>`;

    /* ─ Status bar ─ */
    if (STATE.scanning) {
      h += `<div style="padding:6px;text-align:center;color:#ffc107;font-size:11px;">Scanning\u2026 ${STATE.scanProgress + 1}/${STATE.watchlist.length}</div>`;
    } else if (STATE.lastError) {
      h += `<div style="padding:6px;text-align:center;color:#f44;font-size:11px;">${escapeHtml(STATE.lastError)}</div>`;
    } else if (STATE.lastScanAt) {
      const deals = filteredDeals();
      h += `<div style="padding:4px 6px;display:flex;justify-content:space-between;font-size:11px;color:#888;">`;
      h += `<span>${deals.length} deal${deals.length !== 1 ? 's' : ''} found</span>`;
      h += `<span>Scanned ${ageText(STATE.lastScanAt)}</span>`;
      h += `</div>`;
    }

    /* ─ Deals list ─ */
    if (STATE.deals.length > 0 && !STATE.scanning) {
      const deals = filteredDeals();

      if (deals.length === 0) {
        h += `<div style="padding:12px;text-align:center;color:#888;font-size:12px;">No deals match your filters`;
        if (Object.keys(STATE.dismissed).length > 0) {
          h += ` <button class="tpda-sniper-clear-dismissed" style="background:#333;color:#bbb;border:none;border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer;margin-left:4px;">Clear dismissed</button>`;
        }
        h += `</div>`;
      } else {
        h += `<div style="max-height:45vh;overflow-y:auto;">`;
        for (const d of deals) {
          const profitClass = d.netProfit > 0 ? 'tpda-sniper-profit' : 'tpda-sniper-loss';
          const marketUrl = `https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${d.itemId}`;
          const buyUrl = d.buySource === 'bazaar' && d.bazaarSellerId
            ? `https://www.torn.com/bazaar.php?userId=${d.bazaarSellerId}#/`
            : marketUrl;
          const dismissKey = `${d.itemId}:${d.buyPrice}`;

          h += `<div class="tpda-sniper-row">`;

          /* Item info row */
          h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">`;
          h += `<div>`;
          h += `<a href="${escapeHtml(marketUrl)}" target="_blank" style="color:#42a5f5;text-decoration:none;font-weight:bold;">${escapeHtml(d.itemName)}</a>`;
          h += ` <span style="color:#666;font-size:10px;">#${d.itemId}</span>`;
          h += `</div>`;
          h += `<div style="display:flex;gap:4px;">`;
          h += `<a class="tpda-sniper-buy-link" href="${escapeHtml(buyUrl)}" target="_blank">Buy</a>`;
          h += `<button class="tpda-sniper-dismiss" data-dismiss-key="${escapeHtml(dismissKey)}">\u2715</button>`;
          h += `</div>`;
          h += `</div>`;

          /* Price details */
          h += `<div style="display:flex;gap:12px;font-size:11px;color:#bbb;">`;
          h += `<span>Buy: ${formatMoney(d.buyPrice)} <span style="color:#666;font-size:10px;">(${escapeHtml(d.buySource)})</span></span>`;
          h += `<span>Sell: ${formatMoney(d.sellPrice)}</span>`;
          h += `</div>`;

          /* Profit line */
          h += `<div style="display:flex;gap:12px;align-items:center;margin-top:2px;">`;
          h += `<span class="${profitClass}">Profit: ${formatMoney(d.netProfit)}</span>`;
          h += `<span class="tpda-sniper-roi">ROI: ${d.roiPct.toFixed(1)}%</span>`;
          if (d.taxAmount > 0) {
            h += `<span style="color:#888;font-size:10px;">Tax: ${formatMoney(d.taxAmount)}</span>`;
          }
          h += `</div>`;

          /* Quantity-aware totals (when considerQty is on) */
          if (s.considerQty && d.totalQty > 0) {
            h += `<div style="display:flex;gap:12px;align-items:center;margin-top:2px;font-size:11px;border-top:1px dashed #2a2d38;padding-top:3px;">`;
            h += `<span style="color:#42a5f5;">${d.totalQty}x available</span>`;
            h += `<span style="color:#bbb;">Cost: ${formatMoney(d.totalCost)}</span>`;
            const totClass = d.totalProfit > 0 ? 'tpda-sniper-profit' : 'tpda-sniper-loss';
            h += `<span class="${totClass}">Total: ${formatMoney(d.totalProfit)}</span>`;
            h += `</div>`;
          }

          h += `</div>`;
        }
        h += `</div>`;

        if (Object.keys(STATE.dismissed).length > 0) {
          h += `<div style="text-align:center;padding:6px;">`;
          h += `<button class="tpda-sniper-clear-dismissed" style="background:#333;color:#bbb;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;">Clear ${Object.keys(STATE.dismissed).length} dismissed</button>`;
          h += `</div>`;
        }
      }
    } else if (!STATE.scanning && STATE.lastScanAt === 0 && STATE.apiKey) {
      h += `<div style="padding:12px;text-align:center;color:#888;font-size:12px;">Tap Scan to find deals</div>`;
    } else if (!STATE.apiKey) {
      h += `<div style="padding:12px;text-align:center;color:#ffc107;font-size:12px;">Enter your API key below to scan</div>`;
    }

    /* ─ Watchlist editor (collapsible) ─ */
    h += `<div style="margin-top:8px;padding:8px;border:1px solid #2f3340;border-radius:10px;background:#141821;">`;
    h += `<div class="tpda-sniper-watchlist-toggle" style="font-weight:bold;font-size:12px;cursor:pointer;user-select:none;">`;
    h += `${STATE._showWatchlistEdit ? '\u25BC' : '\u25B6'} Watchlist (${STATE.watchlist.length} items)`;
    h += `</div>`;

    if (STATE._showWatchlistEdit) {
      h += `<div style="margin-top:8px;">`;
      for (const item of STATE.watchlist) {
        h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px;">`;
        h += `<span>${escapeHtml(item.name)} <span style="color:#666;">#${item.id}</span></span>`;
        h += `<button class="tpda-sniper-wl-remove" data-item-id="${item.id}" style="background:#444;color:#f44;border:none;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;">\u2715</button>`;
        h += `</div>`;
      }
      h += `<div style="margin-top:8px;display:flex;gap:4px;align-items:center;">`;
      h += `<input class="tpda-sniper-wl-id" type="number" placeholder="Item ID" style="width:70px;background:#0f1116;color:#fff;border:1px solid #444;border-radius:4px;padding:4px;font-size:11px;" />`;
      h += `<input class="tpda-sniper-wl-name" type="text" placeholder="Item Name" style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:4px;padding:4px;font-size:11px;" />`;
      h += `<button class="tpda-sniper-wl-add" style="background:#2ecc40;color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">Add</button>`;
      h += `</div>`;
      h += `<div style="margin-top:6px;text-align:right;">`;
      h += `<button class="tpda-sniper-wl-reset" style="background:#555;color:#ffd700;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;">Reset to Defaults</button>`;
      h += `</div>`;
      h += `</div>`;
    }

    h += `</div>`;

    /* ─ API key card ─ */
    h += renderApiKeyCard();

    /* ─ Debug log ─ */
    h += renderLogCard();

    body.innerHTML = h;
  }

  function settingCheckbox(key, label, checked, color) {
    return `<label class="tpda-sniper-filter-row" style="color:${color};">` +
      `<input type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''} />` +
      `${escapeHtml(label)}</label>`;
  }


  /* ── Init ──────────────────────────────────────────────────── */

  function init() {
    initApiKey(PDA_INJECTED_KEY);
    loadCachedPrices();
    if (STATE.lastScanAt) buildDeals();

    ensureStyles();
    createBubble();
    createPanel();
    window.addEventListener('resize', onResize);
    updateBubbleBadge();
    tpdaRequestNotifyPermission();

    addLog('Market Sniper initialized' + (STATE.apiKey ? '' : ' \u2014 waiting for API key'));
  }

  hookFetch();
  hookXHR();

  setTimeout(init, 1200);
})();
