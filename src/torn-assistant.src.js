// ==UserScript==
// @name         Torn PDA - Safe AI Advisor Bubble
// @namespace    alex.torn.pda.safe.ai.bubble
// @version      3.2.0
// @description  Safe local Torn PDA advisor with draggable chat-head bubble and expandable panel
// @author       Alex + ChatGPT
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-assistant.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Torn PDA replaces this placeholder with the real API key at injection time.
  // Outside PDA (e.g. Tampermonkey) it stays as the literal placeholder string.
  const PDA_INJECTED_KEY = '###PDA-APIKEY###';

  const SCRIPT_KEY = 'tpda_safe_ai_bubble_v3';
  const BUBBLE_ID = 'tpda-safe-ai-bubble';
  const PANEL_ID = 'tpda-safe-ai-panel';
  const HEADER_ID = 'tpda-safe-ai-header';
  const BUBBLE_SIZE = 56;

  const STATE = {
    userData: {},
    tornData: {},
    factionData: {},
    apiKey: null,
    apiKeySource: '',
    lastSeen: {
      user: 0,
      torn: 0,
      faction: 0
    },
    ui: {
      minimized: true,
      zIndexBase: 999990,
      bubbleSize: 56
    },
    _logs: []
  };

  // #COMMON_CODE

  /* formatSeconds/formatMoney use common.js versions.
     Where 'Ready' is needed for zero cooldowns, call sites handle it. */

  const STOCK_RULES = {
    ASS: { shares: 1000000, type: 'active', frequencyDays: 7,  benefit: '1x Six Pack of Alcohol' },
    BAG: { shares: 3000000, type: 'active', frequencyDays: 7,  benefit: '1x Ammunition Pack (Special Ammo)' },
    CNC: { shares: 7500000, type: 'active', frequencyDays: 31, benefit: '$80,000,000', cashValue: 80000000 },
    EWM: { shares: 1000000, type: 'active', frequencyDays: 7,  benefit: '1x Box of Grenades' },
    ELT: { shares: 5000000, type: 'passive', benefit: '10% Home Upgrade Discount' },
    EVL: { shares: 100000,  type: 'active', frequencyDays: 7,  benefit: '1000 Happy' },
    FHG: { shares: 2000000, type: 'active', frequencyDays: 7,  benefit: '1x Feathery Hotel Coupon' },
    GRN: { shares: 500000,  type: 'active', frequencyDays: 31, benefit: '$4,000,000', cashValue: 4000000 },
    CBD: { shares: 350000,  type: 'active', frequencyDays: 7,  benefit: '50 Nerve' },
    HRG: { shares: 10000000, type: 'active', frequencyDays: 31, benefit: '1x Random Property' },
    IIL: { shares: 1000000, type: 'passive', benefit: '50% Virus Coding Time Reduction' },
    IOU: { shares: 3000000, type: 'active', frequencyDays: 31, benefit: '$12,000,000', cashValue: 12000000 },
    IST: { shares: 100000,  type: 'passive', benefit: 'Free Education Courses' },
    LAG: { shares: 750000,  type: 'active', frequencyDays: 7,  benefit: '1x Lawyer Business Card' },
    LOS: { shares: 7500000, type: 'passive', benefit: '25% Mission Credits/Money Boost' },
    LSC: { shares: 500000,  type: 'active', frequencyDays: 7,  benefit: '1x Lottery Voucher' },
    MCS: { shares: 350000,  type: 'active', frequencyDays: 7,  benefit: '100 Energy' },
    MSG: { shares: 300000,  type: 'passive', benefit: 'Free Classified Advertising' },
    MUN: { shares: 5000000, type: 'active', frequencyDays: 7,  benefit: '1x Six Pack of Energy Drink' },
    PRN: { shares: 1000000, type: 'active', frequencyDays: 7,  benefit: '1x Erotic DVD' },
    PTS: { shares: 10000000, type: 'active', frequencyDays: 7,  benefit: '100 Points' },
    SYM: { shares: 500000,  type: 'active', frequencyDays: 7,  benefit: '1x Drug Pack' },
    SYS: { shares: 3000000, type: 'passive', benefit: 'Advanced Firewall' },
    TCP: { shares: 1000000, type: 'passive', benefit: 'Company Sales Boost' },
    TCT: { shares: 100000,  type: 'active', frequencyDays: 31, benefit: '$1,000,000', cashValue: 1000000 },
    TCI: { shares: 1500000, type: 'passive', benefit: '10% Bank Interest Bonus' },
    TCC: { shares: 7500000, type: 'active', frequencyDays: 31, benefit: '1x Clothing Cache' },
    TCM: { shares: 1000000, type: 'passive', benefit: '10% Racing Skill Boost' },
    TGP: { shares: 2500000, type: 'passive', benefit: 'Company Advertising Boost' },
    THS: { shares: 150000,  type: 'active', frequencyDays: 7,  benefit: '1x Box of Medical Supplies' },
    TMI: { shares: 6000000, type: 'active', frequencyDays: 31, benefit: '$25,000,000', cashValue: 25000000 },
    TSB: { shares: 3000000, type: 'active', frequencyDays: 31, benefit: '$50,000,000', cashValue: 50000000 },
    WLT: { shares: 9000000, type: 'passive', benefit: 'Private Jet Access' },
    WSU: { shares: 1000000, type: 'passive', benefit: '10% Education Course Time Reduction' },
    YAZ: { shares: 1000000, type: 'passive', benefit: 'Free Banner Advertising' }
  };

  // ── Xanax planning constants ──
  const XAN_ENERGY = 250;        // energy per Xanax
  const XAN_DRUG_CD = 16200;     // ~4h 30m drug cooldown after Xanax

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

  function formatBar(bar) {
    if (!bar || bar.current == null) return '—';
    return formatNumber(bar.current) + ' / ' + formatNumber(bar.maximum);
  }

  async function fetchDirectData() {
    if (!STATE.apiKey) {
      addLog('fetchDirectData skipped — no API key');
      return;
    }
    addLog('Fetching direct data (source: ' + STATE.apiKeySource + ')...');
    try {
      const userUrl = `https://api.torn.com/user/?selections=bars,cooldowns,battlestats,stocks,money,profile&key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
      const userRes = await fetch(userUrl);
      addLog('User API HTTP status: ' + userRes.status);
      const userData = await userRes.json();
      if (userData && !userData.error) {
        addLog('User API keys: ' + Object.keys(userData).join(', '));
        addLog('energy type: ' + typeof userData.energy + ', value: ' + JSON.stringify(userData.energy)?.substring(0, 120));
        addLog('strength type: ' + typeof userData.strength + ', value: ' + JSON.stringify(userData.strength)?.substring(0, 60));
        addLog('money_onhand type: ' + typeof userData.money_onhand + ', value: ' + String(userData.money_onhand));
        addLog('city_bank: ' + JSON.stringify(userData.city_bank)?.substring(0, 100));
        addLog('cooldowns: ' + JSON.stringify(userData.cooldowns)?.substring(0, 120));
        addLog('stocks type: ' + typeof userData.stocks + ', keys: ' + (userData.stocks ? Object.keys(userData.stocks).slice(0, 5).join(',') : 'none'));
        mergeUserData(userData);
      } else if (userData?.error) {
        addLog('User API error: ' + (userData.error.error || JSON.stringify(userData.error)));
      } else {
        addLog('User API returned empty or null response');
      }
    } catch (e) {
      addLog('User fetch error: ' + (e.message || e));
    }

    try {
      const factionUrl = `https://api.torn.com/faction/?selections=basic&key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
      const factionRes = await fetch(factionUrl);
      const factionData = await factionRes.json();
      if (factionData && !factionData.error) {
        addLog('Faction API response received');
        mergeFactionData(factionData);
      } else if (factionData?.error) {
        addLog('Faction API error: ' + (factionData.error.error || JSON.stringify(factionData.error)));
      }
    } catch (e) {
      addLog('Faction fetch error: ' + (e.message || e));
    }

    try {
      const tornUrl = `https://api.torn.com/torn/?selections=stocks&key=${encodeURIComponent(STATE.apiKey)}&_tpda=1`;
      const tornRes = await fetch(tornUrl);
      const tornData = await tornRes.json();
      if (tornData && !tornData.error) {
        addLog('Torn stocks API received — keys: ' + (tornData.stocks ? Object.keys(tornData.stocks).slice(0, 5).join(',') : 'none'));
        mergeTornData(tornData);
      } else if (tornData?.error) {
        addLog('Torn stocks error: ' + (tornData.error.error || JSON.stringify(tornData.error)));
      }
    } catch (e) {
      addLog('Torn stocks fetch error: ' + (e.message || e));
    }
  }

  function normalizeUserStocks(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object') {
      return Object.entries(raw).map(([key, value]) => ({ stock_id: key, ...value }));
    }
    return [];
  }

  function normalizeTornStocks(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object') {
      return Object.entries(raw).map(([key, value]) => ({ stock_id: key, ...value }));
    }
    return [];
  }

  function getTicker(item) {
    return item?.acronym || item?.ticker || item?.code || item?.stock || item?.name_short || item?.short_name || '';
  }

  function getOwnedShares(item) {
    return Number(item?.shares_owned ?? item?.shares ?? item?.total_shares ?? item?.amount ?? item?.owned ?? 0);
  }

  function getCurrentPrice(item) {
    return Number(item?.current_price ?? item?.price ?? item?.share_price ?? item?.cost ?? item?.stock_price ?? 0);
  }

  function getBenefitProgressDays(item) {
    return Number(item?.benefit_progress ?? item?.progress ?? item?.days_held ?? item?.days_invested ?? 0);
  }

  function getSelectionsPresent(data) {
    const keys = [];
    if (data.bars || data.energy) keys.push('bars');
    if (data.cooldowns) keys.push('cooldowns');
    if (data.battlestats || data.strength !== undefined) keys.push('battlestats');
    if (data.stocks) keys.push('stocks');
    if (data.money || data.money_onhand !== undefined) keys.push('money');
    if (data.profile || data.basic || data.name) keys.push('profile/basic');
    return keys;
  }

  function evaluateHappyJump(user) {
    const bars = user?.bars || {};
    const cds = user?.cooldowns || {};

    const eCur = Number(bars.energy?.current || 0);
    const eMax = Number(bars.energy?.maximum || 0);
    const drugCd = Number(cds.drug || 0);
    const boosterCd = Number(cds.booster || 0);

    if (eMax <= 0) {
      return {
        ready: false,
        label: 'No data yet',
        notes: ['No cached user API response detected yet']
      };
    }

    const TARGET = 1000;
    const notes = [];

    // Status checks
    notes.push(`Energy: ${formatNumber(eCur)} / ${formatNumber(eMax)}`);
    notes.push(drugCd > 0 ? `Drug CD: ${formatSeconds(drugCd)}` : 'Drug CD: Ready');
    notes.push(boosterCd > 0 ? `Booster CD: ${formatSeconds(boosterCd)}` : 'Booster CD: Ready');

    if (eCur >= TARGET) {
      return {
        ready: true,
        label: `Ready! Energy is ${formatNumber(eCur)} (>= ${formatNumber(TARGET)})`,
        notes
      };
    }

    // Calculate Xanax plan
    const deficit = TARGET - eCur;
    const xanNeeded = Math.ceil(deficit / XAN_ENERGY);
    let totalWait = 0;

    if (drugCd > 0) totalWait += drugCd;
    if (xanNeeded > 1) totalWait += (xanNeeded - 1) * XAN_DRUG_CD;

    notes.push('');
    notes.push(`Deficit: ${formatNumber(deficit)}E \u2192 need ${xanNeeded} Xanax`);
    if (drugCd > 0) {
      notes.push(`Wait ${formatSeconds(drugCd)} for current drug CD before first Xanax`);
    }
    for (let i = 1; i <= xanNeeded; i++) {
      const eBefore = eCur + (i - 1) * XAN_ENERGY;
      const eAfter = Math.min(eCur + i * XAN_ENERGY, eCur + xanNeeded * XAN_ENERGY);
      notes.push(`Xanax #${i}: ${formatNumber(Math.round(eBefore))}E \u2192 ${formatNumber(Math.round(eAfter))}E`);
      if (i < xanNeeded) {
        notes.push(`  \u2514 Wait ${formatSeconds(XAN_DRUG_CD)} drug CD`);
      }
    }
    notes.push('');
    notes.push(totalWait > 0
      ? `Total time to ${formatNumber(TARGET)}E: ${formatSeconds(totalWait)}`
      : `Take ${xanNeeded} Xanax now to reach ${formatNumber(TARGET)}E!`);

    const ready = totalWait === 0;
    const label = ready
      ? `Take ${xanNeeded} Xanax now!`
      : `${xanNeeded} Xanax needed (${formatSeconds(totalWait)} wait)`;

    return { ready, label, notes, xanNeeded, totalWait };
  }

  function buildStockRoiRows(userStocks, tornStocks) {
    const marketByTicker = new Map();
    const idToMarket = new Map();
    for (const s of tornStocks) {
      const ticker = getTicker(s);
      if (ticker) marketByTicker.set(ticker, s);
      const id = String(s.stock_id ?? s.id ?? '');
      if (id) idToMarket.set(id, s);
    }

    const rows = [];

    for (const s of userStocks) {
      let ticker = getTicker(s);
      // If no ticker on user stock, look it up from market data by stock_id
      if (!ticker) {
        const id = String(s.stock_id ?? s.id ?? '');
        const market = idToMarket.get(id);
        if (market) ticker = getTicker(market);
      }
      const rule = STOCK_RULES[ticker];
      if (!ticker || !rule) continue;

      const owned = getOwnedShares(s);
      const incrementsOwned = Math.floor(owned / rule.shares);
      const nextTargetShares = (incrementsOwned + 1) * rule.shares;
      const missingShares = Math.max(0, nextTargetShares - owned);

      const market = marketByTicker.get(ticker) || {};
      const livePrice = getCurrentPrice(s) || getCurrentPrice(market) || 0;
      const toNextCost = missingShares * livePrice;

      let payoutPerCycle = null;
      let payoutPerDay = null;
      let paybackDays = null;

      if (rule.type === 'active' && rule.cashValue && rule.frequencyDays) {
        payoutPerCycle = rule.cashValue;
        payoutPerDay = payoutPerCycle / rule.frequencyDays;
        if (toNextCost > 0 && payoutPerDay > 0) {
          paybackDays = toNextCost / payoutPerDay;
        }
      }

      rows.push({
        ticker,
        type: rule.type,
        benefit: rule.benefit,
        owned,
        nextTargetShares,
        missingShares,
        toNextCost,
        payoutPerDay,
        paybackDays
      });
    }

    rows.sort((a, b) => {
      const aMissing = a.missingShares / Math.max(1, STOCK_RULES[a.ticker]?.shares || 1);
      const bMissing = b.missingShares / Math.max(1, STOCK_RULES[b.ticker]?.shares || 1);
      return aMissing - bMissing;
    });

    return rows;
  }

  function buildAdvice(userStocks, tornStocks, user) {
    const out = [];
    const bars = user.bars || {};
    const cds = user.cooldowns || {};

    const eCur = Number(bars.energy?.current || 0);
    const eMax = Number(bars.energy?.maximum || 0);
    const nCur = Number(bars.nerve?.current || 0);
    const nMax = Number(bars.nerve?.maximum || 0);
    const hCur = Number(bars.happy?.current || 0);
    const drugCd = Number(cds.drug || 0);
    const boosterCd = Number(cds.booster || 0);
    const medCd = Number(cds.medical || 0);

    if (!getSelectionsPresent(user).length) {
      out.push('No user data cached yet. Open a normal Torn PDA page that loads your stats, then refresh.');
      return out;
    }

    if (eMax > 0 && eCur >= eMax) out.push('Your energy is capped. Use energy soon so you do not waste regeneration.');
    else if (eMax > 0 && eCur >= Math.floor(eMax * 0.9)) out.push('Your energy is close to cap. Plan your next gym session soon.');

    if (nMax > 0 && nCur >= nMax) out.push('Your nerve is capped. Use it soon to avoid wasting regeneration.');

    if (drugCd <= 0 && boosterCd <= 0 && hCur > 0 && eCur < Math.max(150, eMax * 0.4)) {
      out.push('Drug and booster cooldowns are both ready, and your energy is not too high. This looks like a reasonable setup window.');
    }

    if (medCd > 0) out.push(`Medical cooldown is active for ${formatSeconds(medCd)}.`);

    if (!userStocks.length) {
      out.push('No user stock data cached yet. Open the Stock Market page in Torn PDA and then refresh this panel.');
      return out;
    }

    const roiRows = buildStockRoiRows(userStocks, tornStocks);

    const nearBlock = roiRows.filter(r => r.missingShares > 0).slice(0, 3);
    if (nearBlock.length) {
      out.push(
        'Closest next stock blocks: ' +
        nearBlock.map(r => `${r.ticker} (${formatNumber(r.missingShares)} shares short${r.toNextCost ? `, est. ${formatMoney(r.toNextCost)}` : ''})`).join(' | ')
      );
    }

    const cashRoi = roiRows.filter(r => Number.isFinite(r.paybackDays)).sort((a, b) => a.paybackDays - b.paybackDays).slice(0, 3);
    if (cashRoi.length) {
      out.push(
        'Fastest rough cash payback: ' +
        cashRoi.map(r => `${r.ticker} (~${Math.ceil(r.paybackDays)} days)`).join(' | ')
      );
    }

    out.push('This assistant is advisory only. It does not click, trade, or automate gameplay actions.');
    return out;
  }

  function ensureStyles() {
    if (document.getElementById(`${SCRIPT_KEY}_style`)) return;
    const style = document.createElement('style');
    style.id = `${SCRIPT_KEY}_style`;
    style.textContent = `
      #${BUBBLE_ID} {
        position: fixed;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #2a6df4, #1745a8);
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
        width: 360px;
        max-width: 95vw;
        max-height: 70vh;
        background: rgba(15,15,18,0.96);
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
    `;
    document.head.appendChild(style);
  }

  function applyBubblePosition(pos) {
    const bubble = getBubbleEl();
    if (!bubble) return;

    bubble.style.left = '';
    bubble.style.top = '';
    bubble.style.right = `${pos.right}px`;
    bubble.style.bottom = `${pos.bottom}px`;
  }

  function createBubble() {
    if (getBubbleEl()) return;

    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.dataset.tpdaBubble = '1';
    bubble.innerHTML = 'AI';
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

  function onPanelExpand() {
    addLog('Panel expanding — userData keys: ' + Object.keys(STATE.userData || {}).join(', '));
    renderPanel();
    fetchDirectData().then(renderPanel);
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
          <div style="font-weight:bold;">Torn AI Assistant</div>
          <div style="font-size:11px;color:#bbb;">Local-only advisor • no token extraction</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="tpda-ai-refresh" style="background:#2a6df4;color:white;border:none;border-radius:8px;padding:6px 10px;">Refresh</button>
          <button id="tpda-ai-collapse" style="background:#444;color:white;border:none;border-radius:8px;padding:6px 10px;">○</button>
        </div>
      </div>
      <div id="tpda-ai-body" style="padding:12px;overflow-y:auto;max-height:60vh;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('tpda-ai-refresh').addEventListener('click', async () => {
      await fetchDirectData();
      renderPanel();
    });
    document.getElementById('tpda-ai-collapse').addEventListener('click', collapseToBubble);

    const aiBody = document.getElementById('tpda-ai-body');
    aiBody.addEventListener('click', (e) => {
      if (handleApiKeyClick(e, aiBody, async () => { await fetchDirectData(); renderPanel(); })) return;
      handleLogClick(e, aiBody);
    });

    makeDraggablePanel(panel, document.getElementById(HEADER_ID));
  }

  // ── Energy constants for drug-free planning ──
  const ENERGY_REGEN_PER_MIN = 0.5;   // default: 5E per 10 min
  const ENERGY_CAN_BOOST = 25;         // each energy can gives +25E (over cap)
  const ENERGY_TARGET = 1000;

  function evaluateDrugFreeEnergyPlan(user) {
    const bars = user?.bars || {};
    const cds = user?.cooldowns || {};

    const eCur = Number(bars.energy?.current || 0);
    const eMax = Number(bars.energy?.maximum || 0);
    const hCur = Number(bars.happy?.current || 0);
    const hMax = Number(bars.happy?.maximum || 0);
    const boosterCd = Number(cds.booster || 0);

    if (eMax <= 0) {
      return {
        ready: false,
        message: 'No energy data cached yet.',
        steps: [],
        totalMinutes: null,
        cansNeeded: 0
      };
    }

    const steps = [];
    let timeMinutes = 0;

    // Step 1: Wait for booster cooldown
    if (boosterCd > 0) {
      const boosterMins = Math.ceil(boosterCd / 60);
      steps.push({
        label: 'Wait for booster cooldown',
        detail: `${formatSeconds(boosterCd)} remaining`,
        minutes: boosterMins
      });
      timeMinutes += boosterMins;
    } else {
      steps.push({
        label: 'Booster cooldown',
        detail: 'Ready now',
        minutes: 0
      });
    }

    // Step 2: Natural regen to cap (if not already at cap)
    const energyAtBoosterReady = Math.min(eMax, eCur + (timeMinutes * ENERGY_REGEN_PER_MIN));
    if (energyAtBoosterReady < eMax) {
      const regenMins = Math.ceil((eMax - energyAtBoosterReady) / ENERGY_REGEN_PER_MIN);
      steps.push({
        label: 'Wait for energy to reach cap',
        detail: `${formatNumber(Math.round(energyAtBoosterReady))}E → ${formatNumber(eMax)}E (~${regenMins} min)`,
        minutes: regenMins
      });
      timeMinutes += regenMins;
    } else {
      steps.push({
        label: 'Energy at cap',
        detail: `${formatNumber(eMax)}E`,
        minutes: 0
      });
    }

    // Step 3: Use energy cans/drinks to go from cap to target
    const cansNeeded = eMax >= ENERGY_TARGET ? 0 : Math.ceil((ENERGY_TARGET - eMax) / ENERGY_CAN_BOOST);
    if (cansNeeded > 0) {
      steps.push({
        label: `Use ${cansNeeded} energy cans (+${ENERGY_CAN_BOOST}E each)`,
        detail: `${formatNumber(eMax)}E → ${formatNumber(eMax + cansNeeded * ENERGY_CAN_BOOST)}E (uses booster cooldown per can)`,
        minutes: 0
      });
    } else {
      steps.push({
        label: 'Energy cap already meets target',
        detail: `${formatNumber(eMax)}E >= ${formatNumber(ENERGY_TARGET)}E target`,
        minutes: 0
      });
    }

    // Step 4: Happy boost via booster (needs booster CD ready)
    const happyNote = hMax > 0
      ? `Current: ${formatNumber(hCur)} / ${formatNumber(hMax)} — use Lollipops, Candy, etc. to spike before training`
      : 'No happy data cached yet';
    steps.push({
      label: 'Boost happy with boosters',
      detail: happyNote,
      minutes: 0
    });

    const ready = boosterCd <= 0 && eCur >= eMax * 0.8;
    const readyLabel = ready
      ? 'Close to ready — booster CD is clear and energy is high'
      : `Estimated ${formatSeconds(timeMinutes * 60)} until setup window`;

    return {
      ready,
      message: readyLabel,
      steps,
      totalMinutes: timeMinutes,
      cansNeeded,
      currentEnergy: eCur,
      maxEnergy: eMax,
      boosterCd
    };
  }

  function evaluateWarTiming(factionData) {
    const result = {
      hasWarData: false,
      wars: [],
      nextWarLabel: 'No war data detected'
    };

    // Try ranked_wars
    const rankedWars = factionData?.ranked_wars || factionData?.rankedwars || {};
    for (const [id, war] of Object.entries(rankedWars)) {
      const start = Number(war?.war?.start || war?.start || 0);
      const end = Number(war?.war?.end || war?.end || 0);
      const now = Math.floor(Date.now() / 1000);

      if (start > 0) {
        result.hasWarData = true;
        const remaining = start - now;
        if (remaining > 0) {
          result.wars.push({
            type: 'Ranked War',
            id,
            startsIn: remaining,
            label: `Starts in ${formatSeconds(remaining)}`,
            wallTime: new Date(start * 1000).toLocaleString()
          });
        } else if (end === 0 || end > now) {
          result.wars.push({
            type: 'Ranked War',
            id,
            startsIn: 0,
            label: 'In progress',
            wallTime: new Date(start * 1000).toLocaleString()
          });
        }
      }
    }

    // Try territory / chain wars
    const territoryWars = factionData?.territory_wars || factionData?.territory || {};
    for (const [id, war] of Object.entries(territoryWars)) {
      const start = Number(war?.start || war?.time_started || 0);
      const end = Number(war?.end || war?.time_ended || 0);
      const now = Math.floor(Date.now() / 1000);

      if (start > 0) {
        result.hasWarData = true;
        const remaining = start - now;
        if (remaining > 0) {
          result.wars.push({
            type: 'Territory War',
            id,
            startsIn: remaining,
            label: `Starts in ${formatSeconds(remaining)}`,
            wallTime: new Date(start * 1000).toLocaleString()
          });
        } else if (end === 0 || end > now) {
          result.wars.push({
            type: 'Territory War',
            id,
            startsIn: 0,
            label: 'In progress',
            wallTime: new Date(start * 1000).toLocaleString()
          });
        }
      }
    }

    // Try generic war/wars field
    const wars = factionData?.wars || factionData?.war || {};
    if (typeof wars === 'object' && !Array.isArray(wars)) {
      for (const [id, war] of Object.entries(wars)) {
        const start = Number(war?.start || war?.time_started || war?.war_start || 0);
        const end = Number(war?.end || war?.time_ended || war?.war_end || 0);
        const now = Math.floor(Date.now() / 1000);

        if (start > 0 && !result.wars.some(w => w.id === id)) {
          result.hasWarData = true;
          const remaining = start - now;
          if (remaining > 0) {
            result.wars.push({
              type: 'War',
              id,
              startsIn: remaining,
              label: `Starts in ${formatSeconds(remaining)}`,
              wallTime: new Date(start * 1000).toLocaleString()
            });
          } else if (end === 0 || end > now) {
            result.wars.push({
              type: 'War',
              id,
              startsIn: 0,
              label: 'In progress',
              wallTime: new Date(start * 1000).toLocaleString()
            });
          }
        }
      }
    }

    result.wars.sort((a, b) => a.startsIn - b.startsIn);

    if (result.wars.length) {
      const next = result.wars[0];
      result.nextWarLabel = next.startsIn > 0
        ? `Next: ${next.type} starts in ${formatSeconds(next.startsIn)} (${next.wallTime})`
        : `${next.type} is currently in progress (started ${next.wallTime})`;
    }

    return result;
  }

  function evaluateBoosterWarAlignment(user, factionData) {
    const cds = user?.cooldowns || {};
    const boosterCd = Number(cds.booster || 0);
    const warInfo = evaluateWarTiming(factionData);

    const notes = [];

    if (!warInfo.hasWarData) {
      notes.push('No war data available — visit your faction page to cache it.');
      return { notes, warInfo, boosterCd, aligned: false };
    }

    const nextWar = warInfo.wars[0];
    if (!nextWar) {
      notes.push('No upcoming or active wars detected.');
      return { notes, warInfo, boosterCd, aligned: false };
    }

    if (nextWar.startsIn === 0) {
      // War in progress
      if (boosterCd <= 0) {
        notes.push('War is active and booster cooldown is ready — good to go.');
        return { notes, warInfo, boosterCd, aligned: true };
      } else {
        notes.push(`War is active but booster cooldown has ${formatSeconds(boosterCd)} left.`);
        return { notes, warInfo, boosterCd, aligned: false };
      }
    }

    // War upcoming
    if (boosterCd <= 0) {
      notes.push(`Booster cooldown is ready. War starts in ${formatSeconds(nextWar.startsIn)}.`);
      notes.push('You can use boosters now, or save them closer to war start.');
      return { notes, warInfo, boosterCd, aligned: true };
    }

    if (boosterCd <= nextWar.startsIn) {
      const buffer = nextWar.startsIn - boosterCd;
      notes.push(`Booster cooldown clears ${formatSeconds(buffer)} before war starts — aligned.`);
      return { notes, warInfo, boosterCd, aligned: true };
    }

    const overshoot = boosterCd - nextWar.startsIn;
    notes.push(`Booster cooldown clears ${formatSeconds(overshoot)} AFTER war starts — you will be late.`);
    notes.push('Consider whether you can clear cooldown earlier or plan around it.');
    return { notes, warInfo, boosterCd, aligned: false };
  }

  function renderDrugFreeEnergyCard(user) {
    const plan = evaluateDrugFreeEnergyPlan(user);

    const stepsHtml = plan.steps.map((s, i) => `
      <div style="padding:6px 0;${i ? 'border-top:1px solid #2a2d38;' : ''}">
        <div><strong>Step ${i + 1}:</strong> ${escapeHtml(s.label)}</div>
        <div style="font-size:12px;color:#bbb;">${escapeHtml(s.detail)}${s.minutes > 0 ? ` (~${s.minutes} min)` : ''}</div>
      </div>
    `).join('');

    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Drug-Free Energy Plan (Target: ${formatNumber(ENERGY_TARGET)}E)</div>
        <div style="margin-bottom:8px;color:${plan.ready ? '#8dff8d' : '#ffd166'};">
          ${escapeHtml(plan.message)}
        </div>
        <div style="font-size:12px;color:#bbb;margin-bottom:6px;">
          Reach ${formatNumber(ENERGY_TARGET)} energy using natural regen + energy cans (no Xanax). Assumes ${ENERGY_REGEN_PER_MIN * 10}E per 10 min regen rate.
        </div>
        ${stepsHtml}
        ${plan.cansNeeded > 0 ? `<div style="margin-top:6px;font-size:12px;color:#bbb;">Total energy cans needed: <strong>${plan.cansNeeded}</strong></div>` : ''}
      </div>
    `;
  }

  function renderWarTimingCard(user, factionData) {
    const alignment = evaluateBoosterWarAlignment(user, factionData);
    const warInfo = alignment.warInfo;

    // Energy readiness for war
    const bars = user?.bars || {};
    const cds = user?.cooldowns || {};
    const eCur = Number(bars.energy?.current || 0);
    const eMax = Number(bars.energy?.maximum || 0);
    const drugCd = Number(cds.drug || 0);
    const TARGET = 1000;

    let energyHtml = '';
    if (eMax <= 0) {
      energyHtml = '<div style="color:#bbb;">No energy data yet</div>';
    } else if (eCur >= TARGET) {
      energyHtml = `<div style="color:#8dff8d;">Energy: ${formatNumber(eCur)} — Ready for war!</div>`;
    } else {
      const deficit = TARGET - eCur;
      const xanNeeded = Math.ceil(deficit / XAN_ENERGY);
      let totalWait = drugCd > 0 ? drugCd : 0;
      if (xanNeeded > 1) totalWait += (xanNeeded - 1) * XAN_DRUG_CD;

      const nextWar = warInfo.wars[0];
      let timeNote = '';
      if (nextWar && nextWar.startsIn > 0) {
        if (totalWait < nextWar.startsIn) {
          timeNote = ` — ready ${formatSeconds(nextWar.startsIn - totalWait)} before war`;
        } else {
          timeNote = ` — NOT ready in time! (${formatSeconds(totalWait - nextWar.startsIn)} late)`;
        }
      }

      const color = (nextWar && nextWar.startsIn > 0 && totalWait < nextWar.startsIn) ? '#ffd166' : '#ff6b6b';
      energyHtml = `<div style="color:${color};">Energy: ${formatNumber(eCur)} — need ${xanNeeded} Xanax (${formatSeconds(totalWait)} wait)${timeNote}</div>`;
    }

    let warsHtml = '';
    if (warInfo.wars.length) {
      warsHtml = warInfo.wars.map(w => `
        <div style="padding:4px 0;">
          <div>${escapeHtml(w.type)}: <strong>${escapeHtml(w.label)}</strong></div>
          <div style="font-size:12px;color:#bbb;">Started / starts: ${escapeHtml(w.wallTime)}</div>
        </div>
      `).join('');
    }

    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">War Timing & Energy Readiness</div>
        ${energyHtml}
        <div style="margin-bottom:6px;">Booster CD: <strong>${alignment.boosterCd <= 0 ? 'Ready' : formatSeconds(alignment.boosterCd)}</strong></div>
        ${warsHtml || '<div style="color:#bbb;">No wars detected. Visit your faction page to cache war data.</div>'}
        <div style="margin-top:8px;padding-top:6px;border-top:1px solid #2a2d38;">
          <div style="font-weight:bold;margin-bottom:4px;">Booster Alignment</div>
          ${alignment.notes.map(n => `<div style="color:${alignment.aligned ? '#8dff8d' : '#ffd166'};">• ${escapeHtml(n)}</div>`).join('')}
        </div>
      </div>
    `;
  }

  function renderHappyJumpCard(user) {
    const hj = evaluateHappyJump(user);
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Happy Jump — Xanax Planner</div>
        <div style="color:${hj.ready ? '#8dff8d' : '#ffd166'};margin-bottom:6px;">
          ${escapeHtml(hj.label)}
        </div>
        <div style="font-size:12px;color:#bbb;">
          ${hj.notes.map(n => n === '' ? '<div style="height:4px;"></div>' : `<div>\u2022 ${escapeHtml(n)}</div>`).join('')}
        </div>
        <div style="margin-top:6px;font-size:11px;color:#666;">
          Assumes ${XAN_ENERGY}E per Xanax, ~${formatSeconds(XAN_DRUG_CD)} drug CD per use.
        </div>
      </div>
    `;
  }

  function renderStockRoiCard(userStocks, tornStocks) {
    const rows = buildStockRoiRows(userStocks, tornStocks).slice(0, 5);

    if (!rows.length) {
      return `
        <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
          <div style="font-weight:bold;margin-bottom:6px;">Stock Block ROI Helper</div>
          <div>No stock holdings are cached yet. Open the stock market in Torn PDA once.</div>
        </div>
      `;
    }

    const body = rows.map(r => {
      const costText = r.toNextCost ? formatMoney(r.toNextCost) : 'unknown';
      const paybackText = Number.isFinite(r.paybackDays) ? `${Math.ceil(r.paybackDays)}d` : 'n/a';
      const dayText = r.payoutPerDay ? `${formatMoney(Math.round(r.payoutPerDay))}/day` : 'n/a';

      return `
        <div style="padding:8px 0;border-top:1px solid #2a2d38;">
          <div><strong>${escapeHtml(r.ticker)}</strong> • ${escapeHtml(r.type)} • ${escapeHtml(r.benefit)}</div>
          <div>Owned: ${formatNumber(r.owned)} / next block: ${formatNumber(r.nextTargetShares)}</div>
          <div>Missing: ${formatNumber(r.missingShares)} shares</div>
          <div>Est. next block cost: ${costText}</div>
          <div>Cash ROI: ${dayText} • payback ${paybackText}</div>
        </div>
      `;
    }).join('');

    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Stock Block ROI Helper</div>
        <div style="font-size:12px;color:#bbb;margin-bottom:6px;">
          ROI is rough. It only estimates cash-returning blocks directly and ignores future price movement.
        </div>
        ${body}
      </div>
    `;
  }

  function renderPanel() {
    const body = document.getElementById('tpda-ai-body');
    if (!body) return;

    const user = STATE.userData || {};
    const torn = STATE.tornData || {};
    const faction = STATE.factionData || {};
    const bars = user.bars || {};
    const cds = user.cooldowns || {};
    const battlestats = user.battlestats || {};
    const money = user.money || {};
    const userStocks = normalizeUserStocks(user.stocks);
    const tornStocks = normalizeTornStocks(torn.stocks);
    const advice = buildAdvice(userStocks, tornStocks, user);

    body.innerHTML = `
      <div style="margin-bottom:8px;color:#bbb;">
        User data seen: ${ageText(STATE.lastSeen.user)}<br>
        Market data seen: ${ageText(STATE.lastSeen.torn)}<br>
        Faction data seen: ${ageText(STATE.lastSeen.faction)}<br>
        API key: ${STATE.apiKey ? `Active (${escapeHtml(STATE.apiKeySource)})` : 'Not set'}
      </div>

      ${renderApiKeyCard()}

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Status</div>
        <div>Selections cached: ${getSelectionsPresent(user).join(', ') || 'none yet'}</div>
        <div>Energy: ${formatBar(bars.energy)}${bars.energy?.fulltime > 0 ? ` (full in ${formatSeconds(bars.energy.fulltime)})` : bars.energy?.current != null && bars.energy.current >= bars.energy.maximum ? ' (Full)' : ''}</div>
        <div>Nerve: ${formatBar(bars.nerve)}${bars.nerve?.fulltime > 0 ? ` (full in ${formatSeconds(bars.nerve.fulltime)})` : bars.nerve?.current != null && bars.nerve.current >= bars.nerve.maximum ? ' (Full)' : ''}</div>
        <div>Happy: ${formatBar(bars.happy)}</div>
        <div>Drug CD: ${cds.drug > 0 ? formatSeconds(cds.drug) : 'Ready'}</div>
        <div>Booster CD: ${cds.booster > 0 ? formatSeconds(cds.booster) : 'Ready'}</div>
        <div>Medical CD: ${cds.medical > 0 ? formatSeconds(cds.medical) : 'Ready'}</div>
      </div>

      ${renderWarTimingCard(user, faction)}

      ${renderHappyJumpCard(user)}

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Battle stats</div>
        <div>STR: ${battlestats.strength != null ? formatNumber(battlestats.strength) : '—'}</div>
        <div>SPD: ${battlestats.speed != null ? formatNumber(battlestats.speed) : '—'}</div>
        <div>DEX: ${battlestats.dexterity != null ? formatNumber(battlestats.dexterity) : '—'}</div>
        <div>DEF: ${battlestats.defense != null ? formatNumber(battlestats.defense) : '—'}</div>
        <div style="border-top:1px solid #2a2d38;margin-top:4px;padding-top:4px;font-weight:bold;">Total: ${battlestats.total != null ? formatNumber(battlestats.total) : '—'}</div>
      </div>

      ${renderStockRoiCard(userStocks, tornStocks)}

      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#191b22;">
        <div style="font-weight:bold;margin-bottom:6px;">Funds seen</div>
        <div>Cash on hand: ${money.cash_on_hand != null ? formatMoney(money.cash_on_hand) : '—'}</div>
        <div>City Bank: ${money.city_bank != null ? formatMoney(money.city_bank) : '—'}</div>
        <div>Vault: ${money.vault != null ? formatMoney(money.vault) : '—'}</div>
        <div>Cayman: ${money.cayman != null ? formatMoney(money.cayman) : '—'}</div>
      </div>

      <div style="padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div style="font-weight:bold;margin-bottom:8px;">Advice</div>
        ${advice.map(x => `<div style="margin-bottom:8px;">• ${escapeHtml(x)}</div>`).join('')}
      </div>

      ${renderLogCard()}
    `;
  }

  // Helper: extract a bar value that's an object with {current, maximum}.
  // Accepts the object directly or a plain number (converts to {current: n, maximum: n}).
  function asBar(v) {
    if (isObject(v) && v.current != null) return v;
    if (typeof v === 'number' && isFinite(v)) return { current: v, maximum: v };
    return null;
  }

  // Helper: extract a numeric stat value. V1 returns plain numbers, V2 returns {value: X}.
  function asStatNum(v) {
    if (typeof v === 'number') return v;
    if (isObject(v) && v.value != null) return Number(v.value);
    return undefined;
  }

  function mergeUserData(data) {
    STATE.userData = deepMerge(STATE.userData, data);

    // Normalize: Torn API v1 returns bars/stats/money at top level.
    // Torn API v2 and Torn PDA intercepted calls may nest them differently.
    // Handle both formats so the rendering code always finds the data.
    const u = STATE.userData;

    // --- Bars normalization ---
    // V1: energy/nerve/happy/life as {current, maximum, ...} at top level
    // V2/PDA: may already be under u.bars, or under u.profile
    if (!u.bars) u.bars = {};
    const barNames = ['energy', 'nerve', 'happy', 'life'];
    for (const name of barNames) {
      // Priority 1: top-level bar object (V1 format)
      const topLevel = asBar(u[name]);
      if (topLevel) { u.bars[name] = topLevel; continue; }
      // Priority 2: already under bars (V2 or previous merge)
      if (asBar(u.bars[name])) continue;
      // Priority 3: under profile (V2 profile selection nests life)
      const fromProfile = asBar(u.profile?.[name]);
      if (fromProfile) u.bars[name] = fromProfile;
    }

    // --- Battle stats normalization ---
    // V1: strength/speed/dexterity/defense as plain numbers at top level
    // V2: nested under battlestats as {value: X} objects
    if (!u.battlestats) u.battlestats = {};
    const statNames = ['strength', 'speed', 'dexterity', 'defense'];
    for (const name of statNames) {
      // Priority 1: top-level plain number (V1 format)
      const topVal = asStatNum(u[name]);
      if (topVal !== undefined) { u.battlestats[name] = topVal; continue; }
      // Priority 2: already under battlestats (V2 may have {value:X} objects)
      const nested = asStatNum(u.battlestats[name]);
      if (nested !== undefined) { u.battlestats[name] = nested; continue; }
    }
    // V2 may provide a total field
    if (u.battlestats.total == null) {
      const total = statNames.reduce((s, n) => {
        const v = asStatNum(u.battlestats[n]);
        return v !== undefined ? s + v : s;
      }, 0);
      if (total > 0) u.battlestats.total = total;
    }

    // --- Money normalization ---
    // V1: money_onhand / vault_amount / city_bank / cayman_bank at top level
    // V2: nested under money.wallet / money.cayman_bank / money.city_bank
    if (!isObject(u.money)) u.money = {};
    if (u.money_onhand != null) u.money.cash_on_hand = Number(u.money_onhand);
    else if (u.money.wallet != null) u.money.cash_on_hand = Number(u.money.wallet);
    // City bank
    if (isObject(u.city_bank) && u.city_bank.amount != null) u.money.city_bank = Number(u.city_bank.amount);
    else if (isObject(u.money.city_bank) && u.money.city_bank.amount != null) u.money.city_bank = Number(u.money.city_bank.amount);
    // Vault
    if (u.vault_amount != null) u.money.vault = Number(u.vault_amount);
    else if (u.money.vault != null && typeof u.money.vault === 'number') u.money.vault = u.money.vault;
    // Cayman
    if (u.cayman_bank != null && !isObject(u.cayman_bank)) u.money.cayman = Number(u.cayman_bank);
    else if (u.money.cayman_bank != null && !isObject(u.money.cayman_bank)) u.money.cayman = Number(u.money.cayman_bank);

    // --- Diagnostic logging ---
    const eC = u.bars?.energy?.current;
    const eM = u.bars?.energy?.maximum;
    addLog('Merge done — bars.energy: ' + (eC != null ? eC + '/' + eM : 'MISSING') +
           ', strength: ' + (u.battlestats?.strength ?? 'n/a') +
           ', cash: ' + (u.money?.cash_on_hand ?? 'n/a') +
           ', city_bank: ' + (u.money?.city_bank ?? 'n/a') +
           ', vault: ' + (u.money?.vault ?? 'n/a'));
    if (!u.bars?.energy || u.bars.energy.current == null) {
      addLog('WARNING: bars.energy is ' + JSON.stringify(u.bars?.energy) +
             ', raw u.energy is ' + JSON.stringify(u.energy)?.substring(0, 100) +
             ', profile.energy is ' + JSON.stringify(u.profile?.energy)?.substring(0, 100));
    }
    STATE.lastSeen.user = nowTs();
    if (!STATE.ui.minimized) renderPanel();
  }

  function mergeTornData(data) {
    STATE.tornData = deepMerge(STATE.tornData, data);
    STATE.lastSeen.torn = nowTs();
    if (!STATE.ui.minimized) renderPanel();
  }

  function mergeFactionData(data) {
    STATE.factionData = deepMerge(STATE.factionData, data);
    STATE.lastSeen.faction = nowTs();
    if (!STATE.ui.minimized) renderPanel();
  }

  function handleApiPayload(url, data) {
    if (!data || data.error) return;
    if (typeof url !== 'string') return;

    if (url.includes('api.torn.com/user')) {
      mergeUserData(data);
    } else if (url.includes('api.torn.com/faction')) {
      mergeFactionData(data);
    } else if (url.includes('api.torn.com/torn')) {
      mergeTornData(data);
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
          extractApiKeyFromUrl(url);
          // Skip our own calls (marked with _tpda=1) to avoid double-processing
          if (!url.includes('_tpda=1')) {
            const clone = response.clone();
            const contentType = clone.headers.get('content-type') || '';
            if (contentType.includes('application/json') || contentType.includes('text/plain')) {
              const text = await clone.text();
              const data = safeJsonParse(text);
              handleApiPayload(url, data);
            }
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
      try {
        if (String(url || '').includes('api.torn.com/')) {
          extractApiKeyFromUrl(String(url));
        }
      } catch {}
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          const url = String(this.__tpda_url || '');
          if (!url.includes('api.torn.com/')) return;
          // Skip our own calls (marked with _tpda=1) to avoid double-processing
          if (url.includes('_tpda=1')) return;
          const text = this.responseText;
          const data = safeJsonParse(text);
          handleApiPayload(url, data);
        } catch (_) {}
      });

      return origSend.apply(this, args);
    };
  }

  function init() {
    initApiKey(PDA_INJECTED_KEY);
    addLog('AI Advisor initialized' + (STATE.apiKey ? '' : ' — waiting for API key'));

    ensureStyles();
    createBubble();
    createPanel();
    window.addEventListener('resize', onResize);

    if (STATE.apiKey) {
      addLog('Initial fetch starting (key source: ' + STATE.apiKeySource + ', key length: ' + STATE.apiKey.length + ')');
      fetchDirectData();
    } else {
      addLog('No API key at init — will rely on network interception');
    }

    console.log('[Torn AI Assistant] Bubble mode started.');
  }

  // Install network hooks immediately so we capture API calls made before init runs
  hookFetch();
  hookXHR();

  setTimeout(init, 1200);
})();
