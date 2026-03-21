# Torn API Patterns & DOM Selectors Reference

## Torn API Overview

- **Base URL:** `https://api.torn.com/`
- **V1 format:** `https://api.torn.com/{type}/{id}?selections={selections}&key={key}`
- **V2 format:** Has Swagger docs at `https://www.torn.com/swagger/index.html`, uses `Authorization: ApiKey {key}` header
- **Rate limit:** 100 requests per minute per user across all keys
- **Key access levels:** Public, Minimal, Limited, Full

---

## V1 API Response Formats

### User Selections

#### `bars`

Returns energy/nerve/happy/life at top level:

```json
{
  "energy": { "current": 150, "maximum": 150, "increment": 5, "interval": 600, "ticktime": 480, "fulltime": 0 },
  "nerve": { "current": 55, "maximum": 55, "increment": 1, "interval": 300, "ticktime": 60, "fulltime": 0 },
  "happy": { "current": 3500, "maximum": 5000, "increment": 5, "interval": 900, "ticktime": 300, "fulltime": 270000 },
  "life": { "current": 7500, "maximum": 7500, "increment": 135, "interval": 300, "ticktime": 180, "fulltime": 0 },
  "chain": { "current": 0, "timeout": 0 }
}
```

#### `cooldowns`

```json
{
  "cooldowns": { "drug": 0, "booster": 0, "medical": 0 }
}
```

#### `battlestats`

Returns plain numbers at top level in V1:

```json
{
  "strength": 12345678,
  "speed": 12345678,
  "dexterity": 12345678,
  "defense": 12345678,
  "strength_modifier": 0,
  "defense_modifier": 0,
  "speed_modifier": 0,
  "dexterity_modifier": 0,
  "strength_info": [],
  "defense_info": [],
  "speed_info": [],
  "dexterity_info": []
}
```

#### `money`

```json
{
  "points": 5000,
  "cayman_bank": 0,
  "vault_amount": 0,
  "company_funds": 0,
  "daily_networth": 50000000,
  "money_onhand": 1000000,
  "city_bank": { "amount": 0, "time_left": 0 }
}
```

#### `profile`

Complex object with life data, status, etc.

```json
{
  "rank": "Lordly",
  "level": 75,
  "player_id": 12345,
  "name": "PlayerName",
  "life": { "current": 7500, "maximum": 7500 },
  "status": { "description": "Okay", "details": "", "state": "Okay", "color": "green", "until": 0 },
  "last_action": { "timestamp": 1234567890, "status": "Online", "relative": "2 minutes ago" }
}
```

#### `stocks`

Returns object keyed by stock ID.

### Faction Selections

#### `basic`

Faction info, members, wars data.

#### `attacks`

Attack history used for retal monitoring.

---

## V2 API Differences

Note that V2 uses different field structures:

- **battlestats:** `{ strength: { value: X }, speed: { value: X }, ... }` (objects with `.value` instead of plain numbers)
- **money:** `{ wallet: X, city_bank: { until: X } }` (`wallet` instead of `money_onhand`)
- **profile:** `{ profile: { life: { current, maximum }, status: {...}, ... } }` (nested under `profile` key)

### V2 Market Endpoint (bazaar & itemmarket)

As of early 2025, the `bazaar` and `itemmarket` selections on the `market` endpoint are **v2-only** (error code 23 on v1).

**V1 (no longer works for bazaar/itemmarket):**
```
GET https://api.torn.com/market/{itemId}?selections=bazaar,itemmarket&key={key}
→ { "bazaar": [{ "cost": 12345, "quantity": 1 }, ...], "itemmarket": [{ "cost": 12345, "quantity": 1 }, ...] }
```

**V2 (current):**
```
GET https://api.torn.com/v2/market/{itemId}?selections=bazaar,itemmarket&key={key}
→ { "bazaar": { "listings": [{ "price": 12345, "quantity": 1 }, ...] }, "itemmarket": { "listings": [{ "price": 12345, "quantity": 1 }, ...] } }
```

**Key differences:**
- URL base changes from `api.torn.com/` to `api.torn.com/v2/`
- Response wraps arrays in `{ listings: [...] }` objects
- Field name changes from `.cost` to `.price`
- V2 also supports header auth: `Authorization: ApiKey {key}` (query param `?key=` still works)

**Error code 23** = "This selection is only available in API v2" — signals that a selection has been migrated and the v1 endpoint no longer serves it.

### V2 Torn Bounties Endpoint

As of March 2025, the `bounties` selection on the `torn` endpoint is **v2-only** (error code 23 on v1).

**V1 (no longer works):**
```
GET https://api.torn.com/torn/?selections=bounties&key={key}
→ { "bounties": { "id1": { "target_id": 123, "target_name": "...", ... }, "id2": {...} } }
```
Response was an **object** keyed by bounty ID.

**V2 (current):**
```
GET https://api.torn.com/v2/torn/?selections=bounties&key={key}
→ {
    "bounties": [
      { "target_id": 123, "target_name": "...", "target_level": 50, "lister_id": 456,
        "lister_name": "...", "reward": 1000000, "reason": "...", "quantity": 1,
        "is_anonymous": false, "valid_until": 1234567890 },
      ...
    ],
    "bounties_timestamp": 1234567890,
    "_metadata": { ... }
  }
```

**Key differences:**
- URL: `api.torn.com/torn/` → `api.torn.com/v2/torn/`
- Response structure: `bounties` changes from **object** (keyed by ID) to **array** of bounty objects
- No bounty ID in response — array index only
- `is_anonymous` is boolean (`true`/`false`) instead of `0`/`1`
- New fields: `reason` (string|null), `valid_until` (unix timestamp)
- Field names: `lister_id`/`lister_name` (v1 used `listed_by`/`listed_by_name` in some contexts)
- Supports `limit` and `offset` query parameters for pagination (default limit 100)

**Defensive parsing pattern:**
```javascript
const raw = data?.bounties || data;
if (Array.isArray(raw)) {
  // V2 array format
  for (const b of raw) { ... }
} else if (raw && typeof raw === 'object') {
  // V1 object format (fallback)
  for (const [id, b] of Object.entries(raw)) { ... }
}
```

### V2 Migration Checklist

When migrating a script from v1 to v2:
1. Change URL: `api.torn.com/{section}` → `api.torn.com/v2/{section}`
2. Check response structure — arrays may be wrapped in `{ listings: [...] }` or nested under new keys
3. Check field names — `cost` → `price`, `money_onhand` → `wallet`, etc.
4. Test defensively: `Array.isArray(data.field) ? data.field : data.field?.listings || []`
5. Normalize field names: `e.price ?? e.cost` to support both formats during transition

---

## Torn PDA Internals (from source code analysis)

This section documents how Torn PDA works internally, based on reading the actual Dart/JS source code in the [torn-pda repo](https://github.com/Manuito83/torn-pda). Understanding these internals is critical for writing scripts that work seamlessly inside PDA.

### PDA Script Injection Order

PDA injects handler scripts in this exact order, all at `DOCUMENT_START`:

1. **`handler_tabContext(tabUid)`** — Sets `window.__tornpda.tab.uid` and `window.__tornpda.tab.state`
2. **`handler_flutterPlatformReady()`** — Creates `__PDA_platformReadyPromise` (resolves when Flutter bridge is ready)
3. **`handler_pdaAPI()`** — Defines `PDA_httpGet()` and `PDA_httpPost()`
4. **`handler_GM()`** — Defines all GM_* compatibility functions (by Kwack [2190604])
5. **`handler_evaluateJS()`** — Defines `PDA_evaluateJavascript()` (eval replacement)
6. **User scripts** — Injected via `getCondSources()`, wrapped in IIFE, API key replaced

### `adaptSource()` Implementation

The function that prepares userscript source before injection:

```dart
String adaptSource({required String source, required String scriptFinalApiKey}) {
  final String withApiKey = source.replaceAll("###PDA-APIKEY###", scriptFinalApiKey);
  String anonFunction = "(function() {$withApiKey}());";
  // Also replaces curly quotes with straight quotes
  anonFunction = anonFunction.replaceAll(RegExp(r'[""]'), '"').replaceAll(RegExp(r'['']'), "'");
  return anonFunction;
}
```

**Key details:**
- `###PDA-APIKEY###` replacement happens on the ENTIRE source string (every occurrence)
- Script is wrapped in an IIFE: `(function() { ...source... }());`
- Curly/smart quotes are normalized to straight quotes (prevents copy-paste issues)
- If the script has a custom API key configured in PDA settings, that key is used instead of the user's main key

### PDA Custom API Key Per Script

PDA allows each script to have its own API key:
```dart
scriptFinalApiKey: s.customApiKey.isNotEmpty ? s.customApiKey : pdaApiKey
```
If `customApiKey` is set in PDA's script settings, it overrides the user's main API key for that specific script only.

### PDA_httpGet Dedup Details

From `handler_pdaAPI()` source:

```javascript
async function PDA_httpGet(url, headers = {}) {
  let now = Date.now();
  // Dedup key is URL only (headers are NOT part of the key for GET)
  if (loadedPdaApiGetUrls[url] && (now - loadedPdaApiGetUrls[url] < 2000)) {
    return; // Silently returns undefined
  }
  loadedPdaApiGetUrls[url] = now;
  await __PDA_platformReadyPromise;
  return window.flutter_inappwebview.callHandler("PDA_httpGet", url, headers);
}
```

**Critical behavior:**
- **GET dedup key = URL only** (headers are ignored for dedup purposes)
- **POST dedup key = url + JSON.stringify(headers) + body**
- Dedup window is **2 seconds** (not 1 second as some docs say)
- Within 2 seconds, the second call **silently returns `undefined`** (no error thrown)
- Both functions `await __PDA_platformReadyPromise` internally, so calling them before platform ready is safe (they queue)

### PDA Tab Context

```javascript
window.__tornpda.tab = {
  uid: 'unique-tab-id',           // Read-only, set via Object.defineProperty
  state: {
    uid: 'unique-tab-id',
    isActiveTab: false,            // Whether this tab is the active/focused tab
    isWebViewVisible: false        // Whether the WebView is currently visible
  }
};
```

**Useful for:**
- `window.__tornpda.tab.state.isActiveTab` — could be used like `isTabFocused()` to skip processing when tab is inactive
- `window.__tornpda.tab.uid` — unique identifier for each PDA browser tab

### GM Handler Implementation (by Kwack [2190604])

PDA provides a full GM (Greasemonkey) compatibility layer. Key implementation details:

**Storage format:**
- Values stored in localStorage with `GMV2_` prefix + JSON serialization
- `GM_getValue('key')` → reads `localStorage.getItem('key')`, strips `GMV2_` prefix, JSON-parses the rest
- `GM_setValue('key', value)` → writes `localStorage.setItem('key', 'GMV2_' + JSON.stringify(value))`

**GM.xmlHttpRequest implementation:**
- Routes through `PDA_httpGet` / `PDA_httpPost` internally
- Default timeout: **30 seconds** (via AbortController)
- Supports `onload`, `onerror`, `onabort`, `ontimeout`, `onprogress`, `onreadystatechange` callbacks
- Returns an object with `.abort()` method
- Two AbortControllers: one for user abort, one for timeout

**Available GM functions:**
| Function | Implementation |
|---|---|
| `GM.getValue(key, default)` | async, reads from localStorage with GMV2_ prefix |
| `GM.setValue(key, value)` | async, writes to localStorage with GMV2_ prefix |
| `GM.deleteValue(key)` | async, removes from localStorage |
| `GM.listValues()` | async, returns all localStorage keys |
| `GM.xmlHttpRequest(details)` | async, routes through PDA_httpGet/Post |
| `GM.notification(details)` | Uses `confirm()` dialog |
| `GM_info` | Returns `{ script: {}, scriptHandler: "GMforPDA version 2.2", version: 2.2 }` |
| `GM_getValue(key, default)` | sync version |
| `GM_setValue(key, value)` | sync version |
| `GM_deleteValue(key)` | sync version |
| `GM_listValues()` | sync version |
| `GM_addStyle(css)` | Creates `<style>` element in `<head>` |
| `GM_notification(...)` | Supports both object and positional arguments |
| `GM_setClipboard(text)` | Uses `navigator.clipboard.writeText()` |
| `GM_xmlhttpRequest(details)` | sync version, returns `{ abort: fn }` |
| `unsafeWindow` | Set to `window` |

**Note:** All GM globals are frozen (`Object.freeze`) and non-writable (`writable: false, configurable: false`).

### PDA_evaluateJavascript

```javascript
async function PDA_evaluateJavascript(source) {
  // 2-second dedup per source string
  if (loadedPdaApiEvalScripts[source] && (Date.now() - loadedPdaApiEvalScripts[source] < 2000)) {
    return;
  }
  loadedPdaApiEvalScripts[source] = Date.now();
  await __PDA_platformReadyPromise;
  return flutter_inappwebview.callHandler("PDA_evaluateJavascript", source);
}
```

Use case: `eval()` is blocked by Torn's CSP. If you need to execute dynamically-loaded code, fetch it with `PDA_httpGet` then pass to `PDA_evaluateJavascript`.

### PDA Built-In JS Snippets

PDA injects its own JS snippets for various features. These are NOT userscripts — they're built into the app. But knowing their selectors and patterns is valuable.

#### Travel-Related Snippets

**`travelRemovePlaneJS()`** — Hides flight animation elements:
```css
.travel-agency-travelling .stage,
.travel-agency-travelling .popup-info,
[class^="airspaceScene___"][class*="outboundFlight___"],
[class^="airspaceScene___"][class*="returnFlight___"],
[class^="randomFact___"],
[class^="randomFactWrapper___"],
[class^="delimiter-"]
{ display: none !important; }
```

**`travelReturnHomeJS()`** — Clicks the "Return Home" button:
```javascript
let travelHome = document.querySelector('.travel-home-header-button');
if (travelHome) {
  travelHome.click();
  setTimeout(function() {
    let confirmBtn = document.querySelector('#travel-home-panel button.torn-btn');
    if (confirmBtn) confirmBtn.click();
  }, 1000);
}
```

#### Abroad Shop Selectors (from `buyMaxAbroadJS()`)

These are the actual DOM selectors PDA uses for abroad shops:

| Element | Selector | Notes |
|---|---|---|
| User money | `#user-money` or `[data-currency-money]` | `.getAttribute('data-money')` for numeric value |
| Buy buttons | `button.torn-btn[type="submit"]` | Must be inside an `<li>` (prevents Bank page injection) |
| Item rows | `[class*="row___"]` | Both horizontal and vertical layouts |
| Stock header | `[class*="stockHeader___"]` | Column header row |
| Item name | `[class*="itemName___"]` | Item name cell |
| Buy cell | `[class*="buyCell___"]` | Buy quantity/button cell |
| Stock count (horiz) | `[class*="tabletColC___"]` | Stock quantity in horizontal mode |
| Stock count (vert) | `[class*="inlineStock___"]` | Pattern: `x{number}` |
| Buy panel (vert) | `div[class*="buyPanel___"]` | Contains price question |
| Price question | `p[class*="question___"]` | "How many at $X each?" |
| Capacity message | `.messageContent___*` | Pattern: `purchased N / M` |
| Items bar | `[class*="items-"]` | Pattern: `N / M` (items capacity) |
| Quantity input | `input.input-money` | Has `data-money` attribute for max |
| Basket button | `button[class*="buyIconButton___"]` | Shopping cart icon |

**Layout detection:** PDA detects horizontal vs vertical mode by:
1. Checking for visible "TYPE" column header in `[class*="itemsHeader___"] > div`
2. Checking buy button text (horizontal = "BUY", vertical = different)
3. Fallback: `window.innerWidth > 700` = horizontal

**React input hack:** PDA dispatches proper React events when setting input values:
```javascript
input.value = max;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

#### Bazaar Selectors (from `addOthersBazaarFillButtonsJS()`)

| Element | Selector |
|---|---|
| Item amount | `[class*='amountValue_'], [class*='amount___']` |
| Item price | `[class*='price___']` |
| User money | `#user-money` (with `data-money` attribute) |
| Buy input | `input[class*='buyAmountInput_']` |
| Buy button | `button[class*='buy___'], button[class*='activate-buy-button']` |
| Item container | `[class*='item___'], [class*='rowItems_']` |
| Wide popup field | `div[class*="field___"]` |

#### City Item Map (from `highlightCityItemsJS()`)

```javascript
// Find items on the city map
for (let el of document.querySelectorAll("#map .leaflet-marker-pane *")) {
  let src = el.getAttribute("src");
  if (src.indexOf("/images/items/") > -1) {
    el.classList.add("pdaCityItem");
  }
}
```

Map uses Leaflet.js; items are `<img>` elements in `#map .leaflet-marker-pane` with src containing `/images/items/`.

#### Chat Selectors (from `chatHighlightJS()`)

| Element | Selector |
|---|---|
| Chat root | `#chatRoot` |
| Chat list buttons | `[class*='chat-list-button__']` |
| Chat message boxes | `[class*='chat-box-body__'] [class*='chat-box-message__box__']` |
| Chat box body | `[class*='chat-box-body__']` |

#### Jail Selectors (from `jailJS()`)

| Element | Selector |
|---|---|
| Player list | `.users-list > li` |
| Level | `.level` (text: "Level X" or "LEVEL: X") |
| Time remaining | `.time` (text: "Time: Xh Ym Zs") |
| Player name | `.user.name` |
| Bail action | `.buy, .bye` |
| Bail icon | `.bye-icon` |
| Bust action | `.bust` |
| Bust icon | `.bust-icon` |
| Content wrapper | `.content-wrapper` |
| Page gallery | `.gallery-wrapper` |

**Bail/Bust quick action:** Appending "1" to the action link URL performs a quick bail/bust.

#### Bounty Selectors (from `bountiesJS()`)

| Element | Selector |
|---|---|
| Bounty list | `.bounties-list > li:not(.clear)` |
| Level | `.level` |
| Unavailable (hospital) | `.user-red-status` |
| Unavailable (abroad/jail) | `.user-blue-status` |
| Content wrapper | `.content-wrapper` |
| Page gallery | `.gallery-wrapper` |

### PDA Script Match Pattern System

PDA determines whether to inject a script based on URL match patterns from the userscript `@match` header:
```dart
bool shouldInject(String url, [UserScriptTime? time]) {
  // Parses @match patterns from script header
  // Supports wildcards: https://www.torn.com/*
  // Can also match specific pages: https://www.torn.com/page.php*
}
```

### PDA Global Disable Feature

PDA has a "Global Disable" toggle that disables all userscripts at once:
- Saves each script's enabled state before disabling
- Restores original states when re-enabled
- Any manual script change while globally disabled resets the feature

### PDA Script Update System

PDA tracks script update status:
- `noRemote` — script has no remote URL
- `upToDate` — matches remote version
- `localModified` — local edits after last remote sync
- Scripts can be loaded from URLs and auto-updated

### iOS Compatibility Note

All PDA JS snippets end with `// Return to avoid iOS WKErrorDomain 123;` or just `123;`. This prevents WKWebView errors on iOS when the script doesn't return a value.

---

## Torn Internal Global Variables

### `window.topBannerInitData`

Torn stores some user data in a global JS object accessible without API calls:

```javascript
const stamp = window.topBannerInitData &&
              window.topBannerInitData.user &&
              window.topBannerInitData.user.data &&
              window.topBannerInitData.user.data.hospitalStamp;
```

**Known fields (needs further exploration):**
- `window.topBannerInitData.user.data.hospitalStamp` — Hospital end timestamp
- Potentially more user status data (energy, nerve, etc.) — needs investigation

**Use case:** Get instant hospital status without an API call (zero-cost, zero-latency).

### RFCV Token (CSRF Protection)

Torn uses an RFCV token for internal POST requests. Extract from cookies:

```javascript
const getRfcvToken = () => {
  const match = document.cookie.match(/rfc_v=([^;]+)/);
  return match ? match[1] : null;
};
```

**Required for:** Any POST to Torn's internal endpoints (e.g., `/factions.php`, `/inventory.php`). Not needed for public API calls.

Example usage:
```javascript
const body = new URLSearchParams({
  step: 'armouryTabContent',
  type: 'utilities',
  start: '0',
  ajax: 'true'
});
await fetch(`https://www.torn.com/factions.php?rfcv=${rfcv}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest'
  },
  body,
  credentials: 'same-origin'
});
```

---

## Common API Patterns from Community Scripts

### Fetch Interception (TornTools pattern)

Hook `window.fetch` and `XMLHttpRequest` to intercept API responses made by the Torn website itself. This lets scripts get data without making their own API calls.

### TornW3B — Third-Party Bazaar Prices

The Torn API v2 `bazaar` selection returns a bazaar *directory* (store names/stats), NOT per-item price listings. To get bazaar floor prices for specific items, use the **TornW3B** service (same approach used by TornTools):

```
GET https://weav3r.dev/api/marketplace/{itemId}
```

Response:
```json
{
  "item_id": 186,
  "item_name": "Sheep Plushie",
  "market_price": 600,
  "bazaar_average": 599,
  "total_listings": 840,
  "listings": [
    { "item_id": 186, "player_id": 123, "player_name": "Someone", "quantity": 2, "price": 579, "content_updated": 1773911313, "last_checked": 1773911313 },
    ...
  ]
}
```

- **No API key required**
- Listings sorted by price ascending (first = cheapest)
- `bazaar_average` is the average across all bazaar listings
- `content_updated` / `last_checked` are Unix timestamps

### API Key Sources

1. **Torn PDA injection:** `###PDA-APIKEY###` placeholder replaced at runtime
2. **Manual entry:** User provides key in UI, stored in `localStorage`
3. **URL extraction:** Parse API key from intercepted API call URLs

### GM_xmlhttpRequest (Tampermonkey pattern)

For cross-origin API calls from userscripts:

```javascript
GM_xmlhttpRequest({
  method: 'GET',
  url: `https://api.torn.com/user/?selections=bars&key=${apiKey}`,
  onload: function(response) {
    const data = JSON.parse(response.responseText);
  }
});
```

### Internal Torn Endpoints

- **Inventory:** `fetch('/inventory.php?rfcv=' + unsafeWindow.getRFC(), ...)`
- **Market:** `/imarket.php`, `/bazaar.php`
- These use Torn's internal RFCV (CSRF) token

---

## Real Torn DOM Selectors

### Item Market

| Element | Selector |
|---|---|
| Item list container | `[class*='itemList___'] > li` |
| Item price | `[class*='priceAndTotal___'] span:first-child` |
| Market search | `[class*='searchBar___']` |

### Faction Page

| Element | Selector |
|---|---|
| Members list | `.members-list .table-body > li` |
| War info | `.faction-war`, `[class*='warStatus___']` |

### Profile / Status

| Element | Selector |
|---|---|
| Drug cooldown | `[aria-label^='Drug Cooldown:']` |
| Booster cooldown | `[aria-label^='Booster Cooldown:']` |
| Medical cooldown | `[aria-label^='Medical Cooldown:']` |

### General

| Element | Selector |
|---|---|
| Page loading skeleton | `.react-loading-skeleton` |
| Chat root | `#chatRoot` |
| Content wrapper | `.content-wrapper[role="main"]` |
| Header | `[class*='header___']` |

### Navigation

| Element | Selector |
|---|---|
| Sidebar links | `[class*='menuItem___']`, `.sidebar [class*='link___']` |
| Area links | `.area-desktop___`, `[class*='area___']` |

---

## Key Development Patterns

### `requireElement()` Pattern (from TornTools)

Promise-based polling for dynamic DOM elements:

```javascript
function requireElement(selector, options = {}) {
  return new Promise((resolve, reject) => {
    let count = 0;
    const maxCount = options.maxCycles || 1000;
    const interval = options.interval || 50;
    const check = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (++count >= maxCount) return reject(new Error('Element not found: ' + selector));
      setTimeout(check, interval);
    };
    check();
  });
}
```

### Countdown Timer Pattern

Use absolute timestamps (`dataset.end = Date.now() + seconds * 1000`) instead of relative seconds to prevent desync when tab is inactive.

### Anti-scrape Protection

Only fire sensitive events when tab is focused:

```javascript
function isTabFocused() { return !document.hidden; }
```

### Feature Registration Pattern (TornTools)

```javascript
featureManager.registerFeature(name, scope, enabled, init, execute, cleanup, storage, requirements, options)
```

### Virtual Scroll Handling

Torn uses virtualized lists. To access all items, programmatically scroll to force rendering of off-screen elements.

---

## Error Codes

| Code | Description |
|---:|---|
| 0 | Unknown error |
| 1 | Key is empty |
| 2 | Incorrect Key |
| 3 | Wrong type |
| 4 | Wrong fields (invalid selection) |
| 5 | Too many requests (rate limited) |
| 6 | Incorrect ID |
| 7 | Incorrect ID-entity relation (private data) |
| 8 | IP block |
| 9 | API disabled |
| 10 | Key owner in federal jail |
| 13 | Key disabled due to owner inactivity (7+ days offline) |
| 16 | Key access level too low |
| 17 | Backend error |
| 18 | API key paused by owner |
