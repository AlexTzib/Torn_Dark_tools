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
├── urls                                   ← Raw GitHub URLs for Torn PDA remote loading
├── docs/
│   ├── torn-api-patterns.md               ← Torn API patterns, DOM selectors, community research
│   └── community-repos.md                 ← Community Torn script repos analysis & learnings
├── torn-assistant.user.js                 ← AI Advisor bubble (~1517 lines)
├── torn-assistant.md                      ← AI Advisor documentation
├── torn-pda-deal-finder-bubble.user.js    ← Deal Finder bubble (~968 lines)
├── torn-pda-deal-finder-bubble.md         ← Deal Finder documentation
├── torn-war-bubble.user.js                ← War Bubble (~1249 lines)
└── torn-war-bubble.md                     ← War Bubble documentation
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
3. Scripts are injected at `DOCUMENT_START` time.

### PDA-Provided JavaScript Globals

PDA injects several handler scripts before userscripts run:

| Global | Purpose | Notes |
|---|---|---|
| `PDA_httpGet(url, headers)` | Makes a native HTTP GET request through Flutter (bypasses WebView CORS) | Returns a Promise with `{ responseHeaders, responseText, status, statusText }`. Has a 2-second dedup per URL. |
| `PDA_httpPost(url, headers, body)` | Native HTTP POST through Flutter | Same return shape as `PDA_httpGet`. 2-second dedup. |
| `PDA_evaluateJavascript(source)` | Evaluates JS source code in the WebView context | Useful for dynamically loaded code (eval is blocked by Torn's CSP). |
| `window.__tornpda.tab.uid` | Unique ID for the current PDA tab | Read-only. |
| `GM_getValue`, `GM_setValue`, etc. | GreaseMonkey API compatibility layer | Uses `localStorage` under the hood. Provided by PDA's `handler_GM()`. |
| `GM.xmlHttpRequest` | GreaseMonkey XHR compatibility | Routes through `PDA_httpGet`/`PDA_httpPost` internally. |

### Key PDA Behavior to Know

- **PDA makes API calls natively** (via Flutter/Dart HTTP), NOT through the WebView's `fetch()` or `XMLHttpRequest`. This means `hookFetch()`/`hookXHR()` interception **cannot see PDA's own API traffic**. This is why we added direct API fetching with `###PDA-APIKEY###`.
- **`###PDA-APIKEY###` replacement** happens as a simple string replace on the entire script source before injection. Any occurrence of that exact string gets replaced. To detect if PDA replaced it, check: `PDA_INJECTED_KEY.length >= 16 && !PDA_INJECTED_KEY.includes('#')`.
- **PDA WebView is Flutter InAppWebView** — it supports standard Web APIs but has some quirks with `eval()` (blocked by CSP), popup windows, and download handling.
- **The `flutterInAppWebViewPlatformReady` event** fires when the native bridge is ready. `PDA_httpGet` waits for this internally.
- **Script injection timing:** PDA injects at `DOCUMENT_START`, before the page DOM is ready. Our scripts use `setTimeout(init, 1200)` to ensure the DOM is available.
- **PDA remote loading:** PDA can load scripts from URLs. The `urls` file in the repo root lists the raw GitHub URLs for each script. When adding/renaming a script, update this file.

### PDA Source Code Reference

Key files in the [Torn PDA repo](https://github.com/Manuito83/torn-pda):
- `lib/providers/userscripts_provider.dart` — Script management, `adaptSource()` (API key replacement), injection logic
- `lib/utils/js_snippets/js_handlers.dart` — `handler_pdaAPI()` (PDA_httpGet/Post), `handler_GM()` (GreaseMonkey compat), `handler_flutterPlatformReady()`
- `lib/utils/js_snippets/js_snippets.dart` — Other injected JS (buy max abroad, etc.)
- `lib/widgets/webviews/webview_full.dart` — Main WebView widget, script injection hooks

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
| War Bubble | 999970 | `tpda-war-online-bubble` | `tpda-war-online-panel` |
| Deal Finder | 999980 | `tpda-deal-finder-bubble` | `tpda-deal-finder-panel` |
| AI Advisor | 999990 | `tpda-safe-ai-bubble` | `tpda-safe-ai-panel` |

When adding a new script, pick a z-index base that doesn't collide (e.g., 999960).

### localStorage Keys

Each script prefixes its keys with `SCRIPT_KEY`:

| Script | SCRIPT_KEY | Keys Used |
|---|---|---|
| AI Advisor | `tpda_safe_ai_bubble_v3` | `_api_key`, `_bubble_pos`, `_panel_pos` |
| Deal Finder | `tpda_deal_finder_bubble_v1` | `_bubble_pos`, `_panel_pos`, `_price_cache` |
| War Bubble | `tpda_war_online_location_timers_bubble_v3` | `_api_key`, `_bubble_pos`, `_panel_pos`, `_enemy_faction_id`, `_timer_track`, `_poll_interval` |

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

### Deal Finder (`torn-pda-deal-finder-bubble.user.js`)

**Purpose:** Item Market / Bazaar flip-profit calculator.

**Key functions:**
- `scanCurrentPage()` — Detects page context (item market vs bazaar), scrapes DOM listings, calculates deals
- `scrapeListingsFromDom()` — Extracts prices from visible page elements (targeted selectors first, broad fallback)
- `updatePriceCache(itemKey, context, floor)` — Caches floor prices per item (max 200, 7-day TTL)
- `handleApiPayload(url, data)` — Processes passively intercepted API responses

**Data flow:**
1. No API key needed
2. `hookFetch`/`hookXHR` intercepts user/torn API responses for market values
3. User clicks Refresh → `scanCurrentPage()` scrapes DOM
4. Deals calculated: `net_sell = gross × 0.95`, profit = net_sell - buy_price
5. Color-coded: green (>$500k), yellow (positive), red (negative)

**No direct API calls.** Pure DOM scraping + passive interception.

### War Bubble (`torn-war-bubble.user.js`)

**Purpose:** Enemy faction online tracker with location buckets, timer analysis, attack buttons.

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

# Python fallback (bracket balance)
python3 -c "
for f in ['torn-assistant.user.js', 'torn-pda-deal-finder-bubble.user.js', 'torn-war-bubble.user.js']:
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

### Base URL

```
https://api.torn.com/{section}/{id}?selections={selections}&key={apiKey}
```

### Sections Used by These Scripts

| Section | Selections | Used By | Purpose |
|---|---|---|---|
| `user` | `bars,cooldowns,battlestats,stocks,money,profile` | AI Advisor | Player status, bars, cooldowns, money |
| `faction` | `basic` | AI Advisor, War Bubble | Faction members, war status |
| `torn` | (various, intercepted) | AI Advisor, Deal Finder | Market data, item values |

### Rate Limits

- **~100 requests per minute** per API key
- Our scripts stay well under this:
  - AI Advisor: on-demand only (init + manual refresh)
  - War Bubble: configurable 30s–10min intervals, only when panel is open
  - Deal Finder: zero direct API calls

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
