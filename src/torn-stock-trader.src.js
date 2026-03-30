// ==UserScript==
// @name         Dark Tools - Stock Trader
// @namespace    alex.torn.pda.stocktrader.bubble
// @version      1.6.0
// @description  Stock market analyzer — fetches stock prices, tracks history, calculates moving averages, and generates buy/sell signals based on trend analysis.
// @author       Alex + Devin
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-stock-trader-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-stock-trader-bubble.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PDA_INJECTED_KEY = '###PDA-APIKEY###';

  const SCRIPT_KEY = 'tpda_stock_trader_v1';
  const BUBBLE_ID = 'tpda-stock-bubble';
  const PANEL_ID = 'tpda-stock-panel';
  const HEADER_ID = 'tpda-stock-header';
  const BUBBLE_SIZE = 56;

  /* ── Timing constants ──────────────────────────────────────── */
  const MARKET_CACHE_TTL = 5 * 60 * 1000;         /* 5 min — all-stocks overview */
  const DETAIL_CACHE_TTL = 15 * 60 * 1000;        /* 15 min — per-stock chart data */
  const USER_CACHE_TTL = 5 * 60 * 1000;           /* 5 min — user holdings */
  const HISTORY_SNAPSHOT_INTERVAL = 60 * 60 * 1000; /* 1 hour between history snapshots */
  const HISTORY_MAX_AGE = 7 * 24 * 60 * 60 * 1000;  /* 7 days of local history */
  const HISTORY_MAX_POINTS = 168;                  /* 7 days × 24 hours */
  const POLL_MS = 5 * 60 * 1000;                   /* 5 min poll when panel open */
  const API_DELAY_MS = 350;                        /* gap between per-stock detail calls */

  /* ── Stock benefit rules (from AGENTS.md / assistant) ─────── */
  const STOCK_BENEFITS = {
    TCT: { shares: 100000,   cashValue: 1000000,   freqDays: 31, label: '$1M/mo' },
    GRN: { shares: 500000,   cashValue: 4000000,   freqDays: 31, label: '$4M/mo' },
    IOU: { shares: 3000000,  cashValue: 12000000,  freqDays: 31, label: '$12M/mo' },
    TMI: { shares: 6000000,  cashValue: 25000000,  freqDays: 31, label: '$25M/mo' },
    TSB: { shares: 3000000,  cashValue: 50000000,  freqDays: 31, label: '$50M/mo' },
    CNC: { shares: 7500000,  cashValue: 80000000,  freqDays: 31, label: '$80M/mo' }
  };

  /* ── localStorage keys ─────────────────────────────────────── */
  const MARKET_KEY = `${SCRIPT_KEY}_market`;
  const DETAIL_KEY = `${SCRIPT_KEY}_detail`;
  const USER_STOCKS_KEY = `${SCRIPT_KEY}_user_stocks`;
  const HISTORY_KEY = `${SCRIPT_KEY}_history`;
  const WATCHLIST_KEY = `${SCRIPT_KEY}_watchlist`;
  const SETTINGS_KEY = `${SCRIPT_KEY}_settings`;

  /* ── Default watchlist — popular benefit stocks ────────────── */
  const DEFAULT_WATCHLIST = ['TCT', 'GRN', 'IOU', 'TMI', 'TSB', 'CNC', 'FHG', 'SYM', 'MCS', 'EVL', 'EWM', 'LAG', 'PRN', 'THS', 'LSC'];

  function defaultSettings() {
    return {
      sortBy: 'signal',       /* 'signal' | 'change' | 'price' | 'acronym' | 'roi' */
      sortAsc: false,
      showOnlyWatchlist: true,
      showOnlyOwned: false,
      showOnlyNotOwned: false,
      showOnlySignals: false,
      notifyEnabled: false,
      notifyOnBuy: true,
      notifyOnSell: true,
      /* Signal score thresholds */
      strongBuyScore: 4,
      buyScore: 2,
      leanBuyScore: 0.5,
      leanSellScore: -0.5,
      sellScore: -2,
      strongSellScore: -4,
      /* RSI thresholds */
      rsiOversold: 30,
      rsiOverbought: 70,
      /* Benefit ROI thresholds */
      roiGoodPct: 2,
      roiGreatPct: 5
    };
  }

  function loadSettings() {
    const saved = getStorage(SETTINGS_KEY, null);
    if (!saved) return defaultSettings();
    const merged = { ...defaultSettings(), ...saved };
    if (!saved._migratedWatchlistDefault) {
      merged.showOnlyWatchlist = true;
      merged._migratedWatchlistDefault = true;
    }
    return merged;
  }

  function saveSettings() {
    setStorage(SETTINGS_KEY, STATE.settings);
  }

  function loadWatchlist() {
    return getStorage(WATCHLIST_KEY, DEFAULT_WATCHLIST.slice());
  }

  function saveWatchlist() {
    setStorage(WATCHLIST_KEY, STATE.watchlist);
  }

  /* ── STATE ─────────────────────────────────────────────────── */
  const STATE = {
    apiKey: null,
    apiKeySource: '',
    /* Market data (all stocks) */
    marketStocks: [],                /* TornStock[] from /v2/torn/stocks */
    marketFetchedAt: 0,
    /* Per-stock detail with chart history */
    stockDetails: {},                /* acronym → { ...TornStockDetailed, fetchedAt } */
    /* User holdings */
    userStocks: [],                  /* UserStock[] from /v2/user/stocks */
    userFetchedAt: 0,
    /* Local price history for trend analysis */
    priceHistory: {},                /* acronym → [{ price, ts }] */
    lastSnapshotAt: 0,
    /* Computed signals */
    signals: {},                     /* acronym → { signal, strength, reasons[] } */
    /* UI */
    watchlist: loadWatchlist(),
    settings: loadSettings(),
    scanning: false,
    scanProgress: 0,
    scanTotal: 0,
    lastError: '',
    activeTab: 'overview',           /* 'overview' | 'detail' | 'holdings' | 'settings' */
    previousTab: 'overview',         /* tab to return to from detail view */
    detailStock: null,               /* acronym of stock being viewed in detail */
    savedScrollTop: 0,               /* scroll position before entering detail */
    pollTimer: null,
    ui: {
      minimized: true,
      zIndexBase: 999930
    },
    _logs: []
  };

  // #COMMON_CODE


  /* ── Panel expand/collapse hooks ─────────────────────────── */
  function onPanelExpand() {
    renderPanel();
    refreshIfStale();
    startPolling();
  }

  function onPanelCollapse() {
    stopPolling();
  }

  function startPolling() {
    stopPolling();
    STATE.pollTimer = setInterval(() => {
      if (!STATE.scanning) refreshIfStale();
    }, POLL_MS);
  }

  function stopPolling() {
    if (STATE.pollTimer) {
      clearInterval(STATE.pollTimer);
      STATE.pollTimer = null;
    }
  }

  async function refreshIfStale() {
    const now = Date.now();
    if (now - STATE.marketFetchedAt > MARKET_CACHE_TTL) {
      await fetchAllStocks();
    }
    if (STATE.apiKey && now - STATE.userFetchedAt > USER_CACHE_TTL) {
      await fetchUserStocks();
    }
  }


  /* ══════════════════════════════════════════════════════════════
   *  DATA FETCHING
   * ════════════════════════════════════════════════════════════ */

  async function fetchAllStocks() {
    if (!STATE.apiKey) { addLog('fetchAllStocks: no API key'); return; }
    addLog('Fetching all stocks...');
    const url = `https://api.torn.com/v2/torn/stocks?key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
    const data = await tornApiGet(url);
    if (!data) { addLog('fetchAllStocks: no response'); return; }
    if (data.error) { addLog('fetchAllStocks error: ' + (data.error.error || JSON.stringify(data.error))); return; }
    const stocks = data.stocks || [];
    if (!stocks.length) { addLog('fetchAllStocks: empty stocks array'); return; }
    STATE.marketStocks = stocks;
    STATE.marketFetchedAt = Date.now();
    setStorage(MARKET_KEY, { stocks, fetchedAt: STATE.marketFetchedAt });
    addLog('Fetched ' + stocks.length + ' stocks');
    takeHistorySnapshot(stocks);
    computeAllSignals();
    renderPanel();
  }

  async function fetchStockDetail(stockId) {
    if (!STATE.apiKey) return null;
    const url = `https://api.torn.com/v2/torn/${stockId}/stocks?key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
    const data = await tornApiGet(url);
    if (!data || data.error) {
      addLog('fetchStockDetail(' + stockId + ') error: ' + (data?.error?.error || 'no data'));
      return null;
    }
    return data.stocks || data;
  }

  async function fetchWatchlistDetails() {
    if (!STATE.apiKey || STATE.scanning) return;
    STATE.scanning = true;
    const stocksToFetch = [];
    const now = Date.now();
    for (const acr of STATE.watchlist) {
      const existing = STATE.stockDetails[acr];
      if (!existing || now - existing.fetchedAt > DETAIL_CACHE_TTL) {
        const stock = STATE.marketStocks.find(s => s.acronym === acr);
        if (stock) stocksToFetch.push(stock);
      }
    }
    STATE.scanTotal = stocksToFetch.length;
    STATE.scanProgress = 0;
    addLog('Fetching details for ' + stocksToFetch.length + ' watchlist stocks...');
    for (const stock of stocksToFetch) {
      const detail = await fetchStockDetail(stock.id);
      STATE.scanProgress++;
      if (detail) {
        STATE.stockDetails[stock.acronym] = { ...detail, fetchedAt: Date.now() };
        addLog('Detail fetched: ' + stock.acronym);
      }
      if (STATE.scanProgress < STATE.scanTotal) await sleep(API_DELAY_MS);
      renderPanel();
    }
    saveDetailCache();
    STATE.scanning = false;
    computeAllSignals();
    renderPanel();
  }

  async function fetchUserStocks() {
    if (!STATE.apiKey) return;
    addLog('Fetching user stocks...');
    const url = `https://api.torn.com/v2/user/stocks?key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
    const data = await tornApiGet(url);
    if (!data) { addLog('fetchUserStocks: no response'); return; }
    if (data.error) { addLog('fetchUserStocks error: ' + (data.error.error || JSON.stringify(data.error))); return; }
    STATE.userStocks = data.stocks || [];
    STATE.userFetchedAt = Date.now();
    setStorage(USER_STOCKS_KEY, { stocks: STATE.userStocks, fetchedAt: STATE.userFetchedAt });
    addLog('User owns ' + STATE.userStocks.length + ' stock(s)');
    renderPanel();
  }

  function loadCachedData() {
    const market = getStorage(MARKET_KEY, null);
    if (market) {
      STATE.marketStocks = market.stocks || [];
      STATE.marketFetchedAt = market.fetchedAt || 0;
    }
    const user = getStorage(USER_STOCKS_KEY, null);
    if (user) {
      STATE.userStocks = user.stocks || [];
      STATE.userFetchedAt = user.fetchedAt || 0;
    }
    const detail = getStorage(DETAIL_KEY, null);
    if (detail) {
      STATE.stockDetails = detail.details || {};
    }
    const hist = getStorage(HISTORY_KEY, null);
    if (hist) {
      STATE.priceHistory = hist.history || {};
      STATE.lastSnapshotAt = hist.lastSnapshotAt || 0;
    }
  }

  function saveDetailCache() {
    setStorage(DETAIL_KEY, { details: STATE.stockDetails });
  }


  /* ══════════════════════════════════════════════════════════════
   *  PRICE HISTORY & SNAPSHOTS
   * ════════════════════════════════════════════════════════════ */

  function takeHistorySnapshot(stocks) {
    const now = Date.now();
    if (now - STATE.lastSnapshotAt < HISTORY_SNAPSHOT_INTERVAL) return;
    const cutoff = now - HISTORY_MAX_AGE;
    for (const s of stocks) {
      const acr = s.acronym;
      if (!STATE.priceHistory[acr]) STATE.priceHistory[acr] = [];
      STATE.priceHistory[acr].push({ price: s.market.price, ts: now });
      /* Prune old entries */
      STATE.priceHistory[acr] = STATE.priceHistory[acr]
        .filter(p => p.ts > cutoff)
        .slice(-HISTORY_MAX_POINTS);
    }
    STATE.lastSnapshotAt = now;
    setStorage(HISTORY_KEY, { history: STATE.priceHistory, lastSnapshotAt: now });
    addLog('History snapshot taken (' + stocks.length + ' stocks)');
  }


  /* ══════════════════════════════════════════════════════════════
   *  SIGNAL COMPUTATION — Moving Averages & Trend Analysis
   * ════════════════════════════════════════════════════════════ */

  function computeSMA(prices, period) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((s, p) => s + p, 0) / period;
  }

  function computeEMA(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  function computeRSI(prices, period) {
    if (prices.length < period + 1) return null;
    const recent = prices.slice(-(period + 1));
    let gains = 0, losses = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = recent[i] - recent[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  function computeStockSignal(acronym) {
    const reasons = [];
    let score = 0; /* positive = buy, negative = sell */
    const S = STATE.settings;

    const stock = STATE.marketStocks.find(s => s.acronym === acronym);
    if (!stock) return { signal: 'HOLD', strength: 0, reasons: ['No market data'] };

    const price = stock.market.price;
    const detail = STATE.stockDetails[acronym];
    const localHistory = STATE.priceHistory[acronym] || [];
    const localPrices = localHistory.map(h => h.price);

    /* ── 1. API performance data (if detail available) ──────── */
    if (detail && detail.chart && detail.chart.performance) {
      const perf = detail.chart.performance;

      /* Short-term momentum (last hour) — low weight, noisy data */
      if (perf.last_hour) {
        const pct = perf.last_hour.change_percentage;
        if (pct > 2) { score += 0.5; reasons.push(`Hour: +${pct.toFixed(1)}% (bullish momentum)`); }
        else if (pct < -2) { score -= 0.5; reasons.push(`Hour: ${pct.toFixed(1)}% (bearish momentum)`); }
      }

      /* Day trend */
      if (perf.last_day) {
        const pct = perf.last_day.change_percentage;
        if (pct > 3) { score += 1; reasons.push(`Day: +${pct.toFixed(1)}% (strong up)`); }
        else if (pct > 0.5) { score += 0.5; reasons.push(`Day: +${pct.toFixed(1)}% (mild up)`); }
        else if (pct < -3) { score -= 1; reasons.push(`Day: ${pct.toFixed(1)}% (strong down)`); }
        else if (pct < -0.5) { score -= 0.5; reasons.push(`Day: ${pct.toFixed(1)}% (mild down)`); }
      }

      /* Week trend */
      if (perf.last_week) {
        const pct = perf.last_week.change_percentage;
        if (pct > 5) { score += 1.5; reasons.push(`Week: +${pct.toFixed(1)}% (strong uptrend)`); }
        else if (pct > 1) { score += 0.5; reasons.push(`Week: +${pct.toFixed(1)}% (uptrend)`); }
        else if (pct < -5) { score -= 1.5; reasons.push(`Week: ${pct.toFixed(1)}% (strong downtrend)`); }
        else if (pct < -1) { score -= 0.5; reasons.push(`Week: ${pct.toFixed(1)}% (downtrend)`); }
      }

      /* Month trend — heavier weight for longer trend */
      if (perf.last_month) {
        const pct = perf.last_month.change_percentage;
        if (pct > 10) { score += 2; reasons.push(`Month: +${pct.toFixed(1)}% (strong uptrend)`); }
        else if (pct > 2) { score += 1; reasons.push(`Month: +${pct.toFixed(1)}% (uptrend)`); }
        else if (pct < -10) { score -= 2; reasons.push(`Month: ${pct.toFixed(1)}% (strong downtrend)`); }
        else if (pct < -2) { score -= 1; reasons.push(`Month: ${pct.toFixed(1)}% (downtrend)`); }
      }

      /* Support/resistance from day range — symmetric weight */
      if (perf.last_day && perf.last_day.high && perf.last_day.low) {
        const range = perf.last_day.high - perf.last_day.low;
        const position = range > 0 ? (price - perf.last_day.low) / range : 0.5;
        if (position < 0.2) { score += 1; reasons.push('Near day low (support zone)'); }
        else if (position > 0.8) { score -= 1; reasons.push('Near day high (resistance zone)'); }
      }
    }

    /* ── 2. API chart history — SMA crossover ──────────────── */
    if (detail && detail.chart && detail.chart.history && detail.chart.history.length > 12) {
      const histPrices = detail.chart.history.map(h => h.price);
      const sma6 = computeSMA(histPrices, 6);
      const sma12 = computeSMA(histPrices, 12);
      if (sma6 !== null && sma12 !== null) {
        if (sma6 > sma12 * 1.01) { score += 1.5; reasons.push('SMA6 > SMA12 (bullish crossover)'); }
        else if (sma6 < sma12 * 0.99) { score -= 1.5; reasons.push('SMA6 < SMA12 (bearish crossover)'); }
      }

      /* RSI */
      const rsi = computeRSI(histPrices, 14);
      if (rsi !== null) {
        if (rsi < S.rsiOversold) { score += 2; reasons.push(`RSI ${rsi.toFixed(0)} — oversold < ${S.rsiOversold} (buy opportunity)`); }
        else if (rsi < S.rsiOversold + 10) { score += 0.5; reasons.push(`RSI ${rsi.toFixed(0)} — approaching oversold`); }
        else if (rsi > S.rsiOverbought) { score -= 2; reasons.push(`RSI ${rsi.toFixed(0)} — overbought > ${S.rsiOverbought} (sell signal)`); }
        else if (rsi > S.rsiOverbought - 10) { score -= 0.5; reasons.push(`RSI ${rsi.toFixed(0)} — approaching overbought`); }
      }

      /* Price vs EMA — trend confirmation */
      const ema12 = computeEMA(histPrices, 12);
      if (ema12 !== null) {
        const pctAbove = ((price - ema12) / ema12) * 100;
        if (pctAbove > 5) { score -= 0.5; reasons.push(`Price ${pctAbove.toFixed(1)}% above EMA12 (stretched)`); }
        else if (pctAbove < -5) { score += 0.5; reasons.push(`Price ${Math.abs(pctAbove).toFixed(1)}% below EMA12 (undervalued)`); }
      }
    }

    /* ── 3. Local history — own collected data ─────────────── */
    if (localPrices.length >= 6) {
      const localSma3 = computeSMA(localPrices, 3);
      const localSma6 = computeSMA(localPrices, 6);
      if (localSma3 !== null && localSma6 !== null) {
        if (localSma3 > localSma6 * 1.005) { score += 0.5; reasons.push('Local SMA3 > SMA6 (local uptrend)'); }
        else if (localSma3 < localSma6 * 0.995) { score -= 0.5; reasons.push('Local SMA3 < SMA6 (local downtrend)'); }
      }
    }

    /* ── 4. Benefit ROI for cash-paying stocks ─────────────── */
    const benefit = STOCK_BENEFITS[acronym];
    if (benefit && benefit.cashValue && price > 0) {
      const investmentCost = benefit.shares * price;
      const annualReturn = (benefit.cashValue / benefit.freqDays) * 365;
      const roi = (annualReturn / investmentCost) * 100;
      if (roi > S.roiGreatPct) { score += 1; reasons.push(`Benefit ROI ${roi.toFixed(1)}%/yr > ${S.roiGreatPct}% (strong passive income)`); }
      else if (roi > S.roiGoodPct) { score += 0.5; reasons.push(`Benefit ROI ${roi.toFixed(1)}%/yr > ${S.roiGoodPct}%`); }
      else if (roi < 1) { score -= 0.5; reasons.push(`Benefit ROI ${roi.toFixed(1)}%/yr < 1% (overpriced for benefit)`); }
    }

    /* ── Determine signal ─────────────────────────────────── */
    let signal, strength;
    if (score >= S.strongBuyScore) { signal = 'STRONG BUY'; strength = 5; }
    else if (score >= S.buyScore) { signal = 'BUY'; strength = 4; }
    else if (score >= S.leanBuyScore) { signal = 'LEAN BUY'; strength = 3; }
    else if (score <= S.strongSellScore) { signal = 'STRONG SELL'; strength = -5; }
    else if (score <= S.sellScore) { signal = 'SELL'; strength = -4; }
    else if (score <= S.leanSellScore) { signal = 'LEAN SELL'; strength = -3; }
    else { signal = 'HOLD'; strength = 0; }

    return { signal, strength, score, reasons };
  }

  function computeAllSignals() {
    for (const stock of STATE.marketStocks) {
      STATE.signals[stock.acronym] = computeStockSignal(stock.acronym);
    }
    addLog('Signals computed for ' + Object.keys(STATE.signals).length + ' stocks');
  }


  /* ══════════════════════════════════════════════════════════════
   *  HELPERS
   * ════════════════════════════════════════════════════════════ */

  function getSignalColor(signal) {
    if (signal.includes('STRONG BUY')) return '#00e676';
    if (signal.includes('BUY')) return '#4caf50';
    if (signal.includes('STRONG SELL') || signal.includes('STRONG AVOID')) return '#ff1744';
    if (signal.includes('SELL') || signal.includes('AVOID')) return '#f44336';
    return '#ffd740';
  }

  function getSignalIcon(signal) {
    if (signal.includes('STRONG BUY')) return '\u25B2\u25B2';
    if (signal.includes('BUY')) return '\u25B2';
    if (signal.includes('STRONG SELL') || signal.includes('STRONG AVOID')) return '\u25BC\u25BC';
    if (signal.includes('SELL') || signal.includes('AVOID')) return '\u25BC';
    return '\u25CF';
  }

  function stockLogo(stockId, size, acronym) {
    const sz = size || 22;
    const fbSz = Math.round(sz * 0.45);
    const initials = acronym ? escapeHtml(acronym.slice(0, 2)) : '?';
    return `<img src="https://yata.yt/media/stocks/${encodeURIComponent(stockId)}.png" `
      + `width="${sz}" height="${sz}" style="border-radius:4px;vertical-align:middle;object-fit:contain;background:#1a1e2a;" `
      + `onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';" />`
      + `<span style="display:none;width:${sz}px;height:${sz}px;border-radius:4px;background:#2a2e3a;color:#888;`
      + `font-size:${fbSz}px;font-weight:700;align-items:center;justify-content:center;vertical-align:middle;">${initials}</span>`;
  }

  function getChangeColor(pct) {
    if (pct > 0) return '#4caf50';
    if (pct < 0) return '#f44336';
    return '#888';
  }

  function formatPrice(p) {
    if (p == null || isNaN(p)) return '$?';
    if (p >= 1000) return '$' + Number(p).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return '$' + Number(p).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct(pct) {
    if (pct == null || isNaN(pct)) return '?%';
    const sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(2) + '%';
  }

  function formatLargeNumber(n) {
    if (n == null || isNaN(n)) return '?';
    if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  function sparkline(prices, width, height) {
    if (!prices || prices.length < 2) return '';
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const step = width / (prices.length - 1);
    const points = prices.map((p, i) => {
      const x = (i * step).toFixed(1);
      const y = (height - ((p - min) / range) * (height - 4) - 2).toFixed(1);
      return `${x},${y}`;
    }).join(' ');
    const startColor = prices[prices.length - 1] >= prices[0] ? '#4caf50' : '#f44336';
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" style="display:block;" preserveAspectRatio="xMidYMid meet">` +
      `<polyline points="${points}" fill="none" stroke="${startColor}" stroke-width="1.5" />` +
      `</svg>`;
  }

  function getUserHolding(stockId) {
    return STATE.userStocks.find(s => s.id === stockId);
  }

  function contextSignal(signal, owned) {
    if (owned) return signal;
    if (signal === 'STRONG SELL') return 'STRONG AVOID';
    if (signal === 'SELL') return 'AVOID';
    if (signal === 'LEAN SELL') return 'LEAN AVOID';
    return signal;
  }

  function getFilteredStocks() {
    let stocks = STATE.marketStocks.slice();
    const s = STATE.settings;
    if (s.showOnlyWatchlist) {
      stocks = stocks.filter(st => STATE.watchlist.includes(st.acronym));
    }
    if (s.showOnlyOwned) {
      const ownedIds = new Set(STATE.userStocks.map(u => u.id));
      stocks = stocks.filter(st => ownedIds.has(st.id));
    }
    if (s.showOnlyNotOwned) {
      const ownedIds = new Set(STATE.userStocks.map(u => u.id));
      stocks = stocks.filter(st => !ownedIds.has(st.id));
    }
    if (s.showOnlySignals) {
      stocks = stocks.filter(st => {
        const sig = STATE.signals[st.acronym];
        return sig && sig.signal !== 'HOLD';
      });
    }
    /* Sort */
    stocks.sort((a, b) => {
      const sigA = STATE.signals[a.acronym] || { strength: 0, score: 0 };
      const sigB = STATE.signals[b.acronym] || { strength: 0, score: 0 };
      let cmp = 0;
      switch (s.sortBy) {
        case 'signal': cmp = sigB.score - sigA.score; break;
        case 'change': {
          const cA = a.market?.price || 0;
          const cB = b.market?.price || 0;
          const detA = STATE.stockDetails[a.acronym];
          const detB = STATE.stockDetails[b.acronym];
          const pctA = detA?.chart?.performance?.last_day?.change_percentage || 0;
          const pctB = detB?.chart?.performance?.last_day?.change_percentage || 0;
          cmp = pctB - pctA;
          break;
        }
        case 'price': cmp = (b.market?.price || 0) - (a.market?.price || 0); break;
        case 'acronym': cmp = a.acronym.localeCompare(b.acronym); break;
        case 'roi': {
          const roiA = STOCK_BENEFITS[a.acronym] ? (STOCK_BENEFITS[a.acronym].cashValue / STOCK_BENEFITS[a.acronym].freqDays * 365) / (STOCK_BENEFITS[a.acronym].shares * (a.market?.price || 1)) * 100 : 0;
          const roiB = STOCK_BENEFITS[b.acronym] ? (STOCK_BENEFITS[b.acronym].cashValue / STOCK_BENEFITS[b.acronym].freqDays * 365) / (STOCK_BENEFITS[b.acronym].shares * (b.market?.price || 1)) * 100 : 0;
          cmp = roiB - roiA;
          break;
        }
        default: cmp = 0;
      }
      return s.sortAsc ? -cmp : cmp;
    });
    return stocks;
  }


  /* ══════════════════════════════════════════════════════════════
   *  UI — Styles, Bubble, Panel
   * ════════════════════════════════════════════════════════════ */

  function ensureStyles() {
    if (document.getElementById('tpda-stock-styles')) return;
    const style = document.createElement('style');
    style.id = 'tpda-stock-styles';
    style.textContent = `
      #${BUBBLE_ID} { position:fixed; width:${BUBBLE_SIZE}px; height:${BUBBLE_SIZE}px; border-radius:50%;
        background:linear-gradient(135deg,#f4b740,#e09520); display:flex; align-items:center; justify-content:center;
        cursor:pointer; font-weight:900; font-size:18px; color:#1a1a2e; box-shadow:0 4px 16px rgba(244,183,64,.5);
        user-select:none; touch-action:none; z-index:${STATE.ui.zIndexBase}; transition:box-shadow .2s; }
      #${BUBBLE_ID}:hover { box-shadow:0 4px 24px rgba(244,183,64,.8); }
      #${PANEL_ID} { position:fixed; width:400px; max-width:95vw; max-height:85vh; display:none; flex-direction:column;
        background:#0d0f14; border:1px solid #2f3340; border-radius:14px; overflow:hidden;
        box-shadow:0 8px 32px rgba(0,0,0,.6); z-index:${STATE.ui.zIndexBase + 1};
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:13px; color:#fff; }
      #${HEADER_ID} { display:flex; align-items:center; justify-content:space-between; padding:10px 14px;
        background:#141821; border-bottom:1px solid #2f3340; cursor:grab; user-select:none; touch-action:none; }
      .tpda-stock-body { flex:1; overflow-y:auto; padding:10px; }
      .tpda-stock-card { margin-bottom:8px; padding:10px; border:1px solid #2f3340; border-radius:10px; background:#141821; }
      .tpda-stock-row { display:flex; align-items:center; justify-content:space-between; padding:6px 10px;
        border-bottom:1px solid #1e222d; cursor:pointer; transition:background .15s; }
      .tpda-stock-row:hover { background:#1a1e2a; }
      .tpda-stock-row:last-child { border-bottom:none; }
      .tpda-stock-tabs { display:flex; gap:2px; padding:0 10px 8px; }
      .tpda-stock-tab { flex:1; padding:6px 0; text-align:center; border-radius:8px; cursor:pointer;
        background:#1a1e2a; color:#888; font-size:12px; font-weight:600; transition:all .15s; }
      .tpda-stock-tab.active { background:#2a6df4; color:#fff; }
      .tpda-stock-btn { border:none; border-radius:8px; padding:6px 12px; cursor:pointer; font-size:12px; font-weight:600; }
      .tpda-stock-badge { display:inline-block; padding:2px 6px; border-radius:6px; font-size:11px; font-weight:700; }
    `;
    document.head.appendChild(style);
  }

  function createBubble() {
    if (getBubbleEl()) return;
    const el = document.createElement('div');
    el.id = BUBBLE_ID;
    el.setAttribute('data-tpda-bubble', '1');
    el.textContent = '$';
    const pos = getBubblePosition();
    const lt = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
    const clamped = clampToViewport(lt.left, lt.top, BUBBLE_SIZE, BUBBLE_SIZE);
    const safe = leftTopToBubbleRightBottom(clamped.left, clamped.top, BUBBLE_SIZE);
    el.style.right = safe.right + 'px';
    el.style.bottom = safe.bottom + 'px';
    document.body.appendChild(el);
    makeDraggableBubble(el);
    el.addEventListener('click', (e) => {
      if (el.dataset.dragged === '1') { el.dataset.dragged = '0'; return; }
      expandPanelNearBubble();
    });
  }

  function createPanel() {
    if (getPanelEl()) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div id="${HEADER_ID}">
        <div style="font-weight:700;font-size:14px;">\u{1F4C8} Stock Trader</div>
        <button class="tpda-stock-close" style="background:none;border:none;color:#aaa;font-size:20px;cursor:pointer;padding:0 4px;">\u2715</button>
      </div>
      <div class="tpda-stock-body"></div>
    `;
    document.body.appendChild(panel);
    const header = document.getElementById(HEADER_ID);
    makeDraggablePanel(panel, header);
    /* Delegated click handlers — attached ONCE */
    panel.querySelector('.tpda-stock-close').onclick = () => collapseToBubble();
    const body = panel.querySelector('.tpda-stock-body');
    body.addEventListener('click', (e) => {
      if (handleApiKeyClick(e, body, () => renderPanel())) return;
      if (handleLogClick(e, body)) return;
      handlePanelClick(e, body);
    });
    body.addEventListener('change', (e) => {
      const numInput = e.target.closest('.tpda-stock-num-setting');
      if (numInput) {
        const val = parseFloat(numInput.value);
        if (!isNaN(val)) {
          STATE.settings[numInput.dataset.key] = val;
          saveSettings();
          computeAllSignals();
          addLog('Setting ' + numInput.dataset.key + ' = ' + val);
        }
      }
      const sortSel = e.target.closest('.tpda-stock-sort');
      if (sortSel) {
        STATE.settings.sortBy = sortSel.value;
        saveSettings();
        renderPanel();
      }
    });
  }


  /* ══════════════════════════════════════════════════════════════
   *  RENDER PANEL
   * ════════════════════════════════════════════════════════════ */

  function renderPanel() {
    const panel = getPanelEl();
    if (!panel || STATE.ui.minimized) return;
    const body = panel.querySelector('.tpda-stock-body');
    if (!body) return;

    let html = '';

    /* ── API Key card ──────────────────────────────────────── */
    html += renderApiKeyCard();

    /* ── Tabs ──────────────────────────────────────────────── */
    html += `<div class="tpda-stock-tabs">
      <div class="tpda-stock-tab ${STATE.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</div>
      <div class="tpda-stock-tab ${STATE.activeTab === 'holdings' ? 'active' : ''}" data-tab="holdings">Holdings</div>
      <div class="tpda-stock-tab ${STATE.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</div>
    </div>`;

    /* ── Status bar ────────────────────────────────────────── */
    if (STATE.scanning) {
      html += `<div style="padding:4px 10px;font-size:11px;color:#ffd740;">Scanning ${STATE.scanProgress}/${STATE.scanTotal}...</div>`;
    } else if (STATE.marketFetchedAt) {
      const signalCount = Object.values(STATE.signals).filter(s => s.signal !== 'HOLD').length;
      html += `<div style="padding:4px 10px;font-size:11px;color:#888;">
        ${STATE.marketStocks.length} stocks \u2022 ${signalCount} signals \u2022 Updated ${ageText(STATE.marketFetchedAt)}
        <span class="tpda-stock-refresh" style="color:#2a6df4;cursor:pointer;margin-left:8px;">\u21BB Refresh</span>
      </div>`;
    }

    /* ── Tab content ───────────────────────────────────────── */
    if (STATE.activeTab === 'overview') {
      html += renderOverviewTab();
    } else if (STATE.activeTab === 'detail' && STATE.detailStock) {
      html += renderDetailTab();
    } else if (STATE.activeTab === 'holdings') {
      html += renderHoldingsTab();
    } else if (STATE.activeTab === 'settings') {
      html += renderSettingsTab();
    }

    /* ── Debug log ─────────────────────────────────────────── */
    html += renderLogCard();

    body.innerHTML = html;
  }

  function renderOverviewTab() {
    if (!STATE.marketStocks.length) {
      return `<div class="tpda-stock-card" style="color:#888;text-align:center;">
        ${STATE.apiKey ? 'Loading stock data...' : 'Enter your API key above to start tracking stocks.'}
      </div>`;
    }

    const stocks = getFilteredStocks();
    let html = '';

    /* Filter toggles */
    html += `<div style="padding:0 0 8px;display:flex;gap:6px;flex-wrap:wrap;">
      <label style="font-size:11px;color:#aaa;cursor:pointer;">
        <input type="checkbox" class="tpda-stock-filter" data-filter="showOnlyWatchlist" ${STATE.settings.showOnlyWatchlist ? 'checked' : ''} style="margin-right:3px;" />Watchlist
      </label>
      <label style="font-size:11px;color:#aaa;cursor:pointer;">
        <input type="checkbox" class="tpda-stock-filter" data-filter="showOnlyOwned" ${STATE.settings.showOnlyOwned ? 'checked' : ''} style="margin-right:3px;" />Owned
      </label>
      <label style="font-size:11px;color:#aaa;cursor:pointer;">
        <input type="checkbox" class="tpda-stock-filter" data-filter="showOnlyNotOwned" ${STATE.settings.showOnlyNotOwned ? 'checked' : ''} style="margin-right:3px;" />Not Owned
      </label>
      <label style="font-size:11px;color:#aaa;cursor:pointer;">
        <input type="checkbox" class="tpda-stock-filter" data-filter="showOnlySignals" ${STATE.settings.showOnlySignals ? 'checked' : ''} style="margin-right:3px;" />Signals Only
      </label>
      <select class="tpda-stock-sort" style="background:#1a1e2a;color:#bbb;border:1px solid #333;border-radius:6px;font-size:11px;padding:2px 6px;margin-left:auto;">
        <option value="signal" ${STATE.settings.sortBy === 'signal' ? 'selected' : ''}>Sort: Signal</option>
        <option value="change" ${STATE.settings.sortBy === 'change' ? 'selected' : ''}>Sort: Change%</option>
        <option value="price" ${STATE.settings.sortBy === 'price' ? 'selected' : ''}>Sort: Price</option>
        <option value="acronym" ${STATE.settings.sortBy === 'acronym' ? 'selected' : ''}>Sort: Name</option>
        <option value="roi" ${STATE.settings.sortBy === 'roi' ? 'selected' : ''}>Sort: Benefit ROI</option>
      </select>
    </div>`;

    /* Stock rows */
    html += `<div class="tpda-stock-card" style="padding:0;">`;
    for (const stock of stocks) {
      const sig = STATE.signals[stock.acronym] || { signal: 'HOLD', strength: 0 };
      const detail = STATE.stockDetails[stock.acronym];
      const dayPct = detail?.chart?.performance?.last_day?.change_percentage;
      const history = (detail?.chart?.history || []).map(h => h.price);
      const isWatchlisted = STATE.watchlist.includes(stock.acronym);
      const holding = getUserHolding(stock.id);
      const label = contextSignal(sig.signal, !!holding);

      let pnlNote = '';
      if (holding && sig.strength < 0 && holding.transactions && holding.transactions.length) {
        const lastTx = holding.transactions[holding.transactions.length - 1];
        const pnl = (stock.market.price - lastTx.price) * holding.shares;
        const pnlPct = lastTx.price > 0 ? ((stock.market.price - lastTx.price) / lastTx.price) * 100 : 0;
        pnlNote = `<div style="font-size:10px;color:${pnl >= 0 ? '#4caf50' : '#f44336'};margin-top:1px;">P&L: ${formatMoney(pnl)} (${formatPct(pnlPct)})</div>`;
      }

      html += `<div class="tpda-stock-row" data-stock="${escapeHtml(stock.acronym)}">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;">
            ${stockLogo(stock.id, 22, stock.acronym)}
            <span style="font-weight:700;color:${isWatchlisted ? '#ffd740' : '#fff'};">${escapeHtml(stock.acronym)}</span>
            ${holding ? '<span style="font-size:10px;color:#4caf50;">\u25CF owned</span>' : ''}
            <span style="font-size:11px;color:#888;">${escapeHtml(stock.name || '')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
            <span style="font-size:12px;">${formatPrice(stock.market.price)}</span>
            ${dayPct != null ? `<span style="font-size:11px;color:${getChangeColor(dayPct)};">${formatPct(dayPct)}</span>` : ''}
            ${history.length > 2 ? sparkline(history.slice(-30), 60, 18) : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <span class="tpda-stock-badge" style="background:${getSignalColor(label)}22;color:${getSignalColor(label)};">
            ${getSignalIcon(label)} ${escapeHtml(label)}
          </span>
          ${pnlNote}
        </div>
      </div>`;
    }
    html += `</div>`;

    if (!stocks.length) {
      html += `<div style="color:#888;text-align:center;padding:12px;">No stocks match your filters.</div>`;
    }

    return html;
  }

  function renderDetailTab() {
    const acronym = STATE.detailStock;
    const stock = STATE.marketStocks.find(s => s.acronym === acronym);
    if (!stock) return `<div class="tpda-stock-card" style="color:#888;">Stock not found.</div>`;

    const detail = STATE.stockDetails[acronym];
    const sig = STATE.signals[acronym] || { signal: 'HOLD', strength: 0, reasons: [] };
    const holding = getUserHolding(stock.id);
    const benefit = STOCK_BENEFITS[acronym];
    const isWatchlisted = STATE.watchlist.includes(acronym);
    const label = contextSignal(sig.signal, !!holding);

    let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <button class="tpda-stock-btn tpda-stock-back" style="background:#2a2e3a;color:#fff;">\u2190 Back</button>
      ${stockLogo(stock.id, 28, acronym)}
      <span style="font-weight:700;font-size:16px;">${escapeHtml(acronym)}</span>
      <span style="color:#888;">${escapeHtml(stock.name || '')}</span>
      <button class="tpda-stock-btn tpda-stock-watchlist-toggle" data-acr="${escapeHtml(acronym)}"
        style="background:${isWatchlisted ? '#ffd740' : '#2a2e3a'};color:${isWatchlisted ? '#1a1a2e' : '#888'};margin-left:auto;">
        ${isWatchlisted ? '\u2605 Watching' : '\u2606 Watch'}
      </button>
    </div>`;

    /* Price & signal card */
    html += `<div class="tpda-stock-card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:22px;font-weight:700;">${formatPrice(stock.market.price)}</div>
          <div style="font-size:12px;color:#888;">Cap: ${formatLargeNumber(stock.market.cap)} \u2022 Investors: ${formatNumber(stock.market.investors)}</div>
        </div>
        <div style="text-align:right;">
          <div class="tpda-stock-badge" style="background:${getSignalColor(label)}22;color:${getSignalColor(label)};font-size:14px;padding:4px 10px;">
            ${getSignalIcon(label)} ${escapeHtml(label)}
          </div>
          <div style="font-size:11px;color:#888;margin-top:4px;">Score: ${sig.score?.toFixed(1) || '0'}</div>
        </div>
      </div>
    </div>`;

    /* Chart */
    if (detail && detail.chart && detail.chart.history && detail.chart.history.length > 2) {
      const prices = detail.chart.history.map(h => h.price);
      html += `<div class="tpda-stock-card" style="text-align:center;">
        <div style="font-size:11px;color:#888;margin-bottom:4px;">Price History (${prices.length} points)</div>
        ${sparkline(prices, 360, 60)}
      </div>`;
    }

    /* Performance table */
    if (detail && detail.chart && detail.chart.performance) {
      const perf = detail.chart.performance;
      const periods = [
        ['1 Hour', perf.last_hour],
        ['1 Day', perf.last_day],
        ['1 Week', perf.last_week],
        ['1 Month', perf.last_month],
        ['1 Year', perf.last_year],
        ['All Time', perf.all_time]
      ];
      html += `<div class="tpda-stock-card">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Performance</div>
        <table style="width:100%;font-size:11px;border-collapse:collapse;color:#ccc;">
          <tr style="color:#888;"><th style="text-align:left;padding:2px 4px;">Period</th><th style="text-align:right;padding:2px 4px;">Change</th><th style="text-align:right;padding:2px 4px;">High</th><th style="text-align:right;padding:2px 4px;">Low</th></tr>`;
      for (const [label, p] of periods) {
        if (!p) continue;
        html += `<tr>
          <td style="padding:2px 4px;color:#ccc;">${label}</td>
          <td style="padding:2px 4px;text-align:right;color:${getChangeColor(p.change_percentage)};">${formatPct(p.change_percentage)}</td>
          <td style="padding:2px 4px;text-align:right;color:#ccc;">${formatPrice(p.high)}</td>
          <td style="padding:2px 4px;text-align:right;color:#ccc;">${formatPrice(p.low)}</td>
        </tr>`;
      }
      html += `</table></div>`;
    }

    /* Signal analysis */
    if (sig.reasons && sig.reasons.length) {
      html += `<div class="tpda-stock-card">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Signal Analysis</div>`;
      for (const reason of sig.reasons) {
        html += `<div style="font-size:11px;color:#bbb;padding:2px 0;">\u2022 ${escapeHtml(reason)}</div>`;
      }
      if (holding && sig.strength < 0 && holding.transactions && holding.transactions.length) {
        const lastTx = holding.transactions[holding.transactions.length - 1];
        const pnlPct = lastTx.price > 0 ? ((stock.market.price - lastTx.price) / lastTx.price) * 100 : 0;
        if (pnlPct < 0) {
          html += `<div style="font-size:11px;color:#ffd740;padding:4px 0 0;border-top:1px solid #2f3340;margin-top:4px;">\u26A0 You own this stock at ${formatPct(pnlPct)} P&L. Selling now locks in losses.</div>`;
        }
      }
      if (!holding && sig.strength < 0) {
        html += `<div style="font-size:11px;color:#888;padding:4px 0 0;border-top:1px solid #2f3340;margin-top:4px;">You don't own this stock \u2014 signal means "avoid buying."</div>`;
      }
      html += `</div>`;
    }

    /* User holding */
    if (holding) {
      const totalValue = holding.shares * stock.market.price;
      html += `<div class="tpda-stock-card">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Your Position</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
          <span>Shares:</span><span>${formatNumber(holding.shares)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
          <span>Value:</span><span>${formatMoney(totalValue)}</span>
        </div>`;
      if (holding.bonus) {
        html += `<div style="display:flex;justify-content:space-between;font-size:12px;">
          <span>Bonus:</span><span>${holding.bonus.available ? '\u2705 Available' : `Progress: ${holding.bonus.progress}/${holding.bonus.frequency} days`}</span>
        </div>`;
      }
      if (holding.transactions && holding.transactions.length) {
        const lastTx = holding.transactions[holding.transactions.length - 1];
        const avgBuy = lastTx.price;
        const pnl = (stock.market.price - avgBuy) * holding.shares;
        const pnlPct = avgBuy > 0 ? ((stock.market.price - avgBuy) / avgBuy) * 100 : 0;
        html += `<div style="display:flex;justify-content:space-between;font-size:12px;">
          <span>Last buy price:</span><span>${formatPrice(avgBuy)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
          <span>Unrealized P&L:</span><span style="color:${pnl >= 0 ? '#4caf50' : '#f44336'};">${formatMoney(pnl)} (${formatPct(pnlPct)})</span>
        </div>`;
      }
      html += `</div>`;
    }

    /* Benefit info */
    if (benefit) {
      const investmentCost = benefit.shares * stock.market.price;
      const annualReturn = (benefit.cashValue / benefit.freqDays) * 365;
      const roi = investmentCost > 0 ? (annualReturn / investmentCost) * 100 : 0;
      const paybackDays = annualReturn > 0 ? (investmentCost / annualReturn) * 365 : 0;
      html += `<div class="tpda-stock-card">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Benefit Block</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>Required:</span><span>${formatNumber(benefit.shares)} shares</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>Investment:</span><span>${formatMoney(investmentCost)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>Payout:</span><span>${benefit.label}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>Annual ROI:</span><span style="color:${roi > 3 ? '#4caf50' : '#ffd740'};">${roi.toFixed(2)}%</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>Payback:</span><span>${paybackDays.toFixed(0)} days</span></div>
      </div>`;
    }

    /* Technical indicators card */
    if (detail && detail.chart && detail.chart.history && detail.chart.history.length > 6) {
      const prices = detail.chart.history.map(h => h.price);
      const sma6 = computeSMA(prices, 6);
      const sma12 = computeSMA(prices, 12);
      const ema12 = computeEMA(prices, 12);
      const rsi = computeRSI(prices, 14);
      html += `<div class="tpda-stock-card">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Technical Indicators</div>`;
      if (sma6 !== null) html += `<div style="display:flex;justify-content:space-between;font-size:12px;"><span>SMA-6:</span><span>${formatPrice(sma6)}</span></div>`;
      if (sma12 !== null) html += `<div style="display:flex;justify-content:space-between;font-size:12px;"><span>SMA-12:</span><span>${formatPrice(sma12)}</span></div>`;
      if (ema12 !== null) html += `<div style="display:flex;justify-content:space-between;font-size:12px;"><span>EMA-12:</span><span>${formatPrice(ema12)}</span></div>`;
      if (rsi !== null) {
        const rsiColor = rsi < 30 ? '#4caf50' : rsi > 70 ? '#f44336' : '#ffd740';
        html += `<div style="display:flex;justify-content:space-between;font-size:12px;"><span>RSI-14:</span><span style="color:${rsiColor};">${rsi.toFixed(1)}</span></div>`;
      }
      html += `</div>`;
    }

    return html;
  }

  function renderHoldingsTab() {
    if (!STATE.userStocks.length) {
      return `<div class="tpda-stock-card" style="color:#888;text-align:center;">
        ${STATE.apiKey ? 'No stock holdings found. Buy stocks on the Torn stock market!' : 'Enter your API key to see your holdings.'}
      </div>`;
    }

    let totalValue = 0;
    let totalPnl = 0;
    let html = '';

    for (const us of STATE.userStocks) {
      const stock = STATE.marketStocks.find(s => s.id === us.id);
      if (!stock) continue;
      const value = us.shares * stock.market.price;
      totalValue += value;
      const sig = STATE.signals[stock.acronym] || { signal: 'HOLD', strength: 0 };

      let pnl = 0, pnlPct = 0;
      if (us.transactions && us.transactions.length) {
        const lastTx = us.transactions[us.transactions.length - 1];
        pnl = (stock.market.price - lastTx.price) * us.shares;
        pnlPct = lastTx.price > 0 ? ((stock.market.price - lastTx.price) / lastTx.price) * 100 : 0;
        totalPnl += pnl;
      }

      html += `<div class="tpda-stock-card" style="cursor:pointer;" data-stock="${escapeHtml(stock.acronym)}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:6px;">
            ${stockLogo(stock.id, 22, stock.acronym)}
            <span style="font-weight:700;">${escapeHtml(stock.acronym)}</span>
            <span style="font-size:11px;color:#888;">${escapeHtml(stock.name || '')}</span>
          </div>
          <span class="tpda-stock-badge" style="background:${getSignalColor(sig.signal)}22;color:${getSignalColor(sig.signal)};">
            ${getSignalIcon(sig.signal)} ${escapeHtml(sig.signal)}
          </span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:12px;">
          <span>${formatNumber(us.shares)} shares @ ${formatPrice(stock.market.price)}</span>
          <span>${formatMoney(value)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:2px;font-size:11px;">
          <span style="color:#888;">P&L</span>
          <span style="color:${pnl >= 0 ? '#4caf50' : '#f44336'};">${formatMoney(pnl)} (${formatPct(pnlPct)})</span>
        </div>
        ${pnl < 0 && sig.strength < 0 ? `<div style="font-size:10px;color:#ffd740;margin-top:3px;">\u26A0 Bearish trend \u2014 consider holding for recovery or cutting losses</div>` : ''}
        ${us.bonus ? `<div style="font-size:11px;color:#888;margin-top:2px;">Bonus: ${us.bonus.available ? '\u2705 Ready' : us.bonus.progress + '/' + us.bonus.frequency + ' days'}</div>` : ''}
      </div>`;
    }

    /* Portfolio summary */
    const summaryHtml = `<div class="tpda-stock-card" style="background:#1a1e2a;">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;">
        <span>Portfolio Value</span><span>${formatMoney(totalValue)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;">
        <span>Total P&L</span><span style="color:${totalPnl >= 0 ? '#4caf50' : '#f44336'};">${formatMoney(totalPnl)}</span>
      </div>
      <div style="font-size:11px;color:#888;margin-top:4px;">${STATE.userStocks.length} position(s) \u2022 Updated ${ageText(STATE.userFetchedAt)}</div>
    </div>`;

    return summaryHtml + html;
  }

  function settingRow(label, key, step, min, max) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#bbb;margin-bottom:4px;">
      <span>${label}</span>
      <input type="number" class="tpda-stock-num-setting" data-key="${key}" value="${STATE.settings[key]}"
        step="${step}" ${min != null ? 'min="' + min + '"' : ''} ${max != null ? 'max="' + max + '"' : ''}
        style="width:64px;background:#0f1116;color:#fff;border:1px solid #444;border-radius:6px;padding:3px 6px;font-size:12px;text-align:right;" />
    </div>`;
  }

  function renderSettingsTab() {
    let html = '';

    /* Signal score thresholds */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Signal Thresholds</div>
      <div style="font-size:10px;color:#666;margin-bottom:6px;">Score needed to trigger each signal level</div>
      ${settingRow('Strong Buy \u2265', 'strongBuyScore', 0.5, 0)}
      ${settingRow('Buy \u2265', 'buyScore', 0.5, 0)}
      ${settingRow('Lean Buy \u2265', 'leanBuyScore', 0.1, 0)}
      ${settingRow('Lean Sell \u2264', 'leanSellScore', 0.1, null, 0)}
      ${settingRow('Sell \u2264', 'sellScore', 0.5, null, 0)}
      ${settingRow('Strong Sell \u2264', 'strongSellScore', 0.5, null, 0)}
    </div>`;

    /* RSI thresholds */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">RSI Thresholds</div>
      ${settingRow('Oversold below', 'rsiOversold', 5, 5, 50)}
      ${settingRow('Overbought above', 'rsiOverbought', 5, 50, 95)}
    </div>`;

    /* Benefit ROI thresholds */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Benefit ROI</div>
      <div style="font-size:10px;color:#666;margin-bottom:6px;">Annual ROI % to boost buy signal for dividend stocks</div>
      ${settingRow('Good ROI \u2265', 'roiGoodPct', 0.5, 0)}
      ${settingRow('Great ROI \u2265', 'roiGreatPct', 0.5, 0)}
    </div>`;

    /* Watchlist management */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Watchlist (${STATE.watchlist.length} stocks)</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">`;
    for (const acr of STATE.watchlist) {
      html += `<span class="tpda-stock-badge tpda-stock-watchlist-remove" data-acr="${escapeHtml(acr)}"
        style="background:#ffd74033;color:#ffd740;cursor:pointer;">${escapeHtml(acr)} \u2715</span>`;
    }
    html += `</div>
      <div style="display:flex;gap:6px;">
        <input class="tpda-stock-watchlist-input" type="text" placeholder="Add ticker (e.g. TCT)"
          style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:8px;padding:6px 8px;font-size:12px;text-transform:uppercase;" />
        <button class="tpda-stock-btn tpda-stock-watchlist-add" style="background:#2a6df4;color:#fff;">Add</button>
      </div>
      <button class="tpda-stock-btn tpda-stock-watchlist-reset" style="background:#2a2e3a;color:#888;margin-top:6px;width:100%;">Reset to Defaults</button>
    </div>`;

    /* Notification settings */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Notifications</div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#bbb;cursor:pointer;margin-bottom:4px;">
        <input type="checkbox" class="tpda-stock-setting" data-key="notifyEnabled" ${STATE.settings.notifyEnabled ? 'checked' : ''} /> Enable notifications
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#bbb;cursor:pointer;margin-bottom:4px;">
        <input type="checkbox" class="tpda-stock-setting" data-key="notifyOnBuy" ${STATE.settings.notifyOnBuy ? 'checked' : ''} /> Notify on BUY signals
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#bbb;cursor:pointer;">
        <input type="checkbox" class="tpda-stock-setting" data-key="notifyOnSell" ${STATE.settings.notifyOnSell ? 'checked' : ''} /> Notify on SELL signals
      </label>
    </div>`;

    /* Data management */
    html += `<div class="tpda-stock-card">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Data</div>
      <div style="font-size:11px;color:#888;margin-bottom:6px;">
        History: ${Object.keys(STATE.priceHistory).length} stocks tracked \u2022 Last snapshot ${STATE.lastSnapshotAt ? ageText(STATE.lastSnapshotAt) : 'never'}<br/>
        Details cached: ${Object.keys(STATE.stockDetails).length} stocks
      </div>
      <div style="display:flex;gap:6px;">
        <button class="tpda-stock-btn tpda-stock-fetch-details" style="background:#2a6df4;color:#fff;flex:1;">Fetch Watchlist Details</button>
        <button class="tpda-stock-btn tpda-stock-clear-history" style="background:#f4433633;color:#f44336;flex:1;">Clear History</button>
      </div>
    </div>`;

    return html;
  }


  /* ══════════════════════════════════════════════════════════════
   *  EVENT HANDLING
   * ════════════════════════════════════════════════════════════ */

  function handlePanelClick(e, body) {
    /* Tab switch */
    const tab = e.target.closest('.tpda-stock-tab');
    if (tab) {
      STATE.activeTab = tab.dataset.tab;
      renderPanel();
      return;
    }

    /* Refresh */
    if (e.target.closest('.tpda-stock-refresh')) {
      STATE.marketFetchedAt = 0;
      STATE.userFetchedAt = 0;
      refreshIfStale();
      return;
    }

    /* Back from detail */
    if (e.target.closest('.tpda-stock-back')) {
      STATE.activeTab = STATE.previousTab || 'overview';
      STATE.detailStock = null;
      renderPanel();
      const bdy = getPanelEl()?.querySelector('.tpda-stock-body');
      if (bdy) bdy.scrollTop = STATE.savedScrollTop || 0;
      return;
    }

    /* Stock row click → detail */
    const stockRow = e.target.closest('[data-stock]');
    if (stockRow) {
      const bdy = getPanelEl()?.querySelector('.tpda-stock-body');
      STATE.savedScrollTop = bdy ? bdy.scrollTop : 0;
      STATE.previousTab = STATE.activeTab;
      STATE.detailStock = stockRow.dataset.stock;
      STATE.activeTab = 'detail';
      renderPanel();
      /* Fetch detail if not cached */
      const detail = STATE.stockDetails[STATE.detailStock];
      if (!detail || Date.now() - detail.fetchedAt > DETAIL_CACHE_TTL) {
        const stock = STATE.marketStocks.find(s => s.acronym === STATE.detailStock);
        if (stock) {
          fetchStockDetail(stock.id).then(d => {
            if (d) {
              STATE.stockDetails[STATE.detailStock] = { ...d, fetchedAt: Date.now() };
              saveDetailCache();
              computeAllSignals();
              renderPanel();
            }
          });
        }
      }
      return;
    }

    /* Watchlist toggle */
    const wlToggle = e.target.closest('.tpda-stock-watchlist-toggle');
    if (wlToggle) {
      const acr = wlToggle.dataset.acr;
      const idx = STATE.watchlist.indexOf(acr);
      if (idx >= 0) STATE.watchlist.splice(idx, 1);
      else STATE.watchlist.push(acr);
      saveWatchlist();
      renderPanel();
      return;
    }

    /* Watchlist remove badge */
    const wlRemove = e.target.closest('.tpda-stock-watchlist-remove');
    if (wlRemove) {
      const acr = wlRemove.dataset.acr;
      const idx = STATE.watchlist.indexOf(acr);
      if (idx >= 0) STATE.watchlist.splice(idx, 1);
      saveWatchlist();
      renderPanel();
      return;
    }

    /* Watchlist add */
    if (e.target.closest('.tpda-stock-watchlist-add')) {
      const input = body.querySelector('.tpda-stock-watchlist-input');
      const acr = String(input?.value || '').trim().toUpperCase();
      if (acr && !STATE.watchlist.includes(acr)) {
        const exists = STATE.marketStocks.find(s => s.acronym === acr);
        if (exists) {
          STATE.watchlist.push(acr);
          saveWatchlist();
          addLog('Added ' + acr + ' to watchlist');
        } else {
          addLog('Unknown ticker: ' + acr);
        }
      }
      renderPanel();
      return;
    }

    /* Watchlist reset */
    if (e.target.closest('.tpda-stock-watchlist-reset')) {
      STATE.watchlist = DEFAULT_WATCHLIST.slice();
      saveWatchlist();
      addLog('Watchlist reset to defaults');
      renderPanel();
      return;
    }

    /* Fetch watchlist details */
    if (e.target.closest('.tpda-stock-fetch-details')) {
      fetchWatchlistDetails();
      return;
    }

    /* Clear history */
    if (e.target.closest('.tpda-stock-clear-history')) {
      STATE.priceHistory = {};
      STATE.lastSnapshotAt = 0;
      setStorage(HISTORY_KEY, { history: {}, lastSnapshotAt: 0 });
      addLog('Price history cleared');
      renderPanel();
      return;
    }

    /* Filter checkboxes */
    const filterCb = e.target.closest('.tpda-stock-filter');
    if (filterCb) {
      const key = filterCb.dataset.filter;
      STATE.settings[key] = filterCb.checked;
      if (key === 'showOnlyOwned' && filterCb.checked) STATE.settings.showOnlyNotOwned = false;
      if (key === 'showOnlyNotOwned' && filterCb.checked) STATE.settings.showOnlyOwned = false;
      saveSettings();
      renderPanel();
      return;
    }

    /* Settings checkboxes */
    const settingCb = e.target.closest('.tpda-stock-setting');
    if (settingCb) {
      STATE.settings[settingCb.dataset.key] = settingCb.checked;
      saveSettings();
      if (settingCb.dataset.key === 'notifyEnabled' && settingCb.checked) {
        tpdaRequestNotifyPermission();
      }
      return;
    }

    /* Number setting inputs — handled on click of +/- spinner */
    const numInput = e.target.closest('.tpda-stock-num-setting');
    if (numInput) {
      const val = parseFloat(numInput.value);
      if (!isNaN(val)) {
        STATE.settings[numInput.dataset.key] = val;
        saveSettings();
        computeAllSignals();
      }
      return;
    }

    /* Sort dropdown */
    const sortSel = e.target.closest('.tpda-stock-sort');
    if (sortSel) {
      STATE.settings.sortBy = sortSel.value;
      saveSettings();
      renderPanel();
      return;
    }
  }


  /* ══════════════════════════════════════════════════════════════
   *  NOTIFICATION CHECK
   * ════════════════════════════════════════════════════════════ */

  function checkNotifications() {
    if (!STATE.settings.notifyEnabled) return;
    for (const acr of STATE.watchlist) {
      const sig = STATE.signals[acr];
      if (!sig) continue;
      const stock = STATE.marketStocks.find(s => s.acronym === acr);
      const owned = stock ? !!getUserHolding(stock.id) : false;
      const label = contextSignal(sig.signal, owned);
      if (STATE.settings.notifyOnBuy && sig.signal.includes('BUY')) {
        tpdaNotify('stock_buy_' + acr, 'Stock BUY Signal: ' + acr,
          label + ' \u2014 ' + (sig.reasons[0] || ''), 30 * 60 * 1000);
      }
      if (STATE.settings.notifyOnSell && sig.signal.includes('SELL')) {
        tpdaNotify('stock_sell_' + acr, 'Stock ' + (owned ? 'SELL' : 'AVOID') + ' Signal: ' + acr,
          label + ' \u2014 ' + (sig.reasons[0] || ''), 30 * 60 * 1000);
      }
    }
  }


  /* ══════════════════════════════════════════════════════════════
   *  INIT
   * ════════════════════════════════════════════════════════════ */

  function initApiKey(pdaKey) {
    /* Priority 1: PDA injection */
    if (pdaKey && pdaKey.length >= 16 && !pdaKey.includes('#')) {
      STATE.apiKey = pdaKey;
      STATE.apiKeySource = 'pda';
      addLog('API key from Torn PDA');
      return;
    }
    /* Priority 2: shared manual key */
    const shared = getSharedApiKey();
    if (shared) {
      STATE.apiKey = shared;
      STATE.apiKeySource = 'manual';
      addLog('API key from shared storage');
      return;
    }
    addLog('No API key — will intercept from traffic');
  }

  async function init() {
    initApiKey(PDA_INJECTED_KEY);
    loadCachedData();
    ensureStyles();
    createBubble();
    createPanel();
    window.addEventListener('resize', onResize);
    addLog('Stock Trader initialized');
    if (STATE.marketStocks.length) {
      computeAllSignals();
    }
  }

  hookFetch();
  hookXHR();
  setTimeout(init, 1200);
})();
