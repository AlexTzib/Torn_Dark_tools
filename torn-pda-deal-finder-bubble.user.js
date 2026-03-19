// ==UserScript==
// @name         Torn PDA - Plushie Prices
// @namespace    alex.torn.pda.plushieprices.bubble
// @version      2.2.0
// @description  Fetches item market floor and average prices for all 13 Torn plushies. Shows a sortable table with floor prices and set costs.
// @author       Alex + Devin
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  /* ── constants ─────────────────────────────────────────────── */
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

  /* ── utilities ─────────────────────────────────────────────── */
  function nowTs() { return Date.now(); }

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function formatMoney(n) {
    const v = Number(n || 0);
    if (!v) return '\u2014';
    return '$' + Math.round(v).toLocaleString();
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
    if (STATE._logs.length > 200) STATE._logs.shift();
  }

  function ageText(ts) {
    if (!ts) return 'never';
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return sec + 's ago';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    return Math.floor(sec / 3600) + 'h ago';
  }

  /* ── storage ───────────────────────────────────────────────── */
  function getStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function setStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

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

  /* ── API key ───────────────────────────────────────────────── */
  function extractApiKeyFromUrl(url) {
    const m = String(url || '').match(/[?&]key=([A-Za-z0-9]{16})/);
    return m ? m[1] : '';
  }

  function setApiKey(key, source) {
    if (!key || key.length !== 16) return;
    if (STATE.apiKey && STATE.apiKeySource === 'manual') return;
    STATE.apiKey = key;
    STATE.apiKeySource = source || 'network';
    addLog('API key set via ' + STATE.apiKeySource);
  }

  function loadSavedApiKey() {
    const saved = getStorage(`${SCRIPT_KEY}_apikey`, null);
    if (saved && saved.key) setApiKey(saved.key, saved.source || 'saved');
  }

  function saveApiKey() {
    if (STATE.apiKey) {
      setStorage(`${SCRIPT_KEY}_apikey`, { key: STATE.apiKey, source: STATE.apiKeySource });
    }
  }

  /* ── bubble / panel position ───────────────────────────────── */
  function getDefaultBubblePosition() {
    const existing = document.querySelectorAll('[data-tpda-bubble="1"]').length;
    return { right: 12, bottom: 12 + (existing * 68) };
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

  /* ── UI helpers ────────────────────────────────────────────── */
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

  function getBubbleEl() { return document.getElementById(BUBBLE_ID); }
  function getPanelEl() { return document.getElementById(PANEL_ID); }

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
  }

  /* ── expand / collapse ─────────────────────────────────────── */
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
      const clamped = clampToViewport(saved.left, saved.top, panel.offsetWidth || 420, panel.offsetHeight || 500);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = '';
      panel.style.bottom = '';
    } else {
      const bRect = bubble.getBoundingClientRect();
      let left = bRect.left - 340;
      let top = bRect.top - 150;
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      const clamped = clampToViewport(left, top, panel.offsetWidth || 420, panel.offsetHeight || 500);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = '';
      panel.style.bottom = '';
      setPanelPosition(clamped);
    }

    renderPanel();
    const age = nowTs() - STATE.lastFetchAt;
    if (!STATE.lastFetchAt || age > CACHE_TTL_MS) fetchAllPrices(false);
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

  /* ── draggable ─────────────────────────────────────────────── */
  function makeDraggableBubble(el) {
    let startX = null, startY = null, originLeft = 0, originTop = 0, dragging = false;

    el.addEventListener('pointerdown', (e) => {
      dragging = false;
      el.dataset.dragged = '0';
      el.setPointerCapture?.(e.pointerId);
      bringToFront(el);
      const pos = getBubblePosition();
      const current = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
      startX = e.clientX; startY = e.clientY;
      originLeft = current.left; originTop = current.top;
    });

    el.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragging = true;
      if (!dragging) return;
      const clamped = clampToViewport(originLeft + dx, originTop + dy, BUBBLE_SIZE, BUBBLE_SIZE);
      el.style.left = `${clamped.left}px`; el.style.top = `${clamped.top}px`;
      el.style.right = ''; el.style.bottom = '';
      el.dataset.dragged = '1';
    });

    function finish() {
      if (startX === null) return;
      if (dragging) {
        const left = parseFloat(el.style.left || '0');
        const top = parseFloat(el.style.top || '0');
        setBubblePosition(leftTopToBubbleRightBottom(left, top, BUBBLE_SIZE));
      }
      startX = null; startY = null;
    }
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  }

  function makeDraggablePanel(panel, handle) {
    let startX = null, startY = null, originLeft = 0, originTop = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      handle.setPointerCapture?.(e.pointerId);
      bringToFront(panel);
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      originLeft = rect.left; originTop = rect.top;
    });

    handle.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(originLeft + (e.clientX - startX), originTop + (e.clientY - startY), rect.width, rect.height);
      panel.style.left = `${clamped.left}px`; panel.style.top = `${clamped.top}px`;
      panel.style.right = ''; panel.style.bottom = '';
    });

    function finish() {
      if (startX === null) return;
      const rect = panel.getBoundingClientRect();
      setPanelPosition({ left: rect.left, top: rect.top });
      startX = null; startY = null;
    }
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  /* ── network hooks (capture API key from PDA traffic) ──────── */
  function handleApiPayload(url, data) {
    if (!data || data.error) return;
    const key = extractApiKeyFromUrl(url);
    if (key) setApiKey(key, 'network');
  }

  function hookFetch() {
    const original = window.fetch;
    if (!original) return;
    window.fetch = async function (...args) {
      const response = await original.apply(this, args);
      try {
        const url = String(args[0]?.url || args[0] || '');
        if (url.includes('api.torn.com/')) {
          const clone = response.clone();
          const ct = clone.headers.get('content-type') || '';
          if (ct.includes('json') || ct.includes('text/plain')) {
            const text = await clone.text();
            handleApiPayload(url, safeJsonParse(text));
          }
        }
      } catch {}
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
          handleApiPayload(url, safeJsonParse(this.responseText));
        } catch {}
      });
      return origSend.apply(this, args);
    };
  }

  /* ── fetch plushie prices from Torn API ────────────────────── */
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function fetchMarketData(itemId) {
    if (!STATE.apiKey) throw new Error('No API key');
    const url = `https://api.torn.com/v2/market/${itemId}/itemmarket?key=${STATE.apiKey}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error) throw new Error(`API error ${data.error.code}: ${data.error.error}`);
    /* v2 /market/{id}/itemmarket returns:
       { itemmarket: { item: { id, name, type, average_price }, listings: [{price, amount}, ...], cache_timestamp }, _metadata } */
    const im = data.itemmarket || {};
    const listings = im.listings || [];
    return {
      floor: listings.length ? listings[0].price : null,
      avg: im.item?.average_price ?? null,
      count: listings.length
    };
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
        const data = await fetchMarketData(p.id);
        STATE.prices[p.id] = {
          floor: data.floor,
          avg: data.avg,
          listingCount: data.count,
          fetchedAt: nowTs()
        };
        addLog(`${p.name}: floor=${formatMoney(data.floor)} avg=${formatMoney(data.avg)} (${data.count} listings)`);
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
    saveApiKey();
    addLog('All prices fetched');
    renderPanel();
  }

  /* ── render panel ──────────────────────────────────────────── */
  function getSortedPlushies() {
    const rows = PLUSHIES.map(p => {
      const d = STATE.prices[p.id] || {};
      const floor = d.floor || null;
      const avg = d.avg || null;
      return { ...p, floor, avg };
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

    // API key input (shown only when no key is set)
    if (!STATE.apiKey) {
      html += `
        <div style="margin-bottom:10px;padding:10px;border:1px solid #e74c3c;border-radius:10px;background:#2c1015;">
          <div style="font-weight:bold;margin-bottom:6px;color:#e74c3c;">API Key Required</div>
          <div style="margin-bottom:8px;font-size:12px;color:#bbb;">Enter your Torn API key (16 chars). Stored locally in your browser only.</div>
          <div style="display:flex;gap:6px;">
            <input id="tpda-plush-apikey" type="text" maxlength="16" placeholder="API key" style="flex:1;background:#1a1b22;color:#fff;border:1px solid #444;border-radius:6px;padding:6px 8px;font-family:monospace;font-size:13px;">
            <button id="tpda-plush-apikey-save" style="background:#9b59b6;color:white;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">Save</button>
          </div>
        </div>
      `;
    }

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
    html += `<th data-col="floor">Floor${arrow('floor')}</th>`;
    html += `<th data-col="avg">Avg${arrow('avg')}</th>`;
    html += `</tr></thead><tbody>`;

    let totalFloor = 0;
    let allHavePrices = true;

    for (const r of rows) {
      if (r.floor) totalFloor += r.floor; else allHavePrices = false;

      html += `<tr>`;
      html += `<td>${escapeHtml(r.name)}</td>`;
      html += `<td class="tpda-plush-best">${formatMoney(r.floor)}</td>`;
      html += `<td>${formatMoney(r.avg)}</td>`;
      html += `</tr>`;
    }

    html += `<tr class="total-row">`;
    html += `<td>Full Set (13)</td><td></td>`;
    html += `<td class="tpda-plush-best">${allHavePrices ? formatMoney(totalFloor) : '\u2014'}</td>`;
    html += `</tr></tbody></table></div>`;

    // Debug log
    html += `
      <div style="margin-top:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#0f1116;">
        <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" id="tpda-plush-log-toggle">
          <div style="font-weight:bold;font-size:12px;">Log (${STATE._logs.length})</div>
          <div style="display:flex;gap:6px;">
            <button id="tpda-plush-log-copy" style="font-size:11px;background:#444;color:#fff;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;">Copy</button>
            <span style="font-size:11px;color:#bbb;">toggle</span>
          </div>
        </div>
        <div id="tpda-plush-log-body" style="display:none;margin-top:8px;max-height:180px;overflow-y:auto;font-size:11px;color:#aaa;font-family:monospace;white-space:pre-wrap;word-break:break-all;">
${STATE._logs.map(l => escapeHtml(l)).join('\n')}
        </div>
      </div>
    `;

    body.innerHTML = html;

    // Wire up: API key save
    const apiKeyBtn = document.getElementById('tpda-plush-apikey-save');
    if (apiKeyBtn) {
      apiKeyBtn.onclick = () => {
        const input = document.getElementById('tpda-plush-apikey');
        const key = (input?.value || '').trim();
        if (key.length === 16) {
          setApiKey(key, 'manual');
          saveApiKey();
          addLog('API key saved manually');
          renderPanel();
          fetchAllPrices(true);
        }
      };
    }

    // Wire up: sort headers
    body.querySelectorAll('.tpda-plush-table th[data-col]').forEach(th => {
      th.onclick = () => {
        const col = th.dataset.col;
        if (STATE.sortCol === col) STATE.sortAsc = !STATE.sortAsc;
        else { STATE.sortCol = col; STATE.sortAsc = true; }
        renderPanel();
      };
    });

    // Wire up: log toggle
    const logToggle = document.getElementById('tpda-plush-log-toggle');
    if (logToggle) {
      logToggle.onclick = (e) => {
        if (e.target.closest('button')) return;
        const logBody = document.getElementById('tpda-plush-log-body');
        if (logBody) logBody.style.display = logBody.style.display === 'none' ? 'block' : 'none';
      };
    }

    // Wire up: log copy
    const logCopyBtn = document.getElementById('tpda-plush-log-copy');
    if (logCopyBtn) {
      logCopyBtn.onclick = () => {
        navigator.clipboard.writeText(STATE._logs.join('\n')).then(() => {
          logCopyBtn.textContent = 'Copied!';
          setTimeout(() => { logCopyBtn.textContent = 'Copy'; }, 1200);
        }).catch(() => {});
      };
    }
  }

  /* ── resize handler ────────────────────────────────────────── */
  function onResize() {
    const bubble = getBubbleEl();
    const panel = getPanelEl();

    if (bubble && bubble.style.display !== 'none') {
      const pos = getBubblePosition();
      const current = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
      const clamped = clampToViewport(current.left, current.top, BUBBLE_SIZE, BUBBLE_SIZE);
      const next = leftTopToBubbleRightBottom(clamped.left, clamped.top, BUBBLE_SIZE);
      setBubblePosition(next);
      bubble.style.left = ''; bubble.style.top = '';
      bubble.style.right = `${next.right}px`; bubble.style.bottom = `${next.bottom}px`;
    }

    if (panel && panel.style.display !== 'none') {
      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(rect.left, rect.top, rect.width, rect.height);
      panel.style.left = `${clamped.left}px`; panel.style.top = `${clamped.top}px`;
      panel.style.right = ''; panel.style.bottom = '';
      setPanelPosition(clamped);
    }
  }

  /* ── init ───────────────────────────────────────────────────── */
  function init() {
    loadSavedApiKey();
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
