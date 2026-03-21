# AGENTS.md — Developer Reference for Torn Dark Tools

This file contains everything an AI agent (or human developer) needs to understand, modify, and extend the scripts in this repository. It covers project architecture, Torn PDA internals, Torn game policies, coding conventions, and verification steps.

---

## Table of Contents

1. [Repository Overview](#repository-overview)
2. [Torn PDA Internals](#torn-pda-internals)
3. [Torn Game Rules & Policy](#torn-game-rules--policy)
4. [API Key Policy](#api-key-policy)
5. [Script Architecture](#script-architecture)
6. [Per-Script Reference](#per-script-reference)
7. [Coding Conventions](#coding-conventions)
8. [Adding a New Script](#adding-a-new-script)
9. [Adding a New Feature to an Existing Script](#adding-a-new-feature-to-an-existing-script)
10. [Common Pitfalls](#common-pitfalls)
11. [Verification & Testing](#verification--testing)
12. [Git Workflow](#git-workflow)
13. [Torn API Reference](#torn-api-reference)
14. [Community Research Reference](#community-research-reference)

---

## Repository Overview

```
Torn_Dark_tools/
├── AGENTS.md                              ← THIS FILE — developer reference
├── README.md                              ← User-facing project documentation
├── build.py                               ← Build script: injects common.js into src/*.src.js → output .user.js
├── urls                                   ← Raw GitHub URLs for Torn PDA remote loading
├── docs/
│   ├── common-api.md                      ← Shared common.js API reference
│   ├── torn-api-patterns.md               ← Torn API patterns, DOM selectors, community research
│   └── community-repos.md                 ← Community Torn script repos analysis & learnings
├── src/
│   ├── common.js                          ← Shared utilities injected into all scripts at build time
│   ├── torn-assistant.src.js              ← AI Advisor source
│   ├── torn-deal-finder.src.js            ← Plushie Prices source
│   ├── torn-war-bubble.src.js             ← War Bubble source
│   ├── torn-strip-poker.src.js            ← Strip Poker Advisor source
│   ├── torn-war-manager.src.js            ← War Manager source
│   ├── torn-bounty-filter.src.js          ← Bounty Filter source
│   ├── torn-market-sniper.src.js          ← Market Sniper source
│   └── torn-traveler-utility.src.js       ← Traveler Utility source
├── torn-assistant.user.js                 ← AI Advisor bubble (built output)
├── torn-assistant.md                      ← AI Advisor documentation
├── torn-pda-deal-finder-bubble.user.js    ← Plushie Prices bubble (built output)
├── torn-pda-deal-finder-bubble.md         ← Plushie Prices documentation
├── torn-war-bubble.user.js                ← War Bubble (built output)
├── torn-war-bubble.md                     ← War Bubble documentation
├── torn-strip-poker-bubble.user.js        ← Strip Poker Advisor (built output)
├── torn-strip-poker-bubble.md             ← Strip Poker Advisor documentation
├── torn-war-manager.user.js               ← War Manager (built output)
├── torn-war-manager-bubble.md             ← War Manager documentation
├── torn-bounty-filter-bubble.user.js      ← Bounty Filter bubble (built output)
├── torn-bounty-filter-bubble.md           ← Bounty Filter documentation
├── torn-market-sniper-bubble.user.js      ← Market Sniper bubble (built output)
├── torn-market-sniper-bubble.md           ← Market Sniper documentation
├── torn-traveler-utility-bubble.user.js   ← Traveler Utility bubble (built output)
└── torn-traveler-utility.md               ← Traveler Utility documentation
```

- **Remote:** `https://github.com/AlexTzib/Torn_Dark_tools.git`
- **Branch:** `main`
- **Line endings:** LF (not CRLF)
- **Language:** Plain JavaScript (no build step, no bundler, no TypeScript)
- **No dependencies** — each script is a standalone `.user.js` file

---

## Torn PDA Internals

[Torn PDA](https://github.com/Manuito83/torn-pda) is a Flutter mobile app that wraps Torn City in an `InAppWebView`. It has a rich userscript system. Understanding how PDA works is critical for writing scripts that work seamlessly in it.

### How PDA Runs Userscripts

1. PDA loads userscripts from its settings and injects them into the WebView via `evaluateJavascript()`.
2. Before injection, PDA calls `adaptSource()` which:
   - Replaces the literal string `###PDA-APIKEY###` in the script source with the user's actual Torn API key
   - If the script has a custom API key configured in PDA settings, that key is used instead
   - Wraps the script in an IIFE: `(function() { ...script... }());`
   - Normalizes curly/smart quotes to straight quotes (prevents copy-paste issues)
3. Scripts are injected at `DOCUMENT_START` time.

### PDA Handler Injection Order

PDA injects these handlers in this exact order, all at `DOCUMENT_START`, BEFORE any userscripts:

1. **`handler_tabContext(tabUid)`** — Sets `window.__tornpda.tab.uid` (read-only) and `window.__tornpda.tab.state`
2. **`handler_flutterPlatformReady()`** — Creates `__PDA_platformReadyPromise` that resolves when Flutter bridge is ready
3. **`handler_pdaAPI()`** — Defines `PDA_httpGet()` and `PDA_httpPost()`
4. **`handler_GM()`** — Defines all GM_* compatibility functions (by Kwack [2190604])
5. **`handler_evaluateJS()`** — Defines `PDA_evaluateJavascript()` (eval replacement)
6. **User scripts** — Each wrapped in IIFE, API key replaced

### PDA-Provided JavaScript Globals

| Global | Purpose | Notes |
|---|---|---|
| `PDA_httpGet(url, headers)` | Native HTTP GET via Flutter (bypasses WebView CORS) | Returns Promise with `{ responseHeaders, responseText, status, statusText }`. **2-second dedup keyed by URL only** (headers ignored for dedup). Silently returns `undefined` if deduped. |
| `PDA_httpPost(url, headers, body)` | Native HTTP POST via Flutter | Same return shape. **2-second dedup keyed by url+headers+body**. |
| `PDA_evaluateJavascript(source)` | Evaluates JS source in WebView context | eval() replacement (CSP blocks eval). 2-second dedup per source string. |
| `window.__tornpda.tab.uid` | Unique ID for the current PDA tab | Read-only (set via `Object.defineProperty`). |
| `window.__tornpda.tab.state` | Tab state object | `{ uid, isActiveTab: bool, isWebViewVisible: bool }` — use `isActiveTab` to skip processing when tab is in background. |
| `__PDA_platformReadyPromise` | Promise that resolves when Flutter bridge is ready | `PDA_httpGet`/Post await this internally, so calling them immediately is safe (they queue). |
| `GM_getValue`, `GM_setValue`, etc. | GreaseMonkey API compatibility layer | Uses `localStorage` with `GMV2_` prefix + JSON serialization. Provided by PDA's `handler_GM()`. |
| `GM.xmlHttpRequest` | GreaseMonkey XHR compatibility | Routes through `PDA_httpGet`/`PDA_httpPost` internally. Default timeout: 30 seconds via AbortController. |
| `GM_addStyle(css)` | Injects CSS `<style>` element into `<head>` | |
| `GM_setClipboard(text)` | Copies text to clipboard | Uses `navigator.clipboard.writeText()`. |
| `GM_notification(...)` | Shows notification | Implemented as `confirm()` dialog. Supports both object and positional argument forms. |
| `unsafeWindow` | Direct `window` reference | Set to `window` (no sandboxing in PDA). |

**Note:** All GM globals are frozen (`Object.freeze`) and non-writable (`writable: false, configurable: false`).

### Key PDA Behavior to Know

- **PDA makes API calls natively** (via Flutter/Dart HTTP), NOT through the WebView's `fetch()` or `XMLHttpRequest`. This means `hookFetch()`/`hookXHR()` interception **cannot see PDA's own API traffic**. This is why we added direct API fetching with `###PDA-APIKEY###`.
- **`###PDA-APIKEY###` replacement** happens as a simple string replace on the entire script source before injection. Any occurrence of that exact string gets replaced. To detect if PDA replaced it, check: `PDA_INJECTED_KEY.length >= 16 && !PDA_INJECTED_KEY.includes('#')`.
- **PDA custom API key per script** — Each script can have its own API key in PDA settings. If set, it overrides the user's main key: `s.customApiKey.isNotEmpty ? s.customApiKey : pdaApiKey`.
- **PDA_httpGet 2-second dedup** — GET dedup key is **URL only** (headers ignored). POST dedup key is `url + JSON.stringify(headers) + body`. Within 2 seconds, duplicate calls **silently return `undefined`** (no error). Our `crossOriginGet()` should avoid calling the same URL twice within 2 seconds.
- **PDA WebView is Flutter InAppWebView** — it supports standard Web APIs but has some quirks with `eval()` (blocked by CSP), popup windows, and download handling.
- **The `flutterInAppWebViewPlatformReady` event** fires when the native bridge is ready. `PDA_httpGet` waits for this internally via `__PDA_platformReadyPromise`.
- **Script injection timing:** PDA injects at `DOCUMENT_START`, before the page DOM is ready. Our scripts use `setTimeout(init, 1200)` to ensure the DOM is available.
- **PDA injection time setting: MUST be set to `Start`** — In Torn PDA's userscript settings, each script has an "Injection Time" option (`Start` or `End`). **Always choose `Start`** for all scripts in this repo. This ensures fetch/XHR hooks install as early as possible to capture API traffic during page load. The `setTimeout(init, 1200)` inside each script already handles waiting for the DOM before creating the UI. Choosing `End` would cause missed API interceptions, especially for Deal Finder which relies entirely on intercepted traffic.
- **PDA remote loading:** PDA can load scripts from URLs. The `urls` file in the repo root lists the raw GitHub URLs for each script. When adding/renaming a script, update this file.
- **PDA Global Disable** — PDA has a toggle to disable all userscripts at once (saves/restores each script's individual enabled state). Any manual script change while globally disabled resets the feature.
- **PDA script update tracking** — PDA tracks `noRemote` / `upToDate` / `localModified` status for scripts loaded from URLs.
- **iOS compatibility** — PDA JS snippets end with `123;` or a comment to avoid `WKErrorDomain` errors on iOS when scripts don't return a value. Our scripts return from an IIFE so this isn't needed, but good to know.

### GM Storage Format Details

PDA's GM compatibility layer (by Kwack) stores values differently from standard Tampermonkey:
- **Write:** `localStorage.setItem(key, 'GMV2_' + JSON.stringify(value))`
- **Read:** strips `GMV2_` prefix, then `JSON.parse()` the rest. Falls back to raw string if no prefix.
- If we ever need to read data written by a GM-based script (or vice versa), use this format.

### PDA Source Code Reference

Key files in the [Torn PDA repo](https://github.com/Manuito83/torn-pda):
- `lib/providers/userscripts_provider.dart` — Script management, `adaptSource()` (API key replacement), injection logic, match pattern system, global disable, update tracking
- `lib/utils/js_snippets/js_handlers.dart` — `handler_pdaAPI()` (PDA_httpGet/Post), `handler_GM()` (GreaseMonkey compat), `handler_flutterPlatformReady()`, `handler_tabContext()`, `handler_evaluateJS()`
- `lib/utils/js_snippets/js_snippets.dart` — Built-in JS snippets: `buyMaxAbroadJS()`, `travelRemovePlaneJS()`, `travelReturnHomeJS()`, `highlightCityItemsJS()`, `jailJS()`, `bountiesJS()`, `chatHighlightJS()`, bazaar fill buttons, etc.
- `lib/widgets/webviews/webview_full.dart` — Main WebView widget, script injection hooks

### PDA Built-In DOM Selectors (from js_snippets.dart)

These are selectors PDA uses in its own built-in features. Useful for our scripts that interact with the same pages.

**Travel page:**
- `.travel-home-header-button` — "Return Home" button
- `#travel-home-panel button.torn-btn` — Confirmation button in return home dialog
- `[class^="airspaceScene___"]` — Flight animation scene
- `[class^="randomFact___"]` — Random facts during flight

**Abroad shops:**
- `#user-money` or `[data-currency-money]` — User money display (`.getAttribute('data-money')` for numeric)
- `button.torn-btn[type="submit"]` — Buy buttons (must be inside `<li>`)
- `[class*="row___"]` — Item rows; `[class*="itemName___"]` — Item name
- `[class*="tabletColC___"]` — Stock count (horizontal); `[class*="inlineStock___"]` — Stock (vertical)
- `input.input-money` — Quantity input (has `data-money` attribute)
- `div[class*="buyPanel___"]` > `p[class*="question___"]` — Price question (vertical)

**Bazaar:**
- `[class*='amountValue_'], [class*='amount___']` — Item amount
- `[class*='price___']` — Item price
- `input[class*='buyAmountInput_']` — Buy quantity input
- `button[class*='buy___'], button[class*='activate-buy-button']` — Buy/cart button

**Jail:**
- `.users-list > li` — Player rows
- `.level`, `.time`, `.user.name` — Level, time remaining, player name
- `.buy, .bye` — Bail action link (append "1" to URL for quick bail)
- `.bust` — Bust action link (append "1" for quick bust)

**Bounties:**
- `.bounties-list > li:not(.clear)` — Bounty rows
- `.level` — Target level
- `.user-red-status` — Hospital (unavailable)
- `.user-blue-status` — Abroad/jail (unavailable)

**City map:**
- `#map .leaflet-marker-pane *` — Map items (Leaflet.js); check `src.indexOf("/images/items/")` for loot

**Chat:**
- `#chatRoot` — Chat root element
- `[class*='chat-list-button__']` — Chat list buttons
- `[class*='chat-box-body__'] [class*='chat-box-message__box__']` — Chat messages

**React input event dispatch** (for setting input values programmatically):
```javascript
input.value = newValue;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

---

## Torn Game Rules & Policy

### Core Rules for Userscripts

These rules come from Torn's official stance and Torn PDA's userscript policies:

1. **No automation of game actions** — Scripts must NEVER click, buy, sell, attack, travel, train, use items, or perform any game action automatically. Every game action must require an explicit user click.
2. **One click = one action** — A single user interaction must not trigger multiple game actions. Copying text, opening a link, or refreshing a display panel are NOT game actions.
3. **No API key harvesting** — Scripts must not extract, store externally, or abuse API keys. Using the user's own key for direct `api.torn.com` calls is fine.
4. **No request modification** — Intercepting API traffic is tolerated (TornTools does it), but modifying requests/responses is not allowed.
5. **Read-only display** — Showing information from the API or DOM in an overlay is allowed.
6. **No external servers** — Scripts should not phone home to external servers (except `api.torn.com`).
7. **API rate limits** — Torn allows ~100 requests per minute. Stay well under this.
8. **`selections=basic`** — When fetching faction data, use the minimum selection needed. Don't request sensitive data you don't need.

### What IS Allowed

- Passive fetch/XHR interception (clone + read responses)
- DOM scraping for display purposes
- Direct API calls to `api.torn.com` with the user's own key
- Displaying enemy faction online status (public data)
- Timer analysis / advisory displays
- Links and copy-to-clipboard buttons (one click = one browser action, not a game action)
- localStorage for caching and preferences

### What Is NOT Allowed

- Auto-attacking, auto-buying, auto-traveling
- Chaining multiple game actions from one click
- Sending data to external servers
- Modifying Torn's requests or responses
- Extracting other users' API keys
- Bypassing Torn's anti-automation measures

---

## API Key Policy

All scripts that need an API key follow this three-tier priority:

```
Priority 1: PDA injection (###PDA-APIKEY###)  — automatic in Torn PDA
    ↓ (not available)
Priority 2: Manual entry (localStorage)       — user pastes key in panel
    ↓ (not available)
Priority 3: Network interception              — reads key= from API URLs in traffic
```

### Implementation Pattern

```javascript
// At the top of the script, right after 'use strict':
const PDA_INJECTED_KEY = '###PDA-APIKEY###';

// In init():
function init() {
    // Priority 1: PDA-injected key
    if (PDA_INJECTED_KEY.length >= 16 && !PDA_INJECTED_KEY.includes('#')) {
        STATE.apiKey = PDA_INJECTED_KEY;
        STATE.apiKeySource = 'pda';
        addLog('API key loaded from Torn PDA');
    }

    // Priority 2: manually saved key
    if (!STATE.apiKey) {
        const savedKey = getManualApiKey();
        if (savedKey) {
            STATE.apiKey = savedKey;
            STATE.apiKeySource = 'manual';
            addLog('API key loaded from manual entry');
        }
    }

    // Priority 3: network interception fills it in later via hookFetch/hookXHR
    // ...
}
```

### UI Text Pattern

```javascript
${STATE.apiKeySource === 'pda'
    ? 'Using Torn PDA key automatically. Manual entry below is optional (overrides PDA key).'
    : 'In Torn PDA the key is loaded automatically. Outside PDA, paste your key below.'}
```

### Rules

- API key is **never sent to any external server** — only to `api.torn.com`
- Manual key is stored in `localStorage` under `${SCRIPT_KEY}_api_key`
- Intercepted key is stored in memory only (`STATE.apiKey`), never persisted
- If the user saves a manual key, it overrides the PDA key

---

## Script Architecture

### Overall Structure

Every script follows this skeleton:

```javascript
// ==UserScript==
// @name         Torn PDA - [Name]
// @namespace    alex.torn.pda.[namespace]
// @version      X.Y.Z
// @description  [description]
// @author       Alex + ChatGPT
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const PDA_INJECTED_KEY = '###PDA-APIKEY###';

    const SCRIPT_KEY = 'tpda_[unique_key]';
    const BUBBLE_ID = 'tpda-[name]-bubble';
    const PANEL_ID = 'tpda-[name]-panel';
    const HEADER_ID = 'tpda-[name]-header';

    const STATE = {
        // script-specific data
        ui: {
            minimized: true,
            zIndexBase: XXXXXX  // unique per script to avoid overlap
        },
        _logs: []
    };

    // === Utility functions ===
    // safeJsonParse, deepMerge, formatNumber, formatMoney, formatSeconds,
    // ageText, escapeHtml, addLog, getStorage, setStorage, clampToViewport,
    // bringToFront, makeDraggableBubble, makeDraggablePanel

    // === API key functions ===
    // getManualApiKey, setManualApiKey, extractApiKeyFromUrl

    // === Data processing functions ===
    // (script-specific)

    // === Network hooks ===
    // hookFetch, hookXHR

    // === UI functions ===
    // ensureStyles, createBubble, createPanel, renderPanel

    // === Init ===
    function init() { /* ... */ }

    setTimeout(init, 1200);
})();
```

### z-Index Allocation

Each script uses a unique z-index base so they can coexist:

| Script | z-index base | Bubble ID | Panel ID |
|---|---|---|---|
| Traveler Utility | 999935 | `tpda-traveler-bubble` | `tpda-traveler-panel` |
| Market Sniper | 999940 | `tpda-mkt-bubble` | `tpda-mkt-panel` |
| War Manager | 999945 | `tpda-war-mgr-bubble` | `tpda-war-mgr-panel` |
| Bounty Filter | 999950 | `tpda-bounty-bubble` | `tpda-bounty-panel` |
| Strip Poker Advisor | 999960 | `tpda-poker-bubble` | `tpda-poker-panel` |
| War Bubble | 999970 | `tpda-war-online-bubble` | `tpda-war-online-panel` |
| Plushie Prices | 999980 | `tpda-plushie-bubble` | `tpda-plushie-panel` |
| AI Advisor | 999990 | `tpda-safe-ai-bubble` | `tpda-safe-ai-panel` |

When adding a new script, pick a z-index base that doesn't collide (e.g., 999930).

### localStorage Keys

Each script prefixes its keys with `SCRIPT_KEY`:

| Script | SCRIPT_KEY | Keys Used |
|---|---|---|
| AI Advisor | `tpda_safe_ai_bubble_v3` | `_api_key`, `_bubble_pos`, `_panel_pos` |
| Plushie Prices | `tpda_plushie_prices_v1` | `_apikey`, `_bubble_pos`, `_panel_pos`, `_prices` |
| War Bubble | `tpda_war_online_location_timers_bubble_v3` | `_api_key`, `_bubble_pos`, `_panel_pos`, `_enemy_faction_id`, `_timer_track`, `_poll_interval`, `_collapsed` |
| Strip Poker | `tpda_strip_poker_v1` | `_bubble_pos`, `_panel_pos` |
| War Manager | `tpda_war_manager_v1` | `_bubble_pos`, `_panel_pos`, `_threshold_pct`, `_poll_ms`, `_enemy_faction_id` |
| Bounty Filter | `tpda_bounty_filter_v1` | `_bubble_pos`, `_panel_pos`, `_filters`, `_bounty_cache`, `_status_cache` |
| Market Sniper | `tpda_market_sniper_v1` | `_api_key`, `_bubble_pos`, `_panel_pos`, `_watchlist`, `_prices`, `_dismissed`, `_filters` |
| Traveler Utility | `tpda_traveler_v1` | `_api_key`, `_bubble_pos`, `_panel_pos` |

### Debug Log Pattern

Every script has:
- `STATE._logs = []` — array of timestamped log strings (max 100)
- `addLog(msg)` — pushes `[HH:MM:SS] msg` and shifts if > 100
- Collapsible log section at the bottom of the panel UI
- "Copy Log" button that copies all entries to clipboard
- Log entries at key points: init, API calls, data merges, errors, poll cycles

### Bubble/Panel UI Pattern

- **Bubble:** 56×56px circle, absolute positioned, draggable via pointer events
- **Panel:** ~340px wide, dark background (#0d0f14), rounded corners, draggable header
- **Collapse:** panel hides, bubble shows (STATE.ui.minimized = true)
- **Expand:** bubble hides, panel shows (STATE.ui.minimized = false)
- **Position persistence:** saved to localStorage on drag end, restored on init
- **Viewport clamping:** on window resize, both bubble and panel are clamped to visible area

### Dark Theme Colors

| Element | Color |
|---|---|
| Panel background | `#0d0f14` |
| Card background | `#141821` or `#191b22` |
| Card border | `#2f3340` |
| Text primary | `#fff` |
| Text secondary | `#bbb` |
| Text muted | `#aaa` |
| Accent blue | `#2a6df4` |
| Success green | `#4caf50` or `#2ecc40` |
| Warning yellow | `#ff0` or `#ffd700` |
| Error red | `#f44` |
| Log background | `#0f1116` |

---

## Per-Script Reference

### AI Advisor (`torn-assistant.user.js`)

**Purpose:** Status dashboard, happy-jump advisor, stock-block ROI, war timing, drug-free energy plan.

**Key functions:**
- `fetchDirectData()` — Direct API calls for user + faction data (requires API key)
- `mergeUserData(data)` — Merges user API response into STATE.userData **and normalizes flat API fields** (see [API Response Normalization](#api-response-normalization))
- `mergeTornData(data)` — Merges torn/market API response into STATE.tornData
- `mergeFactionData(data)` — Merges faction API response into STATE.factionData
- `renderHappyJumpCard(user)` — Happy jump readiness scoring
- `renderStockBlockCard(user)` — Stock benefit block ROI analysis
- `renderWarTimingCard(user, faction)` — War readiness advisory
- `renderDrugFreeEnergyCard(user)` — Drug-free energy plan
- `renderAdviceSection(user)` — Contextual tips

**Data flow:**
1. API key resolved (PDA > manual > intercepted)
2. `fetchDirectData()` calls `api.torn.com/user` and `api.torn.com/faction` (with detailed logging)
3. `mergeUserData()` normalizes flat API response → creates `user.bars`, `user.battlestats`, `user.money` wrappers
4. `hookFetch`/`hookXHR` passively intercepts additional traffic (torn/market)
5. `renderPanel()` reads from the normalized wrapper objects

**Hard-coded data:** `STOCK_RULES` object maps stock tickers to share thresholds, benefit types, frequencies, and benefit descriptions.

### Plushie Prices (`torn-pda-deal-finder-bubble.user.js`)

**Purpose:** Plushie bazaar vs item market price comparison table.

**Key constants:**
- `PLUSHIES` — Array of 13 objects `{ id, name }` for all Torn plushies (IDs: 186, 187, 215, 258, 261, 266, 268, 269, 273, 274, 281, 384, 618)
- `API_DELAY_MS` — 250ms delay between plushie iterations
- `CACHE_TTL_MS` — 10 minutes

**Key functions:**
- `crossOriginGet(url)` — Cross-origin GET helper: tries `PDA_httpGet` first (native Flutter HTTP, bypasses WebView restrictions), falls back to plain `fetch()` (works in Tampermonkey since weav3r.dev sends `Access-Control-Allow-Origin: *`). Returns parsed JSON.
- `fetchMarketData(itemId)` — Fetches `api.torn.com/v2/market/{id}/itemmarket`; returns `{ floor, avg, count }`
- `fetchBazaarData(itemId)` — Fetches `weav3r.dev/api/marketplace/{id}` via `crossOriginGet()`; returns `{ bazaarFloor, bazaarAvg, bazaarCount }`. No API key needed.
- `fetchAllPrices(force)` — For each plushie: calls both `fetchMarketData` and `fetchBazaarData` in parallel (`Promise.all`), then sleeps 250ms before the next plushie. Computes `best = min(market floor, bazaar floor)`.
- `getSortedPlushies()` — Returns plushie rows sorted by the current sort column/direction (name, floor, bazaar, best)
- `renderPanel()` — Renders API key input (if needed), status bar, sortable price table (Market/Bazaar/Best columns), and debug log
- `handleApiPayload(url, data)` — Extracts API key from passively intercepted traffic

**v2.4.0 changes:**
- **Fixed bazaar fetch in PDA:** `fetchBazaarData()` now uses `crossOriginGet()` which routes through `PDA_httpGet` in Torn PDA. PDA's WebView blocks plain `fetch()` to external domains even when CORS headers are present. `PDA_httpGet` uses Flutter's native HTTP client, bypassing WebView restrictions entirely.

**Data flow:**
1. API key resolved (saved → network-intercepted → manual entry)
2. On panel open: loads cached prices, auto-fetches if cache older than 10 minutes
3. For each plushie (sequentially, 250ms apart):
   - `fetchMarketData()` → Torn API v2 → `{ floor, avg, count }`
   - `fetchBazaarData()` → TornW3B → `{ bazaarFloor, bazaarAvg, bazaarCount }`
   - Both run in parallel via `Promise.all`
4. `best = Math.min(market floor, bazaar floor)` — the cheapest option across both sources
5. `renderPanel()` displays sortable table with Market, Bazaar, Best columns; highlights which source provides the best price; full-set total at bottom

> **Bazaar source:** The Torn API v2 `bazaar` endpoint returns a bazaar directory (store names/stats), NOT per-item price listings. Bazaar floor prices come from TornW3B (`weav3r.dev`), the same third-party service used by TornTools.

**No DOM scraping.** Item market data from Torn API v2, bazaar data from TornW3B.

### War Bubble (`torn-war-bubble.user.js`)

**Purpose:** Enemy faction online tracker with location buckets, timer analysis, attack buttons.

**v3.2.0 changes:**
- **Toggle bug fix:** `STATE.collapsed[key] = !STATE.collapsed[key]` was broken when key was `undefined` (`!undefined` = `true` = stays collapsed). Fixed to explicitly default `undefined` to `true` before toggling.
- **Member cap per section:** `SECTION_MEMBER_CAP = 15` — sections render at most 15 members by default with a "Show all X members (+N more)" link. Prevents PDA freezing on factions with 100+ members (each member = 3 buttons + ~400 bytes HTML).
- **`STATE.showAll`:** Tracks which sections the user has expanded beyond the cap. Resets when the section is collapsed.
- **Collapse All / Expand All buttons:** Two buttons above the member sections for quick bulk toggle. Collapse All also resets showAll state.

**v3.3.0 changes (performance):**
- **Event listener leak fix:** Moved the delegated `addEventListener('click', ...)` from `renderPanel()` to `createPanel()` — attached ONCE instead of stacking on every poll cycle. Previous code accumulated N listeners after N renders; each click fired all N handlers causing cascading re-renders.
- **Timer lifecycle management:** `tickTimers()` now skips DOM queries when panel is minimized. Timer `setInterval` starts in `expandPanelNearBubble()` and clears in `collapseToBubble()`, saving CPU while the bubble is collapsed.
- **Render debounce:** `renderPanel()` now uses `requestAnimationFrame` to collapse rapid-fire calls into a single frame. Prevents stacked renders from rapid clicks or poll-then-UI sequences.
- **Double-render fix:** `expandPanelNearBubble()` no longer fires two synchronous renders; it renders stale data immediately, then updates when the API fetch completes.

**Key functions:**
- `refreshEnemyFactionData()` — Fetches `api.torn.com/faction/{id}?selections=basic`
- `normalizeMembers(data)` — Converts API member data to uniform format
- `inferLocationState(member)` — Determines: torn/abroad/hospital/jail/traveling/unknown
- `extractTimerInfo(member)` — Parses remaining time from various API fields
- `analyzeTimerChange(memberId, currentTimer)` — Detects faster-than-expected timer drops
- `groupedMembers()` — Buckets members into display groups
- `detectEnemyFaction()` — Auto-detects faction ID from URL/page links
- `startPolling()` / `restartPolling()` — Configurable interval polling

**Data flow:**
1. API key resolved (PDA > manual > intercepted)
2. Faction ID auto-detected from URL or manually entered
3. `refreshEnemyFactionData()` fetches faction data
4. Members normalized, enriched with location/timer/action info
5. Grouped and rendered with attack buttons per member

**Attack buttons per member:**
- "Go Attack" — `<a>` link to `https://www.torn.com/loader.php?sid=attack&user2ID={id}`
- "Copy URL" — copies the attack URL to clipboard
- "Copy Name" — copies the member name to clipboard
- All are one-click = one browser action (compliant)

**Configurable poll intervals:** `[30s, 1min, 2min, 5min, 10min]` — stored in localStorage, default 1min. Polling only runs when panel is open.

### Strip Poker Advisor (`torn-strip-poker-bubble.user.js`)

**Purpose:** Texas Hold'em advisor for Torn Strip Poker. Auto-detects hole + community cards, evaluates best-of-7 hand via Monte Carlo, suggests optimal play. Multi-opponent aware.

**v2.0.0:** Full rewrite from 5-card draw to Texas Hold'em. State tracks `myCards[]` (hole, 0-2) and `tableCards[]` (community, 0-5). `bestOfN()` evaluates all C(n,5) combinations. `calcWinProb()` and `calcOppRange()` simulate remaining community cards + opponent hole cards via Monte Carlo.

**v2.0.1:** Broadened XHR interception — `isTornPageUrl()` matches ALL `torn.com` non-API requests. Every JSON response goes through `handlePokerPayload()`.

**v2.1.0:** Critical DOM detection fix — `parseCardClass()` uses unanchored regex (Torn CSS modules have hash suffixes like `hearts-2___xYz1a`). Rewrote `scanDom()` with 4 strategies targeting Torn holdem DOM selectors. Added 1-second polling loop + change detection.

**v2.2.0:** Multi-opponent awareness — `detectActivePlayers()` counts opponents via DOM selectors, `calcWinProb()` and `calcOppRange()` simulate `N-1` opponents (must beat ALL to win). UI shows opponent count with +/- adjustment buttons.

**Design choices (pocket-friendly):**
- **40 px bubble** (vs standard 56 px) — won't cover the poker table on mobile
- **260 px panel** (vs standard 390–420 px) — leaves room for the game UI
- **z-index base 999960** — sits behind war bubble and above bounty filter
- **No API calls** — zero external network overhead (XHR/fetch hooks only intercept Torn's own game data)

**Key functions:**
- `parseCardClass(className)` — Parses Torn's CSS-module card classes (`"hearts-2___xYz1a"`, `"spades-K___abc12"`) into `{rank, suit, value}` using unanchored regex.
- `handlePokerPayload(data)` — Processes intercepted JSON game responses, extracting cards from various known data structures (`player.hand`, `yourCards`, `currentGame[]`, etc.) with recursive fallback scan.
- `hookFetch()` / `hookXHR()` — Monkey-patches `fetch` and `XMLHttpRequest` to intercept all Torn page requests. Installed immediately on script load (before DOM ready).
- `scanDom()` — 4-strategy card detection:
  1. Torn holdem DOM: `[class*="playerMeGateway"] [class*="hand"] [class*="card"] [class*="front"] > div` (hole) and `[class*="communityCards"] [class*="front"] > div` (community)
  2. Generic suit-class scan (fallback)
  3. data-card/data-rank attributes
  4. img src/alt patterns
- `detectActivePlayers()` — Counts active opponents via `[class*="opponent"]` elements, checks for folded/sitting out text, counts self if cards present. Returns total players (2-9).
- `startCardPolling()` — 1-second `setInterval` that calls `scanDom()` when on holdem page.
- `bestOfN(cards)` — Evaluates all C(n,5) combinations from up to 7 cards, returns best hand `{name, rank, score}`.
- `evaluate5(cards)` — Full 5-card hand evaluator: rank (0–9), name, numeric score for tie-breaking. Handles ace-low straights (A-2-3-4-5).
- `calcWinProb(holeCards, communityCards, numPlayers)` — Monte Carlo simulation (5000 iterations): draws remaining community cards + N-1 opponent hole pairs, counts wins only when you beat ALL opponents.
- `calcOppRange(holeCards, communityCards, numPlayers)` — Monte Carlo (3000 samples): counts each opponent's hand types and how often they beat you.
- `suggest(prob)` — Maps effective win % (win + tie×0.5) to RAISE (≥72%) / CALL (≥42%) / CAUTION (≥30%) / FOLD (<30%).
- `addCard(rank, suit)` / `removeCard(source, idx)` / `clearCards()` — Manage hole + community card state; auto-evaluates when 2 hole + 3+ community.
- `renderPanel()` — Card picker (two-step: rank row → suit row), hand display with source indicator, strength bar, action recommendation, opponent count with +/- buttons, collapsible opponent range, debug log.

**Torn Hold'em DOM selectors (CSS modules with hash suffixes):**
| Element | Selector Pattern |
|---------|-----------------|
| Player's hand area | `[class*="playerMeGateway"]` |
| Hand container | `[class*="hand"]` |
| Card element | `[class*="card"]` |
| Card front face | `[class*="front"]` |
| Community cards | `[class*="communityCards"]` |
| Opponent elements | `[class*="opponent"]` |
| Card suit-rank class | `hearts-2___xYz1a`, `spades-K___abc12` (unanchored regex: `/([cdhs]|clubs?|diamonds?|hearts?|spades?)[^a-z]*([2-9]|10|[JQKA])/i`) |

**Page URL:** `https://www.torn.com/page.php?sid=holdem*`

**Card detection priority:**
1. **XHR/fetch interception** — Highest priority, captures game data JSON directly
2. **Torn holdem DOM scan** — CSS-module selectors for `playerMeGateway`, `communityCards`
3. **Generic CSS class scan** — Suit-rank patterns in any element's class list
4. **Legacy DOM scan** — `<img>` src/alt, `[data-card]` attributes

**Card picker UX:**
1. Tap a rank button (2–A) — highlights green
2. Tap a suit button (♣♦♥♠) — card is added to hole or community
3. Already-used cards are greyed out
4. Tap any selected card to remove it
5. Toggle between Hole/Community target
6. Evaluation runs automatically when 2 hole + 3+ community cards present

**Multi-opponent simulation:**
- `activePlayers` tracked in STATE (default 2, range 2-9)
- DOM detection counts `[class*="opponent"]` elements not folded/sitting out
- Win probability requires beating ALL opponents (not just one)
- Tie = all opponents tied with you (rare with multiple opponents)
- User can manually adjust opponent count with +/- buttons in the panel

### Bounty Filter (`torn-bounty-filter-bubble.user.js`)

**Purpose:** Fetches bounties from the Torn API and filters by target state (hospital, jail, abroad, in Torn), hospital release timers, level, and reward amount. Attack links for easy claiming.

**Design:**
- **56 px bubble** with orange gradient, labeled "BTY"
- **380 px panel** — filter controls at top, scrollable bounty list below
- **z-index base 999950** — below all other scripts
- **Two-phase data fetch:** First fetches bounty list from `v2/torn/?selections=bounties`, then enriches each target with `v2/user/{id}?selections=profile` to get their status. Both use v2 API.

**Key functions:**
- `fetchBounties()` — Fetches `v2/torn/?selections=bounties` (v2 returns an **array**, v1 returned an object keyed by ID), parses bounty objects, saves to localStorage, then calls `enrichBountyTargets()`
- `enrichBountyTargets()` — For up to 30 unique targets, fetches `v2/user/{id}?selections=profile` with 350ms gaps. Handles both v2 nested (`data.profile`) and flat response formats. Uses `inferLocationState()` and `extractTimerInfo()` from common.js to determine state/timers. Uses `estimateStats()` from common.js to map rank → stat range. Results cached in localStorage (10-minute TTL) and memory (1-minute TTL).
- `loadCachedBounties()` / `saveCachedBounties()` — Persist bounty list to localStorage
- `loadCachedStatuses()` / `saveCachedStatuses()` — Persist target status cache to localStorage
- `applyEnrichment()` — Merges status cache into bounty list, producing `STATE.enriched[]`
- `filteredBounties()` — Applies all active filters to `STATE.enriched[]`
- `renderPanel()` — Renders filter controls (state checkboxes, max level, min reward, max stats dropdown, hospital-soon filter), status bar, bounty rows with state icon, name (profile link), level, reward, stat estimate, timer, and Attack button

**Filters:**
| Filter | Default | Description |
|--------|---------|-------------|
| In Torn | ON | Show targets with "Okay" status (available to attack) |
| Hospital | ON | Show hospitalized targets (with remaining time) |
| Jail | OFF | Show jailed targets |
| Abroad | OFF | Show targets abroad or traveling |
| Unknown | ON | Show targets whose status couldn't be determined |
| Max Level | 0 (any) | Hide targets above this level |
| Min Reward | 0 (any) | Hide bounties below this reward |
| Max Stats | No limit | Dropdown: 7 estimated stat ranges (< 2k through > 200M). Based on target rank via `estimateStats()`. Hides targets above selected range |
| Hide soon | OFF | Hide hospital targets releasing in < N minutes |

**Data flow:**
1. API key resolved (PDA > shared manual > intercepted)
2. On init: load cached bounties + statuses from localStorage
3. On panel open: render cached data immediately (no API calls)
4. On Refresh: fetch bounty list from `v2/torn/?selections=bounties`, save to localStorage
5. For each unique target (up to 30), fetch `v2/user/{id}?selections=profile` (1-min memory TTL, 10-min localStorage TTL, 350ms gaps)
6. `inferLocationState()` + `extractTimerInfo()` determine state/timer; `estimateStats()` maps rank → stat range
7. `filteredBounties()` applies user filters (incl. stat range), `renderPanel()` displays results

**API usage:**
- 1 call for bounty list + up to 30 calls for target enrichment per refresh
- 350ms gap between enrichment calls (~170 calls/min if only this script)
- localStorage caching (10-min TTL) prevents redundant calls across panel open/close and page navigation

### Market Sniper (`torn-market-sniper-bubble.user.js`)

**Purpose:** Market profit finder — scans item market and bazaar prices for watchlist items, detects underpriced deals, and shows profit/ROI metrics. Notifications on high-value opportunities.

**Design:**
- **56 px bubble** with green gradient, labeled "MKT"
- **380 px panel** — settings/filters at top, scrollable deal cards below
- **z-index base 999940** — lowest of all scripts
- **Dual-source pricing:** Torn API v2 itemmarket + TornW3B bazaar for each watchlist item
- **Uses shared `calcDealProfit()` and `tpdaNotify()`** from `common.js`

**Key constants:**
- `DEFAULT_WATCHLIST` — 50 popular tradeable items across 7 categories: Drugs (11), Plushies (13), Flowers (11), Boosters/Supply Packs (5), Medical (3), Temp Weapons & Other (7). All IDs verified against tornstats. User can add/remove items and reset to defaults.
- `API_DELAY_MS = 300` — gap between items during scan
- `CACHE_TTL_MS = 5 * 60 * 1000` — 5-minute price cache
- `DISMISS_TTL_MS = 60 * 60 * 1000` — 1-hour dismiss expiry
- `NOTIFY_DEDUP_MS = 5 * 60 * 1000` — 5-minute notification dedup

**Key functions:**
- `crossOriginGet(url)` — Cross-origin GET: `PDA_httpGet` first (native Flutter HTTP), falls back to `fetch()`. Same pattern as Plushie Prices.
- `fetchItemMarketData(itemId)` — Fetches `/v2/market/{id}/itemmarket`; returns `{ floor, avg, count, itemName }`
- `fetchItemBazaarData(itemId)` — Fetches `weav3r.dev/api/marketplace/{id}` via `crossOriginGet()`; returns `{ bazaarFloor, bazaarAvg, bazaarCount, bazaarSellerId }`
- `scanAllItems()` — For each watchlist item: calls both `fetchItemMarketData` and `fetchItemBazaarData` in parallel (`Promise.all`), sleeps 300ms before the next item. Triggers `buildDeals()` and `checkNotifications()` on completion.
- `buildDeals()` — For each watchlist item: determines best buy price (min of market floor and bazaar floor), uses `calcDealProfit()` from common.js to compute net profit/ROI. Populates `STATE.deals[]`.
- `filteredDeals()` — Applies active filters (profitableOnly, minProfit, minRoi, hideDismissed) and sorts by `netProfit`/`roiPct`/`discoveredAt`.
- `checkNotifications()` — Iterates deals, fires `tpdaNotify()` for any exceeding profit/ROI thresholds. Dedup via `tpdaNotify()`'s built-in TTL cache.
- `updateBubbleBadge()` — Updates red badge count on the bubble showing profitable deal count.
- `renderPanel()` — Renders settings section (filters, thresholds, watchlist edit), scan status bar, deal cards (buy/sell/profit/ROI with color coding), and debug log.

**Filters/Settings:**
| Setting | Default | Description |
|---------|---------|-------------|
| Profitable only | ON | Hide items with negative or zero profit |
| Min Profit | $0 (any) | Hide deals below this net profit |
| Min ROI | 0% (any) | Hide deals below this ROI% |
| Hide dismissed | ON | Hide deals the user has dismissed |
| Sort by | Net Profit | Sort deals by netProfit / roiPct / discoveredAt |
| Tax estimate | 0% | Conservative tax estimate for profit calculation |
| Notify enabled | ON | Browser notifications on high-value deals |
| Notify min profit | $100,000 | Minimum profit to trigger notification |
| Notify min ROI | 10% | Minimum ROI% to trigger notification |

**Data flow:**
1. API key resolved (PDA > manual > intercepted)
2. On panel open: loads cached prices, auto-scans if cache older than 5 minutes
3. For each watchlist item (sequentially, 300ms apart):
   - `fetchItemMarketData()` → Torn API v2 → `{ floor, avg, count }`
   - `fetchItemBazaarData()` → TornW3B → `{ bazaarFloor, bazaarAvg, bazaarCount }`
   - Both run in parallel via `Promise.all`
4. `buildDeals()` computes profit: `bestBuy = min(market floor, bazaar floor)`, `sell = market avg`, profit via `calcDealProfit()`
5. `filteredDeals()` applies filters/sort, `renderPanel()` displays deal cards
6. `checkNotifications()` fires browser alerts on exceptional deals
7. Bubble badge updates with profitable deal count

**API usage:**
- 8 items × 2 calls each = 16 API calls per scan, 300ms apart (~32 calls/min)
- Caching prevents redundant calls (5-min TTL)
- Dismissed deals persist for 1 hour in localStorage

### Traveler Utility (`torn-traveler-utility-bubble.user.js`)

**Purpose:** Quick-travel navigation tool with hospital timer. Shows current travel status (in Torn / abroad / flying), hospital countdown, and provides one-tap navigation buttons for Mexico, Cayman Islands, Canada, and Switzerland. Context-sensitive: shows fly-to buttons when in Torn, shop + return buttons when abroad (with Swiss Bank & Rehab info for Switzerland), ETA countdown when flying, hospital timer with progress bar when hospitalized.

**Design:**
- **56 px bubble** with blue gradient, airplane icon
- **340 px panel** — status card + hospital card + context-sensitive action buttons
- **z-index base 999935** — lowest of all scripts
- **Single API endpoint:** `user/?selections=travel,profile` for travel status + hospital state

**Key constants:**
- `COUNTRIES` — Array of 4 objects `{ id, name, flag, color, items, flyTime }` for Mexico, Cayman, Canada, Switzerland
- `TRAVEL_URL` — `https://www.torn.com/page.php?sid=travel`
- `ABROAD_URL` — `https://www.torn.com/shops.php?step=abroad`
- `POLL_MS = 30000` — refresh travel status every 30 seconds

**Key functions:**
- `fetchTravelStatus()` — Fetches `api.torn.com/user/?selections=travel,profile`; uses `PDA_httpGet` if available, falls back to `fetch()`
- `parseTravelData(data)` — Determines `STATE.location` (torn/abroad/traveling), `STATE.abroadCountry`, and `STATE.hospital` (active/until/description) from API response
- `extractCountryFromStatus(desc)` — Regex extraction of country name from status description string
- `renderStatusCard()` — Shows current location, destination (if traveling), ETA (if flying), last update time
- `renderHospitalCard()` — Red card with hospital icon, description, countdown progress bar, and time remaining until release. Only shown when `STATE.hospital.active` is true
- `renderTornCard()` — When in Torn: fly-to buttons for each country with flag, items, and approximate fly time
- `renderAbroadCard()` — When abroad: shop button (for shopping countries), banking info (for Cayman), Swiss Bank + Rehab Centre info (for Switzerland), return-home button
- `renderTravelingCard()` — When flying: progress bar (dynamic max based on destination fly time), ETA countdown, arrival tips for destination
- `onPanelExpand()` / `onPanelCollapse()` — Start/stop polling on panel open/close

**Data flow:**
1. API key resolved (PDA > manual > intercepted)
2. On panel open: `fetchTravelStatus()` + start 30s polling
3. `parseTravelData()` determines location from travel + status data; detects hospital from status.state/until
4. `renderPanel()` shows status card + hospital card (if applicable) + context-appropriate action cards
5. All buttons navigate to Torn pages; no game actions performed

**API usage:**
- 1 call per 30s poll cycle, only while panel is open
- Tagged with `&_tpda=1` to avoid fetch/XHR hook double-processing

### War Manager (`torn-war-manager.user.js`)

**Purpose:** War target assignment manager — scans both factions, estimates stats, assigns targets by stat percentage threshold, online enemy report with attack links, generates copy-paste assignment messages.

**Design:**
- **56 px bubble** with orange gradient, labeled "MGR"
- **380 px panel** — war status card, settings, member selector, assignment cards, online enemy report
- **z-index base 999945** — below bounty filter
- **Dual-faction data:** Fetches own and enemy faction rosters, enriches with profile/stat data

**Key constants:**
- `DEFAULT_POLL_MS = 120000` — 2-minute default polling interval
- `DEFAULT_THRESHOLD_PCT = 120` — default stat threshold (120% of enemy stats)
- `STAT_SAFETY_FACTOR = 0.7` — conservative multiplier for stat matching
- `POLL_INTERVALS` — configurable: `[30s, 1min, 2min, 5min, 10min]`

**Key functions:**
- `fetchOwnFactionMembers()` — Fetches own faction via `api.torn.com/faction/?selections=basic`
- `fetchEnemyFactionMembers()` — Fetches enemy faction via `api.torn.com/faction/{id}?selections=basic`
- `scanAllStats()` — Scans both factions' members via `fetchMemberProfile()` with 650ms gaps
- `enrichWithStats(members)` — Attaches stat estimates to normalized member list
- `sortEnemiesByPriority()` — Sorts by: hospital timer (soonest first), online status, stat estimate
- `computeAssignments()` — Assigns targets to own members by stat threshold percentage
- `getTargetsForMember(memberId)` — Returns matched targets for a specific own-faction member
- `generateAssignmentMessages()` / `generateCompactMessages()` / `generateSelectedTargetMessages()` — Copy-paste message formatters
- `generateOnlineReport()` — Text summary of online enemies with attack URLs
- `detectEnemyFaction()` — Multi-strategy: URL parameter, page links, API war data
- `startPolling()` / `restartPolling()` — Configurable interval polling

**Data flow:**
1. API key resolved (PDA > manual > intercepted)
2. Faction ID auto-detected from URL or manually entered
3. `refreshAll()` fetches both faction rosters in parallel
4. `scanAllStats()` enriches members with profile/stat estimates
5. `computeAssignments()` matches own members to enemy targets
6. `renderPanel()` displays member selector, target lists, online enemy report
7. Copy buttons generate formatted messages for faction chat

**API usage:**
- 2 calls for faction rosters + N profile calls per scan (650ms gaps)
- Polling only runs when panel is open, configurable 30s–10min intervals

---

## Coding Conventions

### General Rules

1. **No build step** — All scripts are plain JavaScript, no TypeScript, no bundler
2. **No external dependencies** — Each script is completely standalone
3. **IIFE wrapper** — Every script wrapped in `(function () { 'use strict'; ... })();`
4. **Preserve existing comments** — When editing, don't add or remove comments unless specifically asked
5. **Compact code** — Collapse duplicate else branches, avoid unnecessary nesting
6. **LF line endings** — Not CRLF
7. **No `eval()`** — Blocked by Torn's CSP anyway
8. **Always escape HTML** — Use `escapeHtml()` for any user-visible data to prevent XSS
9. **No console.log spam** — Use `addLog()` for debug logging visible in the panel, keep console.log to a single init message

### Naming Conventions

- Script-level constants: `UPPER_SNAKE_CASE` (e.g., `SCRIPT_KEY`, `BUBBLE_ID`, `POLL_INTERVALS`)
- Functions: `camelCase` (e.g., `renderPanel`, `fetchDirectData`)
- DOM IDs: `tpda-[script]-[element]` (e.g., `tpda-war-log-toggle`)
- localStorage keys: `${SCRIPT_KEY}_[name]` (e.g., `tpda_safe_ai_bubble_v3_api_key`)
- STATE properties: `camelCase` (e.g., `STATE.userData`, `STATE.enemyMembers`)

### HTML Template Style

Panel HTML is built with template literals inside `renderPanel()`:

```javascript
body.innerHTML = `
    <div style="...">
        ${escapeHtml(someValue)}
    </div>
`;
```

- Inline styles only (no CSS classes) — keeps scripts self-contained
- Use the dark theme colors listed above
- Cards have `border:1px solid #2f3340; border-radius:10px; background:#141821`
- Buttons: `border:none; border-radius:8px; cursor:pointer`

### Event Handler Pattern

Event handlers are attached AFTER setting `innerHTML`:

```javascript
body.innerHTML = `...`;

const btn = document.getElementById('tpda-[script]-[btn]');
if (btn) {
    btn.onclick = () => { /* handler */ };
}
```

Never use inline `onclick="..."` in HTML strings.

---

## Adding a New Script

1. Create `torn-[name]-bubble.user.js` using the skeleton from [Script Architecture](#script-architecture)
2. Pick a unique `SCRIPT_KEY`, `BUBBLE_ID`, `PANEL_ID`, and `zIndexBase`
3. Include all shared utilities (copy from an existing script)
4. Include `PDA_INJECTED_KEY = '###PDA-APIKEY###'` if the script needs an API key
5. Include `addLog()` and the debug log UI section
6. Add `setTimeout(init, 1200)` at the bottom
7. Create `torn-[name].md` documentation following the existing format
8. Update `urls` file with: `https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/torn-[name]-bubble.user.js`
9. Update `README.md` scripts table
10. Update this `AGENTS.md` with the new script's reference info

---

## Adding a New Feature to an Existing Script

1. **Read the existing code first** — understand the STATE shape, renderPanel layout, and existing event handlers
2. **Add any new STATE properties** to the STATE object at the top
3. **Add processing logic** as a new function, don't modify existing functions unless necessary
4. **If reading user API data**, remember the [API response is flat](#torn-api-v1-response-format-critical) — use the normalized wrapper objects (`user.bars`, `user.battlestats`, `user.money`) or read from top-level keys directly
5. **Add UI** to `renderPanel()` — insert new cards/sections in the template literal
6. **Add event handlers** after `body.innerHTML = ...` in renderPanel
7. **Add `addLog()` calls** at key points (data received, errors, user actions)
8. **Update the script's `.md` doc** — add to features table, data sources, compliance table
9. **Update README.md** if the change affects the scripts table or compliance summary
10. **Update this `AGENTS.md`** if you learned something new or changed architecture

---

## Common Pitfalls

### PDA-Specific

- **`hookFetch`/`hookXHR` can't see PDA's native API calls.** If you need data from the API, make direct calls with the API key. Don't rely solely on interception.
- **`###PDA-APIKEY###` gets replaced EVERYWHERE in the source.** Don't put it in a comparison string — use a length/character check instead: `key.length >= 16 && !key.includes('#')`.
- **`PDA_httpGet` has a 2-second dedup.** Two calls to the same URL within 2 seconds will silently drop the second one.
- **`setTimeout(init, 1200)`** is needed because PDA injects at DOCUMENT_START, before the DOM is ready.

### General

- **`startX`/`startY` for drag should init as `null`, not `0`** — they're compared with `=== null` to detect first drag.
- **localStorage can fill up on mobile.** Always cap caches (200 items for price cache, 500 entries for timer tracks, 100 for logs) and add TTL expiry.
- **DOM scraping is fragile.** Torn changes page structure periodically. Use multiple selector strategies with fallbacks.
- **Torn's CSP blocks `eval()`.** PDA provides `PDA_evaluateJavascript()` as a workaround, but avoid needing it.
- **Multiple scripts coexist.** Use unique DOM IDs, unique z-index bases, and unique localStorage key prefixes.

### Torn API v1 Response Format (CRITICAL)

**The Torn API v1 does NOT nest data the way you'd expect from the selection name.** This has caused bugs before (energy showing 0/0). Here's the actual mapping:

| Selection | What the code might expect | What the API actually returns | Nested? |
|---|---|---|---|
| `bars` | `{ "bars": { "energy": {...} } }` | `{ "energy": {...}, "nerve": {...}, "happy": {...}, "life": {...} }` | **NO** — top level |
| `cooldowns` | `{ "cooldowns": { "drug": 0 } }` | `{ "cooldowns": { "drug": 0, "booster": 0, "medical": 0 } }` | **YES** — nested |
| `battlestats` | `{ "battlestats": { "strength": 100 } }` | `{ "strength": 100, "speed": 100, "dexterity": 100, "defense": 100 }` | **NO** — top level |
| `money` | `{ "money": { "cash": 1000 } }` | `{ "money_onhand": 1000, "vault_amount": 500 }` | **NO** — top level |
| `stocks` | `{ "stocks": {...} }` | `{ "stocks": { "1": {...} } }` | **YES** — nested |
| `profile` | `{ "profile": {...} }` | `{ "name": "...", "player_id": 123, "level": 50, ... }` | **NO** — top level |

### Torn API v2 Response Format Differences

Torn PDA and extensions like TornTools may intercept V2 API calls with different field structures:

| Field | V1 Format | V2 Format |
|---|---|---|
| Battle stats | `strength: 12345` (plain number at top level) | `battlestats.strength.value: 12345` (object with `.value`) |
| Money | `money_onhand: 1000` (top level) | `money.wallet: 1000` (nested) |
| Vault | `vault_amount: 500` (top level) | `money.cayman_bank: 500` (nested) |
| Profile life | `life: { current, maximum }` (top level) | `profile.life: { current, maximum }` (nested under profile) |
| Bars | Top-level objects | May already be nested under `bars` key |

### API Response Normalization in mergeUserData()

The `mergeUserData()` function in the AI Advisor handles **both V1 and V2 formats** using helper functions:

- **`asBar(v)`** — extracts a bar value. Accepts `{ current, maximum }` objects directly, or converts a plain number to `{ current: n, maximum: n }`. Returns null for invalid values.
- **`asStatNum(v)`** — extracts a numeric stat. Handles V1 plain numbers AND V2 `{ value: X }` objects.
- **Priority system** for each data type:
  1. Top-level fields (V1 format)
  2. Already-nested fields (V2 or previous merge)
  3. Profile-nested fields (V2 profile selection)

**The `_tpda=1` URL marker** prevents double-processing: the script tags its own API calls with `&_tpda=1`, and the fetch/XHR hooks skip URLs containing this marker.

**The `mergeUserData()` function in the AI Advisor normalizes this** by creating wrapper objects (`user.bars`, `user.battlestats`, `user.money`) from either V1 flat or V2 nested responses. If you add a new script that reads user data, either use the same normalization pattern or read from the correct keys directly.

---

## Verification & Testing

### Quick Syntax Check

```bash
# Node.js (if available)
node -c torn-assistant.user.js
node -c torn-pda-deal-finder-bubble.user.js
node -c torn-war-bubble.user.js
node -c torn-strip-poker-bubble.user.js

# Python fallback (bracket balance)
python3 -c "
for f in ['torn-assistant.user.js', 'torn-pda-deal-finder-bubble.user.js', 'torn-war-bubble.user.js', 'torn-strip-poker-bubble.user.js']:
    with open(f) as fh:
        content = fh.read()
    opens = content.count('{') + content.count('(') + content.count('[')
    closes = content.count('}') + content.count(')') + content.count(']')
    print(f'{f}: {\"OK\" if opens==closes else \"MISMATCH\"} ({opens}/{closes})')
"
```

### Manual Testing in Torn PDA

1. Copy the script into Torn PDA → Settings → Userscripts
2. Set match pattern to `https://www.torn.com/*`
3. Reload any Torn page
4. Check: bubble appears, panel opens on tap, data populates
5. Check the Debug Log section for errors or unexpected behavior
6. Use "Copy Log" to share log output for bug reports

### Manual Testing in Tampermonkey

1. Install Tampermonkey, create new script, paste contents
2. Navigate to torn.com
3. Open panel, enter API key manually
4. Verify data loads and panel renders correctly

### Things to Verify After Changes

- [ ] All scripts have balanced brackets (syntax check passes)
- [ ] Each script's `BUBBLE_ID`, `PANEL_ID`, and `zIndexBase` are unique
- [ ] `escapeHtml()` is used on all user-facing data
- [ ] No `eval()` calls
- [ ] No external server requests (only `api.torn.com`)
- [ ] `addLog()` calls at key points (init, API calls, errors)
- [ ] localStorage caches have size caps and TTL
- [ ] `urls` file is up to date
- [ ] Documentation files updated

---

## Git Workflow

- **Branch:** `main` only (no feature branches currently)
- **Remote:** `https://github.com/AlexTzib/Torn_Dark_tools.git`
- **Line endings:** LF
- **Commit messages:** Descriptive, focus on "why" not "what"
- **WSL note:** WSL has its own git config. Set user.name and user.email if needed.
- **Always update `urls`** when adding/renaming scripts

---

## Torn API Reference

### Base URLs

```
V1: https://api.torn.com/{section}/{id}?selections={selections}&key={apiKey}
V2: https://api.torn.com/v2/{section}/{id}?selections={selections}&key={apiKey}
```

> **Important:** Torn is actively migrating selections from v1 to v2-only. The `bazaar` and `itemmarket` selections on the `market` endpoint, and the `bounties` selection on the `torn` endpoint, are now v2-only (error code 23 on v1). See `docs/torn-api-patterns.md` for the full migration guide.

### Sections Used by These Scripts

| Section | Selections | Used By | Purpose |
|---|---|---|---|
| `user` | `bars,cooldowns,battlestats,stocks,money,profile` | AI Advisor | Player status, bars, cooldowns, money |
| `faction` | `basic` | AI Advisor, War Bubble, War Manager | Faction members, war status |
| `market` (v2) | `itemmarket` (via `/v2/market/{id}/itemmarket`) | Plushie Prices, Market Sniper | Item market floor and average prices per item |
| *(external)* | TornW3B `weav3r.dev/api/marketplace/{id}` | Plushie Prices, Market Sniper | Bazaar floor prices (no API key needed) |
| `torn` | (various, intercepted) | AI Advisor | Market data, item values |
| `torn` (v2) | `bounties` (via `/v2/torn/?selections=bounties`) | Bounty Filter | Current bounty list (v2-only since March 2025, returns array) |
| `user` (by ID) | `profile` | Bounty Filter, War Bubble, War Manager | Target state, timers, stat estimation |
| `user` (by ID) | `profile,personalstats,criminalrecord` | War Bubble, War Manager | Full profile for stat estimation |
| `user` | `travel,profile` | Traveler Utility | Travel status, destination, time remaining |

> **Note:** The Strip Poker Advisor makes no API calls — it is entirely client-side poker math.

### Rate Limits

- **~100 requests per minute** per API key
- Our scripts stay well under this:
  - AI Advisor: on-demand only (init + manual refresh)
  - War Bubble: configurable 30s–10min intervals, only when panel is open
  - War Manager: 2 faction calls + N profile scans (650ms gaps), configurable 30s–10min intervals
  - Plushie Prices: 13 calls per refresh, 250ms apart (~52/min), cached for 10 minutes
  - Market Sniper: 16 calls per scan, 300ms apart (~32/min), cached for 5 minutes
  - Traveler Utility: 1 call per 30s (~2/min), only when panel is open

### Key API Response Fields (Faction Basic)

```json
{
    "members": {
        "12345": {
            "name": "PlayerName",
            "last_action": {
                "status": "Online",
                "timestamp": 1234567890,
                "relative": "2 minutes ago"
            },
            "status": {
                "description": "In hospital for 1 hr 30 min",
                "state": "Hospital",
                "until": 1234567890
            },
            "position": "Member"
        }
    },
    "tag": "FAC",
    "name": "Faction Name",
    "war": { ... }
}
```

### Key API Response Fields (User)

**IMPORTANT:** Bars and stats are at the TOP LEVEL, not nested. See [Torn API v1 Response Format](#torn-api-v1-response-format-critical).

```json
{
    "energy": { "current": 100, "maximum": 150, "ticktime": 120, "fulltime": 3000, "interval": 600 },
    "nerve": { "current": 25, "maximum": 50, "ticktime": 180, "fulltime": 4500, "interval": 300 },
    "happy": { "current": 5000, "maximum": 10000, "ticktime": 300, "fulltime": 150000, "interval": 900 },
    "life": { "current": 1000, "maximum": 1000, "ticktime": 0, "fulltime": 0, "interval": 0 },
    "cooldowns": { "drug": 0, "booster": 0, "medical": 0 },
    "strength": 100000,
    "speed": 100000,
    "dexterity": 100000,
    "defense": 100000,
    "money_onhand": 1000000,
    "vault_amount": 500000,
    "points": 1234,
    "stocks": { "1": { "stock_id": 1, "total_shares": 1000, "benefit": {...} } },
    "name": "PlayerName",
    "player_id": 12345,
    "level": 50
}
```

**After `mergeUserData()` normalization**, the code can read these via wrapper objects:
- `user.bars.energy.current` (mapped from `user.energy.current` in V1, or `user.bars.energy.current` in V2)
- `user.battlestats.strength` (mapped from `user.strength` in V1, or `user.battlestats.strength.value` in V2)
- `user.money.cash_on_hand` (mapped from `user.money_onhand` in V1, or `user.money.wallet` in V2)
- `user.cooldowns.drug` (already nested — no mapping needed)
- `user.stocks` (already nested — no mapping needed)

---

## Community Research Reference

Key patterns learned from analyzing popular Torn community scripts (TornTools extension, Xoke scripts, tc-greasemonkey, etc.). Full details in `docs/torn-api-patterns.md` and `docs/community-repos.md`.

### Patterns Worth Adopting

| Pattern | Source | Description |
|---|---|---|
| `requireElement()` | TornTools | Promise-based polling (50ms intervals) that waits for DOM elements to appear. Essential for Torn's React SPA. |
| `observeChain()` | TornTools | Chained MutationObserver for deeply nested dynamic content |
| Event bus | TornTools | MutationObservers trigger custom events; features subscribe. Decouples detection from action |
| Fetch/XHR interception | TornTools, our scripts | Monkey-patch fetch/XHR to read API responses without modifying them |
| `dataset.end` timestamps | TornTools | Store absolute end-time instead of relative seconds for countdown timers (prevents desync when tab inactive) |
| `isTabFocused()` guard | TornTools | Only fire sensitive events when tab is visible |
| Virtual scroll handling | danielgoodwin97 | Programmatic scrolling to force render of virtualized list items |
| Retal monitoring | Xoke | Monitor `api.torn.com/faction/{id}?selections=attacks` for unretaliated attacks |
| `GM_xmlhttpRequest` | Xoke, tc-greasemonkey | Cross-origin API calls in Tampermonkey/Greasemonkey (not needed in PDA) |

### Real Torn DOM Selectors (verified from TornTools source)

| Element | Selector |
|---|---|
| Item market items | `[class*='itemList___'] > li` |
| Item price | `[class*='priceAndTotal___'] span:first-child` |
| Faction members | `.members-list .table-body > li` |
| Drug cooldown | `[aria-label^='Drug Cooldown:']` |
| Booster cooldown | `[aria-label^='Booster Cooldown:']` |
| Medical cooldown | `[aria-label^='Medical Cooldown:']` |
| Page loading | `.react-loading-skeleton` |
| Chat root | `#chatRoot` |
| Content wrapper | `.content-wrapper[role="main"]` |
| Holdem: player hand | `[class*="playerMeGateway"] [class*="hand"] [class*="card"] [class*="front"] > div` |
| Holdem: community | `[class*="communityCards"] [class*="front"] > div` |
| Holdem: opponents | `[class*="opponent"]` |

> **Note:** Torn uses CSS modules with hash suffixes (e.g., `itemList___abc123`). Use `[class*='itemList___']` partial match selectors instead of exact class names.

---

## Quick Reference Card

| What | How |
|---|---|
| Get API key | `PDA_INJECTED_KEY` → `getManualApiKey()` → intercepted from traffic |
| Make API call | `fetch('https://api.torn.com/user/?selections=bars&key=' + STATE.apiKey)` |
| Escape HTML | `escapeHtml(str)` — always use for display |
| Log an event | `addLog('message here')` |
| Store data | `setStorage(SCRIPT_KEY + '_mykey', value)` |
| Read data | `getStorage(SCRIPT_KEY + '_mykey', defaultValue)` |
| Check if in PDA | `PDA_INJECTED_KEY.length >= 16 && !PDA_INJECTED_KEY.includes('#')` |
| Use PDA native HTTP | `PDA_httpGet(url, headers)` — returns Promise (only available in PDA) |
