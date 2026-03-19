// ==UserScript==
// @name         Torn PDA - Deal Finder Bubble
// @namespace    alex.torn.pda.dealfinder.bubble
// @version      1.0.0
// @description  Safe local Torn PDA deal finder for Item Market and Bazaar. Calculates flip profit after 5% item market tax.
// @author       Alex + ChatGPT
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_KEY = 'tpda_deal_finder_bubble_v1';
  const BUBBLE_ID = 'tpda-deal-finder-bubble';
  const PANEL_ID = 'tpda-deal-finder-panel';
  const HEADER_ID = 'tpda-deal-finder-header';

  const ITEM_MARKET_TAX = 0.05; // standard sales tax
  const BUBBLE_SIZE = 56;
  const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const CACHE_MAX_ITEMS = 200;

  const STATE = {
    userData: {},
    tornData: {},
    marketData: {},
    lastSeen: {
      user: 0,
      torn: 0,
      market: 0
    },
    ui: {
      minimized: true,
      zIndexBase: 999980
    },
    cache: loadCache(),
    scan: {
      context: null,
      itemName: '',
      itemId: '',
      listings: [],
      deals: [],
      lastScanAt: 0,
      message: 'Open an Item Market or Bazaar page, then tap Refresh.'
    },
    _logs: []
  };

  function nowTs() { return Date.now(); }

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function isObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  function deepMerge(target, source) {
    if (!isObject(target) || !isObject(source)) return source;
    const out = { ...target };
    for (const [k, v] of Object.entries(source)) {
      if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
      else out[k] = v;
    }
    return out;
  }

  function formatNumber(n) { return Number(n || 0).toLocaleString(); }
  function formatMoney(n) { return '$' + Math.round(Number(n || 0)).toLocaleString(); }

  function formatSeconds(sec) {
    sec = Number(sec || 0);
    if (sec <= 0) return 'Ready';
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
    return formatSeconds(Math.floor((Date.now() - ts) / 1000)) + ' ago';
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

  function loadCache() {
    try {
      const raw = localStorage.getItem(`${SCRIPT_KEY}_cache`);
      return raw ? JSON.parse(raw) : {
        items: {}
      };
    } catch {
      return { items: {} };
    }
  }

  function saveCache() {
    try {
      pruneCache();
      localStorage.setItem(`${SCRIPT_KEY}_cache`, JSON.stringify(STATE.cache));
    } catch {}
  }

  function pruneCache() {
    const entries = Object.entries(STATE.cache.items);
    if (entries.length <= CACHE_MAX_ITEMS) return;

    const now = nowTs();
    const pruned = {};
    const fresh = entries
      .filter(([, v]) => v && typeof v.lastSeen === 'number' && (now - v.lastSeen) < CACHE_MAX_AGE_MS)
      .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0))
      .slice(0, CACHE_MAX_ITEMS);

    for (const [key, val] of fresh) {
      pruned[key] = val;
    }
    STATE.cache.items = pruned;
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

  function getDefaultBubblePosition() {
    const existing = document.querySelectorAll('[data-tpda-bubble="1"]').length;
    const right = 12;
    const bottom = 12 + (existing * 68);
    return { right, bottom };
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
        background: linear-gradient(135deg, #1f9d55, #0f6b38);
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
        width: 370px;
        max-width: 95vw;
        max-height: 75vh;
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
      .tpda-deal-good { color: #8dff8d; }
      .tpda-deal-mid { color: #ffd166; }
      .tpda-deal-bad { color: #ff8c8c; }
    `;
    document.head.appendChild(style);
  }

  function createBubble() {
    if (getBubbleEl()) return;

    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.dataset.tpdaBubble = '1';
    bubble.innerHTML = 'DF';

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
          <div style="font-weight:bold;">Deal Finder</div>
          <div style="font-size:11px;color:#bbb;">Local-only • uses PDA traffic + current page</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="tpda-deal-refresh" style="background:#1f9d55;color:white;border:none;border-radius:8px;padding:6px 10px;">Refresh</button>
          <button id="tpda-deal-collapse" style="background:#444;color:white;border:none;border-radius:8px;padding:6px 10px;">○</button>
        </div>
      </div>
      <div id="tpda-deal-body" style="padding:12px;overflow-y:auto;max-height:65vh;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('tpda-deal-refresh').addEventListener('click', () => {
      scanCurrentPage();
      renderPanel();
    });
    document.getElementById('tpda-deal-collapse').addEventListener('click', collapseToBubble);

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
      const clamped = clampToViewport(saved.left, saved.top, panel.offsetWidth || 370, panel.offsetHeight || 460);
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
      const clamped = clampToViewport(left, top, panel.offsetWidth || 370, panel.offsetHeight || 460);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = '';
      panel.style.bottom = '';
      setPanelPosition(clamped);
    }

    scanCurrentPage();
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

      let nextLeft = originLeft + dx;
      let nextTop = originTop + dy;

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
        const pos = leftTopToBubbleRightBottom(left, top, BUBBLE_SIZE);
        setBubblePosition(pos);
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
      if (e.target.closest('button')) return;
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

      let left = originLeft + dx;
      let top = originTop + dy;

      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(left, top, rect.width, rect.height);

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

  function handleApiPayload(url, data) {
    if (!data || data.error) return;
    if (typeof url !== 'string') return;

    if (url.includes('api.torn.com/user')) {
      STATE.userData = deepMerge(STATE.userData, data);
      STATE.lastSeen.user = nowTs();
      addLog('User API data received');
    } else if (url.includes('api.torn.com/torn')) {
      STATE.tornData = deepMerge(STATE.tornData, data);
      STATE.lastSeen.torn = nowTs();
      addLog('Torn API data received');
    } else if (url.includes('api.torn.com/market')) {
      STATE.marketData = deepMerge(STATE.marketData, data);
      STATE.lastSeen.market = nowTs();
      addLog('Market API data received');
    }
  }

  function hookFetch() {
    const originalFetch = window.fetch;
    if (!originalFetch) return;

    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const url = String(args[0] && args[0].url ? args[0].url : args[0] || '');
        if (url.includes('api.torn.com/')) {
          const clone = response.clone();
          const contentType = clone.headers.get('content-type') || '';
          if (contentType.includes('application/json') || contentType.includes('text/plain')) {
            const text = await clone.text();
            const data = safeJsonParse(text);
            handleApiPayload(url, data);
          }
        }
      } catch (_) {}
      return response;
    };
  }

  function hookXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__tpda_url = url;
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          const url = String(this.__tpda_url || '');
          if (!url.includes('api.torn.com/')) return;
          const text = this.responseText;
          const data = safeJsonParse(text);
          handleApiPayload(url, data);
        } catch (_) {}
      });

      return origSend.apply(this, args);
    };
  }

  function getPageContext() {
    const url = location.href.toLowerCase();
    const pageText = document.body?.innerText?.toLowerCase() || '';

    if (url.includes('itemmarket') || pageText.includes('item market')) return 'itemmarket';
    if (url.includes('bazaar') || pageText.includes('bazaar')) return 'bazaar';
    return null;
  }

  function parseMoney(text) {
    if (!text) return 0;
    const cleaned = String(text).replace(/[^0-9.]/g, '');
    return Number(cleaned || 0);
  }

  function inferItemName() {
    const candidates = [
      'h4',
      'h3',
      'h2',
      '[class*="title"]',
      '[class*="name"]',
      '[class*="header"]'
    ];

    for (const sel of candidates) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = (el.textContent || '').trim();
        if (text && text.length < 80 && !/market|bazaar|search|filter/i.test(text)) {
          if (/[A-Za-z]/.test(text)) return text;
        }
      }
    }
    return '';
  }

  function inferItemIdFromUrl() {
    const url = location.href;
    const patterns = [
      /[?&]itemID=(\d+)/i,
      /[?&]itemid=(\d+)/i,
      /[?&]item=(\d+)/i,
      /\/item\/(\d+)/i
    ];

    for (const re of patterns) {
      const m = url.match(re);
      if (m) return m[1];
    }
    return '';
  }

  function scrapeListingsFromDom() {
    const rows = [];
    const seen = new Set();

    // Target likely listing containers rather than every element on the page
    const selectors = [
      '.items-list li',
      '.item-market-list li',
      '.bazaar-list li',
      '[class*="itemList"] li',
      '[class*="item-list"] li',
      '[class*="listing"] li',
      '[class*="market"] li',
      '[class*="bazaar"] li',
      'ul.items li',
      '.ReactVirtualized__Grid__innerScrollContainer > div'
    ];

    let candidateRows = [];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length) {
        candidateRows.push(...found);
      }
    }

    // Fallback: broader scan if targeted selectors found nothing
    if (!candidateRows.length) {
      candidateRows = Array.from(document.querySelectorAll('li, tr, div'));
    }
    for (const row of candidateRows) {
      const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (!text.includes('$')) continue;

      const moneyMatches = text.match(/\$[\d,]+(?:\.\d+)?/g);
      if (!moneyMatches || !moneyMatches.length) continue;

      const price = parseMoney(moneyMatches[0]);
      if (!price || price < 1) continue;

      let qty = 1;
      const qtyMatch = text.match(/\b(?:x|qty|quantity)\s*[: ]\s*(\d+)\b/i) || text.match(/\b(\d+)\s*x\b/i);
      if (qtyMatch) qty = Number(qtyMatch[1] || 1);

      const sellerMatch = text.match(/(?:seller|from)\s*[: ]\s*([A-Za-z0-9_\-\[\]# ]+)/i);
      const seller = sellerMatch ? sellerMatch[1].trim() : '';

      const key = `${price}|${qty}|${seller}|${text.slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        price,
        qty,
        seller,
        rawText: text
      });
    }

    rows.sort((a, b) => a.price - b.price);
    return rows.slice(0, 50);
  }

  function getItemCache(itemKey) {
    if (!STATE.cache.items[itemKey]) {
      STATE.cache.items[itemKey] = {
        name: '',
        itemId: '',
        lastSeen: 0,
        itemMarketFloor: null,
        bazaarFloor: null,
        marketValue: null
      };
    }
    return STATE.cache.items[itemKey];
  }

  function getItemKey(itemName, itemId) {
    if (itemId) return `id:${itemId}`;
    if (itemName) return `name:${itemName.toLowerCase()}`;
    return '';
  }

  function inferMarketValueFromPage() {
    const text = document.body?.innerText || '';
    const m = text.match(/market value\s*\$([\d,]+)/i);
    if (m) return parseMoney(m[1]);
    return 0;
  }

  function updatePriceCache(context, itemKey, itemName, itemId, listings) {
    if (!itemKey || !listings.length) return;
    const cache = getItemCache(itemKey);
    cache.name = itemName || cache.name;
    cache.itemId = itemId || cache.itemId;
    cache.lastSeen = nowTs();

    const floor = listings[0]?.price || null;
    if (context === 'itemmarket' && floor) cache.itemMarketFloor = floor;
    if (context === 'bazaar' && floor) cache.bazaarFloor = floor;

    const pageMarketValue = inferMarketValueFromPage();
    if (pageMarketValue > 0) cache.marketValue = pageMarketValue;

    saveCache();
    addLog('Cache updated: ' + itemKey + ' (' + context + ' floor: $' + (floor || 'n/a') + ')');
  }

  function calcNetAfterTax(gross) {
    return gross * (1 - ITEM_MARKET_TAX);
  }

  function classifyProfit(netProfit) {
    if (netProfit >= 500000) return 'tpda-deal-good';
    if (netProfit > 0) return 'tpda-deal-mid';
    return 'tpda-deal-bad';
  }

  function scanCurrentPage() {
    const context = getPageContext();
    const itemName = inferItemName();
    const itemId = inferItemIdFromUrl();
    const itemKey = getItemKey(itemName, itemId);

    if (!context) {
      addLog('Page context: not item market or bazaar');
      STATE.scan = {
        context: null,
        itemName: '',
        itemId: '',
        listings: [],
        deals: [],
        lastScanAt: nowTs(),
        message: 'This page does not look like Item Market or Bazaar.'
      };
      return;
    }

    addLog('Page context: ' + context + ', item: ' + (itemName || 'unknown'));

    const listings = scrapeListingsFromDom();

    if (!listings.length) {
      addLog('No listings detected on page');
      STATE.scan = {
        context,
        itemName,
        itemId,
        listings: [],
        deals: [],
        lastScanAt: nowTs(),
        message: 'No listings detected yet. Scroll the page a bit, wait for it to load, then refresh.'
      };
      return;
    }

    updatePriceCache(context, itemKey, itemName, itemId, listings);

    const cache = itemKey ? getItemCache(itemKey) : null;
    const deals = [];

    if (context === 'itemmarket') {
      const secondLowest = listings[1]?.price || 0;
      for (let i = 0; i < Math.min(listings.length, 12); i++) {
        const listing = listings[i];
        if (!secondLowest || listing.price >= secondLowest) continue;

        const grossResell = secondLowest;
        const netResell = calcNetAfterTax(grossResell);
        const profit = netResell - listing.price;
        const roiPct = listing.price > 0 ? (profit / listing.price) * 100 : 0;

        deals.push({
          source: 'Item Market',
          buyPrice: listing.price,
          targetGross: grossResell,
          targetNet: netResell,
          profit,
          roiPct,
          reason: `Below next visible listing (${formatMoney(secondLowest)})`,
          qty: listing.qty
        });
      }
    } else if (context === 'bazaar') {
      const targetGross = cache?.itemMarketFloor || cache?.marketValue || 0;

      for (let i = 0; i < Math.min(listings.length, 12); i++) {
        const listing = listings[i];
        if (!targetGross) continue;

        const netResell = calcNetAfterTax(targetGross);
        const profit = netResell - listing.price;
        const roiPct = listing.price > 0 ? (profit / listing.price) * 100 : 0;

        deals.push({
          source: 'Bazaar',
          buyPrice: listing.price,
          targetGross,
          targetNet: netResell,
          profit,
          roiPct,
          reason: cache?.itemMarketFloor
            ? `Below cached item-market floor (${formatMoney(cache.itemMarketFloor)})`
            : `Compared with market value (${formatMoney(cache.marketValue || 0)})`,
          qty: listing.qty
        });
      }
    }

    deals.sort((a, b) => b.profit - a.profit);

    addLog('Found ' + listings.length + ' listings, ' + deals.length + ' deals');

    let message = 'Scan complete.';
    if (!deals.length) {
      if (context === 'bazaar' && !(cache?.itemMarketFloor || cache?.marketValue)) {
        message = 'Bazaar listings found, but no target resale price is cached yet. Visit the same item in Item Market once, or use a page that shows Market Value.';
      } else {
        message = 'No obvious positive flips found from the visible listings.';
      }
    }

    STATE.scan = {
      context,
      itemName,
      itemId,
      listings,
      deals: deals.slice(0, 10),
      lastScanAt: nowTs(),
      message
    };
  }

  function renderPanel() {
    const body = document.getElementById('tpda-deal-body');
    if (!body) return;

    const itemKey = getItemKey(STATE.scan.itemName, STATE.scan.itemId);
    const cache = itemKey ? getItemCache(itemKey) : null;

    const headerInfo = `
      <div style="margin-bottom:8px;color:#bbb;">
        User data seen: ${ageText(STATE.lastSeen.user)}<br>
        Market data seen: ${ageText(STATE.lastSeen.market)}<br>
        Last scan: ${ageText(STATE.scan.lastScanAt)}
      </div>
    `;

    const itemInfo = `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Current page</div>
        <div>Context: ${escapeHtml(STATE.scan.context || 'unknown')}</div>
        <div>Item: ${escapeHtml(STATE.scan.itemName || 'unknown')}</div>
        <div>Listings seen: ${formatNumber(STATE.scan.listings.length)}</div>
        <div>Cached item-market floor: ${cache?.itemMarketFloor ? formatMoney(cache.itemMarketFloor) : 'unknown'}</div>
        <div>Cached bazaar floor: ${cache?.bazaarFloor ? formatMoney(cache.bazaarFloor) : 'unknown'}</div>
        <div>Cached market value: ${cache?.marketValue ? formatMoney(cache.marketValue) : 'unknown'}</div>
      </div>
    `;

    const noteBox = `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="font-weight:bold;margin-bottom:6px;">Status</div>
        <div>${escapeHtml(STATE.scan.message)}</div>
        <div style="margin-top:8px;font-size:12px;color:#bbb;">
          Profit assumes reselling in Item Market with the standard 5% tax only.
          It does not include the optional anonymous listing fee.
        </div>
      </div>
    `;

    let dealsHtml = `
      <div style="padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Best visible deals</div>
        <div>No profitable visible deals yet.</div>
      </div>
    `;

    if (STATE.scan.deals.length) {
      dealsHtml = `
        <div style="padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
          <div style="font-weight:bold;margin-bottom:6px;">Best visible deals</div>
          ${STATE.scan.deals.map((d, idx) => `
            <div style="padding:8px 0;${idx ? 'border-top:1px solid #2a2d38;' : ''}">
              <div><strong>${idx + 1}. ${escapeHtml(d.source)}</strong> • Qty ${formatNumber(d.qty)}</div>
              <div>Buy: ${formatMoney(d.buyPrice)}</div>
              <div>Target sell gross: ${formatMoney(d.targetGross)}</div>
              <div>Target sell net after 5% tax: ${formatMoney(d.targetNet)}</div>
              <div class="${classifyProfit(d.profit)}">Est. profit: ${formatMoney(d.profit)} (${d.roiPct.toFixed(2)}%)</div>
              <div style="font-size:12px;color:#bbb;">${escapeHtml(d.reason)}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    const logHtml = `
      <div style="margin-top:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#0f1116;">
        <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" id="tpda-deal-log-toggle">
          <div style="font-weight:bold;font-size:12px;">Debug Log (${STATE._logs.length})</div>
          <div style="display:flex;gap:6px;">
            <button id="tpda-deal-log-copy" style="font-size:11px;background:#444;color:#fff;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;">Copy Log</button>
            <span style="font-size:11px;color:#bbb;">tap to toggle</span>
          </div>
        </div>
        <div id="tpda-deal-log-body" style="display:none;margin-top:8px;max-height:200px;overflow-y:auto;font-size:11px;color:#aaa;font-family:monospace;white-space:pre-wrap;word-break:break-all;">
${STATE._logs.map(l => escapeHtml(l)).join('\n')}
        </div>
      </div>
    `;

    body.innerHTML = headerInfo + itemInfo + noteBox + dealsHtml + logHtml;

    const logToggle = document.getElementById('tpda-deal-log-toggle');
    if (logToggle) {
      logToggle.onclick = (e) => {
        if (e.target.closest('button')) return;
        const logBody = document.getElementById('tpda-deal-log-body');
        if (logBody) logBody.style.display = logBody.style.display === 'none' ? 'block' : 'none';
      };
    }

    const logCopyBtn = document.getElementById('tpda-deal-log-copy');
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
      setPanelPosition(clamped);
    }
  }

  function init() {
    ensureStyles();
    createBubble();
    createPanel();
    window.addEventListener('resize', onResize);
    addLog('Deal Finder initialized');
    console.log('[Deal Finder Bubble] Started.');
  }

  // Install network hooks immediately so we capture API calls made before init runs
  hookFetch();
  hookXHR();

  setTimeout(init, 1200);
})();
