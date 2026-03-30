# common.js — Shared API Reference

> **Location:** `src/common.js`
> Injected by `build.py` at the `// #COMMON_CODE` marker inside each script's IIFE.

Every function, constant, and pattern below is available to **all** scripts
after the common code is injected. Scripts must define these variables
**before** the `// #COMMON_CODE` marker:

| Required variable | Type     | Purpose |
|-------------------|----------|---------|
| `SCRIPT_KEY`      | `string` | Unique localStorage key prefix for each script |
| `BUBBLE_ID`       | `string` | DOM id for the floating bubble element |
| `PANEL_ID`        | `string` | DOM id for the expandable panel element |
| `HEADER_ID`       | `string` | DOM id for the draggable panel header |
| `BUBBLE_SIZE`     | `number` | Bubble diameter in px (typically `56`) |
| `STATE`           | `object` | Must include `{ ui: { minimized: true, zIndexBase: N }, _logs: [] }` |
| `PDA_INJECTED_KEY`| `string` | Set to `'###PDA-APIKEY###'` for Torn PDA injection |

---

## Table of Contents

1. [Utility Functions](#utility-functions)
2. [Storage](#storage)
3. [Logging](#logging)
4. [API Key Management](#api-key-management)
5. [API Key UI Components](#api-key-ui-components)
6. [Debug Log UI Components](#debug-log-ui-components)
7. [Bubble & Panel UI](#bubble--panel-ui)
8. [Draggable Behavior](#draggable-behavior)
9. [Expand / Collapse / Resize](#expand--collapse--resize)
10. [Network Interception](#network-interception)
11. [API Calls](#api-calls)
12. [Stat Estimation](#stat-estimation)
13. [Profile Cache](#profile-cache)
14. [Cross-Origin HTTP](#cross-origin-http)
15. [Profit Calculator](#profit-calculator)
16. [Notifications](#notifications)
17. [Member Data Processing](#member-data-processing)
18. [War-Shared Helpers](#war-shared-helpers)
19. [Faction War Detection](#faction-war-detection)
20. [DOM Helpers](#dom-helpers)
21. [Input Validation](#input-validation)
22. [Page Data Access](#page-data-access)
23. [Script Lifecycle Hooks](#script-lifecycle-hooks)
24. [New Script Checklist](#new-script-checklist)

---

## Utility Functions

### `nowTs()`
Returns `Date.now()` (ms).

### `nowUnix()`
Returns `Math.floor(Date.now() / 1000)` (Unix seconds).

### `safeJsonParse(text)`
Parses JSON; returns `null` on failure instead of throwing.

### `formatNumber(n)`
Locale-formatted number. `formatNumber(12345)` → `"12,345"`.

### `formatMoney(n)`
Dollar-formatted. Returns `"—"` for `null`/`undefined`, `"$0"` for zero.
```js
formatMoney(1234)   // "$1,234"
formatMoney(0)      // "$0"
formatMoney(null)   // "—"
```

### `formatSeconds(sec)`
Human-readable duration **with seconds**. Returns `"now"` for ≤ 0.
```js
formatSeconds(3661)  // "1h 1m 1s"
formatSeconds(90061) // "1d 1h 1m 1s"
```

### `formatSecondsShort(sec)`
Compact variant — **omits seconds** when days or hours are present.
```js
formatSecondsShort(3661)  // "1h 1m"
formatSecondsShort(45)    // "45s"
```

### `ageText(ts)`
Relative age string. `ageText(Date.now() - 120000)` → `"2m 0s ago"`.

### `escapeHtml(str)`
Escapes `& < > " '` for safe HTML insertion.

### `sleep(ms)`
`await sleep(500)` — promise-based delay.

### `debounce(fn, waitMs)`
Returns a debounced version of `fn` that delays execution until
`waitMs` milliseconds have elapsed since the last call. Useful for
filter inputs, search fields, and resize handlers.
```js
const debouncedSearch = debounce(filterTargets, 300);
input.addEventListener('input', debouncedSearch);
```

---

## Storage

### `getStorage(key, fallback)`
Reads JSON from `localStorage`. Returns `fallback` if missing or corrupt.

### `setStorage(key, value)`
Writes JSON to `localStorage`.

> **Convention:** prefix keys with `${SCRIPT_KEY}_` for script-local storage.

---

## Logging

### `addLog(msg)`
Pushes a timestamped entry to `STATE._logs` (max 200 entries, FIFO).
```js
addLog('Scan complete — 12 profiles fetched');
```

---

## API Key Management

### `initApiKey(pdaInjectedKey)`
Call once in `init()`. Priority: PDA-injected key → shared key → intercepted key.
```js
initApiKey(PDA_INJECTED_KEY);
```

### `getSharedApiKey()` / `setSharedApiKey(key)`
Read/write the cross-script shared API key (`tpda_shared_api_key`).

### `migrateApiKeyToShared()`
One-time migration from legacy per-script key to shared storage.
Called automatically by `initApiKey`.

### `extractApiKeyFromUrl(url)`
Parses `key=…` from a Torn API URL and stores it.

---

## API Key UI Components

### `renderApiKeyCard()`
Returns HTML string for a collapsible API key input card.

### `handleApiKeyClick(e, container, onSave)`
Delegated click handler for the API key card. Call inside
your panel body's `click` listener:
```js
body.addEventListener('click', (e) => {
  if (handleApiKeyClick(e, body, () => renderPanel())) return;
});
```

---

## Debug Log UI Components

### `renderLogCard()`
Returns HTML for a collapsible debug log display (shows `STATE._logs`).

### `handleLogClick(e, container)`
Delegated click handler for log toggle/copy buttons.

---

## Bubble & Panel UI

### `getBubbleEl()` / `getPanelEl()`
Shorthand for `document.getElementById(BUBBLE_ID / PANEL_ID)`.

### `bringToFront(el)`
Increments `STATE.ui.zIndexBase` and applies to element.

### `clampToViewport(left, top, width, height)`
Returns `{ left, top }` clamped to stay within viewport (4px margin).

### `bubbleRightBottomToLeftTop(pos, size)`
Converts `{ right, bottom }` → `{ left, top }`.

### `leftTopToBubbleRightBottom(left, top, size)`
Converts `{ left, top }` → `{ right, bottom }`.

### `getDefaultBubblePosition()`
Returns default `{ right, bottom }` offset based on existing TPDA bubbles on page.

### `getBubblePosition()` / `setBubblePosition(pos)`
Load/save bubble `{ right, bottom }` from `${SCRIPT_KEY}_bubble_pos`.

### `getPanelPosition()` / `setPanelPosition(pos)`
Load/save panel `{ left, top }` from `${SCRIPT_KEY}_panel_pos`.

### `copyToClipboard(text, buttonEl)`
Copies text and shows "Copied ✓" feedback on the button element.

---

## Draggable Behavior

### `makeDraggableBubble(el)`
Adds pointer-event drag to a bubble element. Saves position on drop.
Marks `el.dataset.dragged = '1'` during drag to suppress click events.

### `makeDraggablePanel(panel, handle)`
Adds pointer-event drag to a panel via its header handle.
Ignores drags starting on `<button>` or `<input>` inside the header.

---

## Expand / Collapse / Resize

### `expandPanelNearBubble()`
Hides bubble, shows panel at saved position (or near bubble).
Calls `onPanelExpand()` hook if defined.

### `collapseToBubble()`
Hides panel, shows bubble. Calls `onPanelCollapse()` hook if defined.

### `onResize()`
Window resize handler — re-clamps bubble and panel to viewport.
Register with `window.addEventListener('resize', onResize)`.

---

## Network Interception

### `hookFetch()`
Wraps `window.fetch` to capture API keys from `api.torn.com` URLs.
If the script defines a `handleApiPayload(url, data)` function,
`hookFetch` will also clone responses from `api.torn.com`, parse
the JSON, and pass it to `handleApiPayload`. URLs containing
`_tpda=1` are skipped to avoid double-processing direct API calls.

### `hookXHR()`
Wraps `XMLHttpRequest.open/send` to capture API keys.
Like `hookFetch`, it also calls `handleApiPayload(url, data)` if
defined by the script, skipping `_tpda=1` URLs.

### `handleApiPayload(url, data)` *(optional hook)*
Define this function in your script to receive parsed API response
data from passively intercepted traffic. Called automatically by
`hookFetch`/`hookXHR` for `api.torn.com` responses.

> **Note:** Scripts that need to intercept non-API URLs (e.g., Strip
> Poker intercepting all `torn.com` page requests) should override
> `hookFetch`/`hookXHR` entirely. The script-specific function
> declarations win over the common.js versions due to JS hoisting.

> Call **both** immediately (before `init`) to capture PDA traffic:
> ```js
> hookFetch();
> hookXHR();
> setTimeout(init, 1200);
> ```

---

## War-Shared Helpers

### `loadPollMs(intervals, defaultMs)`
Loads saved poll interval from storage; validates against the given array.
```js
STATE.pollMs = loadPollMs(POLL_INTERVALS, DEFAULT_POLL_MS);
```

### `savePollMs(ms)`
Saves poll interval to `${SCRIPT_KEY}_poll_ms`.

### `getManualEnemyFactionId()` / `setManualEnemyFactionId(id)`
Read/write the manually-set enemy faction ID from `${SCRIPT_KEY}_enemy_faction_id`.

### `profileUrl(id)`
Returns `https://www.torn.com/profiles.php?XID={id}`.

### `attackUrl(id)`
Returns `https://www.torn.com/loader.php?sid=attack&user2ID={id}`.

---

## API Calls

### Constants

| Name | Value | Description |
|------|-------|-------------|
| `TORN_API_TIMEOUT_MS` | `12000` | Fetch timeout for non-PDA API calls (12 seconds) |

### `tornApiGet(url, retries)`
Shared fetch helper. Uses `PDA_httpGet` inside Torn PDA, plain `fetch`
with **AbortController timeout** (12s) outside PDA. Tracks API call count.
Retries once on rate limit (error code 5) with 5-second delay.
Returns parsed JSON or `null` on error.

```js
const data = await tornApiGet(`https://api.torn.com/user/?selections=bars&key=${STATE.apiKey}&_tpda=1`);
```

> **Note:** The AbortController timeout only applies to non-PDA fetch.
> PDA_httpGet has its own internal timeout managed by Flutter.
> API key is masked in timeout log messages for security.

### `batchApiCalls(items, buildUrl, concurrency, delayMs)`
Runs batched API requests in parallel with throttling. Each request
is error-isolated — one failure won't kill the batch.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `items` | — | Array of items to process |
| `buildUrl` | — | `fn(item)` → API URL string |
| `concurrency` | `2` | Parallel requests per batch |
| `delayMs` | `650` | ms to sleep between batches |

Returns `Array<{ item, data, error }>`.

```js
const memberIds = ['123', '456', '789', '101'];
const results = await batchApiCalls(
  memberIds,
  (id) => `https://api.torn.com/user/${id}?selections=profile&key=${STATE.apiKey}&_tpda=1`,
  2,   // 2 parallel
  650  // 650ms between batches
);
for (const { item: id, data, error } of results) {
  if (error) { addLog(`Failed ${id}: ${error}`); continue; }
  // process data...
}
```

> **Performance:** Scanning 20 profiles with concurrency=2 takes ~7s
> vs ~13s sequential (650ms × 20). With concurrency=3, ~5s.

### `trackApiCall()` / `getApiCallsPerMinute()` / `getApiCallTotal()`
Internal API call rate tracking. `trackApiCall()` is called automatically
by `tornApiGet()`. Use `getApiCallsPerMinute()` to display rate in UI.

---

## Stat Estimation

### Constants

| Name | Description |
|------|-------------|
| `RANK_SCORES` | Map of rank name → numeric score (1-26) |
| `RANK_STAT_MIDPOINTS` | Map of rank name → rough total battle stat midpoint |
| `LEVEL_TRIGGERS` | Level thresholds for stat deduction |
| `CRIMES_TRIGGERS` | Crime count thresholds |
| `NW_TRIGGERS` | Networth thresholds |
| `STAT_RANGES` | 7 labels: `"< 2k"` … `"> 50b"` |
| `STAT_COLORS` | 7 hex colors matching ranges |
| `STAT_MIDPOINTS` | Rough midpoint values for each range |

### `rankToMidpoint(rank)`
Returns the numeric midpoint from `RANK_STAT_MIDPOINTS` for a given
rank string (e.g., `"Celebrity"` → `6300000`). Returns `null` if unknown.

### `formatStatCompact(n)`
Formats a large number compactly: `formatStatCompact(6300000)` → `"6.3M"`.
Handles k, M, B suffixes.

### `estimateStats(rank, level, crimesTotal, networth)`
Returns `{ label, color, idx, midpoint }` or `null` if rank is unknown.
Uses the TornPDA estimation algorithm. `midpoint` comes from
`RANK_STAT_MIDPOINTS` for the specific rank.

---

## Profile Cache

| Constant | Value |
|----------|-------|
| `PROFILE_CACHE_KEY` | `'tpda_shared_profile_cache'` |
| `PROFILE_CACHE_TTL` | 30 minutes (ms) |
| `SCAN_API_GAP_MS` | 650 ms between API calls |

### `loadProfileCache()`
Returns profile map from storage, pruning expired entries.

### `saveProfileCache()`
Writes `STATE.profileCache` to storage.

### `fetchMemberProfile(memberId)`
Fetches profile from Torn API (or returns cached). Stores
`{ rank, level, crimesTotal, networth, estimate, fetchedAt }` in cache.

---

## Cross-Origin HTTP

### `crossOriginGet(url)`
Cross-origin GET helper for external APIs (e.g., TornW3B). Uses
`PDA_httpGet` (Flutter native HTTP) in Torn PDA, falls back to
plain `fetch()` in Tampermonkey (works when the server sends CORS
headers). Returns parsed JSON.
```js
const data = await crossOriginGet('https://weav3r.dev/api/marketplace/206');
```

---

## Profit Calculator

### `calcDealProfit(buyPrice, sellPrice, taxPct, extraFees)`
Returns `{ buyPrice, sellPrice, taxPct, taxAmount, extraFees, netProfit, roiPct }`
or `null` if inputs are invalid. Reusable for any buy/sell/tax math.

---

## Notifications

### `tpdaNotify(key, title, body, ttlMs)`
Fires a browser `Notification` with duplicate suppression. Returns `true`
if notification was shown, `false` if suppressed (same `key` within `ttlMs`,
default 5 minutes). Automatically prunes old dedup entries.

### `tpdaRequestNotifyPermission()`
Requests browser notification permission if not yet granted.
Safe to call repeatedly — no-ops if already `"granted"` or `"denied"`.

---

## Member Data Processing

### `normalizeMembers(data)`
Converts API response members (object or array) to `[{ id, ...fields }]`.

### `parseRelativeMinutes(relative)`
Parses `"2 hours ago"` → `120`, `"3 days ago"` → `4320`.

### `memberLastActionInfo(member)`
Returns `{ isOnline, minutes, relative }` from member's last action data.

### `normalizeText(...parts)`
Joins parts into `"part1|part2|part3"` (lowercased, trimmed).

### `inferLocationState(member)`
Returns `{ locationBucket, locationLabel }` where bucket is one of:
`hospital`, `jail`, `traveling`, `abroad`, `torn`, `unknown`.

### `parseRemainingFromText(text)`
Parses `"2d 3h 45m 30s"` → seconds.

### `extractTimerInfo(member, locationBucket)`
Returns `{ remainingSec, timerRemainingSec, timerEndTs }` with
multiple fallback strategies for finding remaining time.

---

## Faction War Detection

### `fetchOwnFactionWars()`
Fetches `/faction/?selections=basic` and inspects war data.
Returns `{ ownFactionId, ownFactionName, wars }` where each war
includes `{ enemyFactionId, enemyFactionName, type, start, startsIn }`.

---

## DOM Helpers

### `waitForElement(selector, timeoutMs)`
Returns a Promise that resolves with the first matching DOM element.
Uses MutationObserver internally — much more reliable than `setTimeout`
polling for Torn's React SPA where elements appear asynchronously.
Auto-disconnects on timeout (default 10 seconds).

```js
try {
  const el = await waitForElement('[class*="travelStatus___"]', 8000);
  // el is now the matching DOM element
} catch (err) {
  addLog('Travel status element not found');
}
```

> **Use instead of** the old `setTimeout` polling pattern with retries.
> The observer fires immediately when the element appears rather than
> waiting for the next poll interval. Auto-cleanup prevents memory leaks.

---

## Input Validation

### `validateApiKey(key)`
Returns `true` if `key` is a valid 16-character alphanumeric Torn API key.
```js
if (!validateApiKey(inputValue)) {
  addLog('Invalid API key format');
  return;
}
```

### `validateFactionId(id)`
Returns `true` if `id` is a valid numeric faction ID (1-10 digits, > 0).

### `validateUserId(id)`
Returns `true` if `id` is a valid numeric user/player ID (1-10 digits, > 0).

---

## Page Data Access

### `getTornBannerData()`
Reads `window.topBannerInitData.user.data` — a global object where Torn
stores some user data without requiring an API call. Returns the data
object or `null` if unavailable.

**Known fields:**
- `.hospitalStamp` — Hospital end timestamp (Unix)
- More fields may be available — explore in browser console

```js
const banner = getTornBannerData();
if (banner && banner.hospitalStamp) {
  const hospEndTs = banner.hospitalStamp;
  const secondsLeft = hospEndTs - Math.floor(Date.now() / 1000);
  addLog(`Hospital: ${formatSeconds(secondsLeft)} left (from banner data)`);
}
```

> **Zero-cost:** No API call needed. Data is already in the page's JS context.

### `isTabActive()`
Returns `true` if the current tab/PDA tab is focused/active.
In Torn PDA, checks `window.__tornpda.tab.state.isActiveTab`.
Outside PDA, checks `document.hidden`.

```js
if (!isTabActive()) {
  addLog('Tab inactive — skipping poll');
  return;
}
```

> **Use for:** Skipping API polls, timer updates, or expensive DOM
> operations when the user isn't looking. Saves battery on mobile/PDA.

---

## Script Lifecycle Hooks

Define these functions in your script to receive callbacks from common code:

### `onPanelExpand()`
Called when panel opens. Use for data refresh, timer start, etc.

### `onPanelCollapse()`
Called when panel closes. Use for scan cancellation, timer cleanup, etc.

---

## New Script Checklist

1. **Create** `src/your-script.src.js` with the IIFE wrapper
2. **Define** required variables at top: `PDA_INJECTED_KEY`, `SCRIPT_KEY`,
   `BUBBLE_ID`, `PANEL_ID`, `HEADER_ID`, `BUBBLE_SIZE`, `STATE`
3. **Place** `// #COMMON_CODE` marker after STATE definition
4. **Implement** `ensureStyles()`, `createBubble()`, `createPanel()`,
   `renderPanel()`, `onPanelExpand()`, `onPanelCollapse()`
5. **Write** `init()` function:
   ```js
   async function init() {
     initApiKey(PDA_INJECTED_KEY);
     ensureStyles();
     createBubble();
     createPanel();
     window.addEventListener('resize', onResize);
     addLog('My Script initialized');
   }
   hookFetch();
   hookXHR();
   setTimeout(init, 1200);
   ```
6. **Add** to `build.py` SCRIPTS dict: `'your-script.src.js': 'your-script.user.js'`
7. **Build** with `python3 build.py` and verify bracket balance passes
8. **Use** distinct `BUBBLE_ID` and bubble color to avoid conflicts with other scripts

### Bubble Color Registry

| Script | Color | z-index base |
|--------|-------|-------------|
| Assistant | Blue `#4a90d9` | 999990 |
| Deal Finder | Purple `#9b59b6` | 999980 |
| War Bubble | Red `#d64545` | 999970 |
| Strip Poker | Green `#27ae60` | 999960 |
| Bounty Filter | Orange `#e65100` | 999950 |
| War Manager | Orange `#e67e22` | 999945 |
| Market Sniper | Green `#2ecc40` | 999940 |
| Stock Trader | Gold `#f4b740` | 999930 |
