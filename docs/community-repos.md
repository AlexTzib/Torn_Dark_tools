# Community Torn Script Repositories — Reference Guide

Research notes from analyzing popular open-source Torn City scripts and tools. These repos were studied to learn patterns, features, and techniques that can be adopted in our own scripts.

---

## Quick Lookup — "I need to build X, where do I look?"

Use this table when starting a new feature. Find the closest functionality, then go read that repo's implementation.

### Combat & War

| Functionality | Repo / Script | Key File(s) | Notes |
|---|---|---|---|
| **Ranked war target finder** | Xoke | `TornRankedWarTargetFinder.user.js` (1253 lines) | FF Scouter integration, chain monitoring (current/timeout/cooldown), target filtering |
| **Retal monitor** (who attacked us & wasn't retaliated) | Xoke | `TornRetalMonitor.user.js` (~869 lines) | Polls `faction/{id}?selections=attacks`, 5-min window countdown, notification sounds, badge count |
| **Target tracking / management** | Xoke | `TornTargetManager.user.js` | Persistent target list with notes |
| **Stats estimation / FF score** | TornTools | `scripts/features/stats-estimate/`, `scripts/features/ff-scouter/` | Fair fight gauge, attacker/defender stat comparison |
| **War finish time prediction** | TornTools | `scripts/features/ranked-war-filter/` | Estimates when a ranked war will end |
| **Chain watch alert** | External (linked by Xoke) | [greasyfork #478422](https://greasyfork.org/en/scripts/478422) | Screen fades red when chain timer drops below threshold |
| **Ranked war timer overlay** | russianrob | `torn-ranked-war-timer.user.js` | Simple timer display for ranked wars |
| **Low-level attack detector** | kek91 | `LowLvlAttackDetector.user.js` | Detects incoming attacks from lower-level players during an ongoing attack |
| **Fight button on profiles** | paulwratt | `fightclub.torn.user.js` | Adds fight button to Friends/Black list profiles |

### Energy, Drugs & Healing

| Functionality | Repo / Script | Key File(s) | Notes |
|---|---|---|---|
| **Xanax reminder** (no drug CD banner) | Xoke | `TornXanaxReminder.user.js` | Checks `[aria-label^='Drug Cooldown:']`, shows clickable red bar |
| **Heal advisor** (best item for hospital time) | Xoke | `TornHealAdvisor.user.js` (333 lines) | Picks highest-cooldown item whose CD expires before discharge |
| **Drug details / effects** | TornTools | `scripts/features/drug-details/` | Shows drug stat effects inline |
| **Cooldown end times** | TornTools | `scripts/features/travel-cooldowns/ttTravelCooldowns.ts` | Absolute timestamp approach, accesses `userdata.energy.fulltime`, `userdata.cooldowns.*` |
| **Bar links** | TornTools | `scripts/features/bar-links/` | Clickable energy/nerve bars |

### Economy & Trading

| Functionality | Repo / Script | Key File(s) | Notes |
|---|---|---|---|
| **Auto bazaar pricing** (set price from market) | danielgoodwin97 | `auto-bazaar-pricer.user.js` (677 lines) | Uses `Authorization: ApiKey` header (v2), virtual scroll handling, config popup UI |
| **Bazaar filler** (auto-fill prices) | External (linked by Xoke) | [greasyfork #473470](https://greasyfork.org/en/scripts/473470) | Auto-fills with lowest market price minus offset |
| **Highlight cheap items** on market | TornTools | `scripts/features/highlight-cheap-items/` | Highlights items below a threshold |
| **Item market fill max** | TornTools | `scripts/features/item-market-fill-max/` | Fill max quantity button |
| **Bazaar worth calculator** | TornTools | `scripts/features/bazaar-worth/` | Total value of bazaar items |
| **Item values display** | TornTools | `scripts/features/item-values/` | Show market value inline |
| **RW weapon/armour pricing** | russianrob | `torn-rw-pricer.user.js` (v2.9.9), `torn-rw-weapon-pricer.user.js` | Auction data with p25/median/p75 percentiles from 227K+ sales |
| **Auction price checker** | External (linked by Xoke) | [greasyfork #564049](https://greasyfork.org/en/scripts/564049) | Historical auction pricing |
| **Stock market helper** | sid-the-sloth1 | `stonks.user.js` | Stock tracking and analysis |

### Faction Management

| Functionality | Repo / Script | Key File(s) | Notes |
|---|---|---|---|
| **Faction member CSV export** | Xoke | `TornFactionCSVExporter.user.js` (239 lines) | Includes battle stats from FF Scouter, CSV injection sanitization |
| **Offline member highlighting** | russianrob | `torn-faction-offline-highlight.user.js` | Highlights members offline >24h, OC inactivity badges in chat. PDA compatible. |
| **Faction member filters** | TornTools | `scripts/features/faction-member-filter/` | Filter/sort faction members |
| **Armory worth** | TornTools | `scripts/features/armory-worth/` | Total faction armory value |
| **Faction stakeouts** | TornTools | `scripts/features/faction-stakeouts/` | Monitor specific faction members |
| **Vault overpayment warning** | Xoke | `TornVaultCatcher.user.js` | Warns bankers when giving more than vault balance |

### Organized Crime (OC)

| Functionality | Repo / Script | Key File(s) | Notes |
|---|---|---|---|
| **OC slot recommender** | Xoke | `TornOCRecommender.user.js` (428 lines) | Success rate thresholds: Level 2-6 = 70%+, Level 7+ = 50%+ |
| **OC success rate highlighter** | Xoke | `TornOCSuccessHighlighter.user.js` | Highlights <70% success participants |
| **OC 2.0 missing items** | russianrob | `torn-oc-2-0-missing-item-roles.user.js` | Floating box showing planning crimes with missing-item roles |
| **OC loan manager** | russianrob | `torn-oc-loan-manager-pda.user.js` | Over-loan highlights, loan helper, split calculator. PDA compatible. |
| **OC time / OC2 time** | TornTools | `scripts/features/oc-time/`, `scripts/features/oc2-time/` | OC countdown timers |
| **OC available players** | TornTools | `scripts/features/oc-available-players/` | Shows who's available for OC |
| **OC 2.0 Helper** | External (linked by Xoke) | [greasyfork #522974](https://greasyfork.org/en/scripts/522974) | Overview: members not in crimes, issues |

### Profile & Player Info

| Functionality | Repo / Script | Key File(s) | Notes |
|---|---|---|---|
| **Profile link formatter** (copy formatted links) | russianrob | `torn-profile-link-formatter.user.js` | BSP prediction, FF Scouter V2 integration, dedupes by ID |
| **Profile box** (spy data, stat comparison) | TornTools | `scripts/features/profile-box/ttProfileBox.ts` | Shows your stats vs target: `userdata.battlestats.strength.value` |
| **Hospital filter** | TornTools | `scripts/features/hospital-filter/` | Filter hospital list with alias support |
| **Bounty filter** | TornTools | `scripts/features/bounty-filter/` | Filter bounty list |

### UI, Navigation & Misc

| Functionality | Repo / Script | Key File(s) | Notes |
|---|---|---|---|
| **Dark theme** | paulwratt | `darktheme.torn.user.js`, `darktheme.stylish.css` | 77% light reduction, minimal CSS. Not full black. |
| **Custom links in sidebar** | TornTools | `scripts/features/custom-links/` | User-defined sidebar links |
| **Sidebar notes** | TornTools | `scripts/features/sidebar-notes/` | Personal notes in sidebar |
| **Fancy navigation** | kek91 | `FancyNavigation.user.js` | Navigation enhancements |
| **NPC loot times** | TornTools | `scripts/features/npc-loot-times/` | Countdown to NPC loot availability |
| **Education finish time** | TornTools | `scripts/features/education-finish-time/` | Shows when current education completes |
| **Christmas Town helper** | sid-the-sloth1 | `Christmas Town.user.js` / `cthelper-pda.user.js` | Highlights items/chests/NPCs in seasonal event. PDA version available. |

### Crimes

| Functionality | Repo / Script | Key File(s) | Notes |
|---|---|---|---|
| **Crime morale / Crime 2.0** | External (linked by Xoke) | [greasyfork #515557](https://greasyfork.org/en/scripts/515557) | Scamming, pickpocketing, burglary helper |
| **OutcomeDB** (crime data capture) | External (linked by Xoke) | [greasyfork #489750](https://greasyfork.org/en/scripts/489750) | Captures crime outcome, skill gain, target data |
| **Express crimes** | tcbasic | `tcexpresscrimes.user.js` | Historical — express crime execution (2008) |
| **Express bust** | tcbasic | `tcexpressbust.user.js` | Historical — express bust from jail (2007) |

### Infrastructure / Patterns (not features, but reusable code)

| Functionality | Repo / Script | Key File(s) | Notes |
|---|---|---|---|
| **DOM element polling** (`requireElement`) | TornTools | `scripts/global/functions/requires.ts` | Promise-based, 50ms interval, 1000 max cycles. **Copy this.** |
| **Feature lifecycle manager** | TornTools | `scripts/global/featureManager.ts` | Register/init/execute/cleanup per feature |
| **Event bus / custom events** | TornTools | `scripts/global/functions/listeners.ts` | Decouple DOM detection from feature logic |
| **Fetch interception (page context)** | TornTools | `scripts/global/inject/fetch.ts` | Injected via `<script>` tag, dispatches window events |
| **Reusable Torn JS object** | paulwratt | `tc.torn.js` | Generic Torn City helper object (experimental) |
| **TypeScript userscript build** | kek91 | `package.json`, `kvassh.ts` | `npm run build` → compiled `.user.js` in `dist/` |
| **Discord bot (server-side API)** | equibot | `commands/spy.js`, `commands/stats.js`, `commands/stocks.js` | Server-side Torn API usage for bots |

---

## Tier 1 — Gold-Standard References

### TornTools Extension

| | |
|---|---|
| **Repo** | [github.com/Mephiles/torntools_extension](https://github.com/Mephiles/torntools_extension) |
| **Authors** | Mephiles [2087524], DeKleineKobini [2114440] |
| **Stars** | ~134 |
| **Language** | TypeScript (compiled with esbuild) |
| **Type** | Browser extension (Manifest V3) — Chrome, Firefox, Edge |
| **Size** | 286 source files, massive codebase |

**The single most important reference for Torn scripting.** TornTools is a full browser extension with 50+ features covering virtually every aspect of Torn gameplay.

#### Feature Categories

- **Bars & Status:** Cooldown end times, bar links, live networth, effective stats display
- **Chat:** Colored chat, search chat, chat highlight, chat autocomplete
- **Combat/War:** FF Scouter integration, ranked war filter/timer, war finish times, stats estimation
- **Economy:** Bazaar worth, item values, drug details, total item cost, bazaar fill max, highlight cheap items
- **Faction:** OC management (OC time, OC2, available players), member filters, armory worth, faction stakeouts
- **Company:** Specials, employee inactivity warnings, effectiveness tracker, auto stock fill
- **Item Market:** Left bar, highlight cheap items, fill max
- **Hospital/Bounty:** Filters with user alias support, stats estimate
- **API Tools:** Auto API fill, auto pretty, API selections, API demo
- **UI:** Custom links, sidebar notes, collapsible areas, settings link
- **Timers:** NPC loot times, virus timer, education finish time

#### Key Architecture Patterns

1. **`requireElement(selector, options)`** — Promise-based DOM element polling. Cornerstone utility. Checks every 50ms up to 1000 cycles. Found in `scripts/global/functions/requires.ts`.

2. **`observeChain()`** — Chained MutationObserver for deeply nested dynamic content. Watches parent → child → grandchild in sequence.

3. **Feature Manager** — `featureManager.registerFeature(name, scope, enabled, init, execute, cleanup, storage, requirements, options)`. Each feature is a self-contained module with lifecycle hooks.

4. **Event Bus** — MutationObservers trigger custom events (`triggerCustomListener(EVENT_CHANNELS.X)`), features subscribe to events. Fully decouples DOM detection from feature logic.

5. **Fetch/XHR Interception** — Injects scripts into page context via `<script>` tag, dispatches `window` events for intercepted network calls. More sophisticated than our monkey-patching approach.

6. **Anti-scrape Guard** — `isTabFocused()` check: sensitive events only fire when the browser tab is focused, preventing background data harvesting.

7. **Countdown Timers** — Uses `dataset.end` (absolute timestamp) instead of relative seconds. Prevents desync when tab is inactive/backgrounded.

8. **Modular Feature Folders** — Each feature lives in its own folder under `scripts/features/` with separate JS/CSS/HTML files.

#### Key Files to Study

| File | What to learn |
|---|---|
| `scripts/global/functions/requires.ts` | `requireElement()` DOM polling |
| `scripts/global/functions/listeners.ts` | Event bus, custom event channels |
| `scripts/global/featureManager.ts` | Feature lifecycle management |
| `scripts/global/inject/fetch.ts` | Fetch interception from page context |
| `scripts/background.ts` | Service worker, API data caching |
| `scripts/features/highlight-cheap-items/` | Item market feature example |
| `scripts/features/npc-loot-times/` | Timer management example |
| `scripts/features/travel-cooldowns/` | How they access `userdata.energy`, `userdata.nerve`, `userdata.cooldowns` |
| `scripts/features/achievements/achievements.ts` | How they access `userdata.battlestats.strength.value` (V2 format) |
| `pages/popup/popup.ts` | How they render bars using `bar.current`, `bar.maximum` |

---

### Xoke's Torn Scripts

| | |
|---|---|
| **Repo** | [github.com/Xoke/torn](https://github.com/Xoke/torn) |
| **Author** | Xoke |
| **Language** | Vanilla JavaScript (ES6+) |
| **Type** | Greasemonkey / Tampermonkey userscripts |
| **Size** | 10+ scripts, ~5,400 lines total |

**Best reference for standalone userscripts** — same architecture as our scripts (IIFE, no build step, no deps). Excellent README with curated links to other community scripts.

#### Scripts

| Script | Lines | Description |
|---|---|---|
| **Ranked War Target Finder** | 1,253 | Most complex. Finds targets during ranked wars, FF Scouter integration, chain monitoring (current/timeout/cooldown states) |
| **Retal Monitor** | ~869 | Monitors `faction/{id}?selections=attacks` for unretaliated attacks. 5-min retaliation window countdown, notification sounds, badge count |
| **OC Recommender** | 428 | Recommends best Organized Crime slot. Success rate thresholds: Level 2-6 need 70%+, Level 7+ need 50%+ |
| **Heal Advisor** | 333 | Recommends optimal healing item based on hospital time remaining. Picks highest-cooldown item whose CD expires before hospital discharge |
| **Faction CSV Exporter** | 239 | Exports faction members to CSV with battle stats. CSV injection sanitization |
| **Xanax Reminder** | ~100 | Checks `[aria-label^='Drug Cooldown:']` selector. Shows red clickable banner if no cooldown |
| **Vault Catcher** | ~100 | Warns faction bankers of overpayments |
| **Target Manager** | ~200 | Target tracking and organization |
| **OC Success Highlighter** | WIP | Highlights <70% success rate participants |

#### Key Patterns

- **`GM_xmlhttpRequest`** for cross-origin API calls (Tampermonkey/Greasemonkey only, not available in PDA)
- **`GM_setValue` / `GM_getValue`** for persistent storage across page loads
- **Non-blocking notifications** — custom toast-style notification system instead of `alert()`
- **CSV formula injection protection** — prefixes cells with `'` to prevent spreadsheet formula execution
- **No jQuery, no dependencies** — pure vanilla JS with modern selectors

#### Curated External Scripts (from Xoke's README)

Xoke's README links to other quality scripts worth knowing about:

| Script | Author | Purpose |
|---|---|---|
| [FF Scouter V2](https://greasyfork.org/en/scripts/535292) | — | Fair fight score estimation (many scripts depend on this) |
| [Chain Watch Alert](https://greasyfork.org/en/scripts/478422) | — | Chain timer drop alert with screen fade |
| [Crime Morale](https://greasyfork.org/en/scripts/515557) | — | Crime 2.0 helper for scamming, pickpocketing, burglary |
| [OC 2.0 Helper](https://greasyfork.org/en/scripts/522974) | — | OC overview: members not in crimes, issues |
| [OutcomeDB](https://greasyfork.org/en/scripts/489750) | — | Crime outcome/skill gain data capture |
| [Torn Bazaar Filler](https://greasyfork.org/en/scripts/473470) | — | Auto-fill bazaar prices from market |
| [Torn Auction Price Checker](https://greasyfork.org/en/scripts/564049) | — | Historical auction pricing |

---

## Tier 2 — Useful Specific Techniques

### danielgoodwin97 — Torn Item Market Pricer

| | |
|---|---|
| **Repo** | [github.com/danielgoodwin97/torn-item-market-pricer](https://github.com/danielgoodwin97/torn-item-market-pricer) |
| **Author** | FATU [1482556] |
| **Language** | JavaScript + jQuery + Lodash |
| **Type** | Tampermonkey userscript |
| **Size** | 677 lines |

Auto-prices items when adding to the item market. Notable techniques:

- **Torn internal API:** `fetch('/inventory.php?rfcv=' + unsafeWindow.getRFC(), ...)` for inventory data using Torn's RFCV (CSRF) token
- **Torn API v2 with auth header:** `headers: { Authorization: 'ApiKey ${key}' }` instead of query param
- **Virtual scroll handling:** Programmatic scrolling to force render of virtualized list elements
- **Configuration UI:** Modal popup with form inputs for API key, pricing offset, auto-quantity toggle
- **`GM_addStyle`** for injecting CSS into the page
- **Lodash utilities:** `_.isEqual`, `_.merge`, `_.pick` for deep object operations

---

### russianrob — Torn Scripts

| | |
|---|---|
| **Repo** | [github.com/russianrob/torn-scripts](https://github.com/russianrob/torn-scripts) |
| **Author** | russianrob |
| **Language** | JavaScript |
| **Type** | Tampermonkey / PDA userscripts |
| **Size** | 7 scripts, ~6,575 lines total |

Focused, practical scripts — several are PDA-compatible:

| Script | Description |
|---|---|
| **Faction Offline Highlighter** (v1.9.2) | Highlights members offline >24h, OC inactivity badges in chat. PDA compatible. |
| **OC 2.0 Missing Item Roles** (v2.5.1) | Floating box listing OC 2.0 planning crimes with roles missing items |
| **OC Loan Manager** (v1.5.2-pda) | Highlights over-loaned items, helps loan missing OC tools + split calculator. PDA compatible. |
| **Profile Link Formatter** (v3.6.5) | Copy formatted profile/faction links. BSP prediction, FF Scouter V2 integration. Dedupes by ID. |
| **Ranked War Timer** (v1.6.1) | Timer overlay for ranked wars |
| **RW Pricer** (v2.9.9) | Inline price badges for ranked war weapons/armour using daily auction data |
| **RW Weapon Pricer** (v1.2.1) | RW weapon/armour price estimator from 227K+ auction sales. Shows p25/median/p75. |

**Notable:** The RW Pricer scripts contain extensive auction price data and statistical analysis (percentile calculations) — good reference for data-heavy features.

---

## Tier 3 — Niche / Historical Interest

### tcbasic — TC Greasemonkey

| | |
|---|---|
| **Repo** | [github.com/tcbasic/tc-greasemonkey](https://github.com/tcbasic/tc-greasemonkey) |
| **Stars** | ~40 |
| **Language** | JavaScript |
| **Size** | 4 scripts, ~3,106 lines |

**Historical reference** — some of the oldest Torn scripts on GitHub (dates from 2007-2008). Scripts:

| Script | Description |
|---|---|
| **TCCity** (tcgeneral.user.js) | General Torn City enhancements |
| **TCExpressBust** | Express bust from jail, faction members, profiles |
| **TCExpressCrimes** | Express crime execution |
| **TCWarBase** | War base layout changes |

These scripts predate modern ES6+ conventions but show the evolution of Torn scripting. The TCCity/general script is the most substantial at ~2,000 lines.

---

### sid-the-sloth1 — Torn QoL Scripts

| | |
|---|---|
| **Repo** | [github.com/sid-the-sloth1/torn-qol-scripts](https://github.com/sid-the-sloth1/torn-qol-scripts) |
| **Author** | hardy |
| **Language** | JavaScript |
| **Size** | 3 scripts, ~3,164 lines |

| Script | Description |
|---|---|
| **Christmas Town Helper** (v3.0.9) | Highlights items, chests, NPCs in the Christmas Town event. Includes game cheat helpers. |
| **Stonks** (v0.5.8) | Stock market helper |
| **CT Helper PDA** | PDA-compatible version of Christmas Town Helper |

**Notable:** The Stonks script could be a reference for stock-related features.

---

### paulwratt — Torn City PW Tools

| | |
|---|---|
| **Repo** | [github.com/paulwratt/torn-city-pwtools](https://github.com/paulwratt/torn-city-pwtools) |
| **Author** | paulwratt [2027970] |
| **Language** | JavaScript + CSS |
| **Size** | 6 files, ~973 lines |

| Script | Description |
|---|---|
| **FightClub** | Adds fight button to profiles in Friends/Black lists |
| **ReAttack Pest (RApest)** | Add player to lists after being mugged. ReChain for +3.00 fair fight profiles |
| **DarkTheme** | 77% light reduction background, minimal CSS changes. Also available as Stylish theme |
| **Generic TC Object** (tc.torn.js) | Reusable Torn City JavaScript object — could be used as script include |

**Notable:** The generic `tc.torn.js` object is an attempt at a reusable Torn scripting library. The dark theme approach (minimal CSS, not full black) is interesting.

---

### kek91 — Userscripts

| | |
|---|---|
| **Repo** | [github.com/kek91/userscripts](https://github.com/kek91/userscripts) |
| **Author** | Kvassh [2596327] |
| **Language** | TypeScript (compiled) |
| **Size** | 9 files, ~306 lines |

| Script | Description |
|---|---|
| **LowLvlAttackDetector** | Detects incoming attacks from lower-leveled players during an ongoing attack |
| **FancyNavigation** | Navigation enhancements |

**Notable:** Uses a proper TypeScript build pipeline (`npm install && npm run build` → `dist/` folder). Good reference for TypeScript-based userscript development if we ever migrate.

---

### TheCodeSinger — Equibot

| | |
|---|---|
| **Repo** | [github.com/TheCodeSinger/equibot](https://github.com/TheCodeSinger/equibot) |
| **Author** | TheCodeSinger (Equilibrium faction) |
| **Language** | Node.js |
| **Type** | Discord bot (not a userscript) |
| **Size** | 49 JS files |

A Discord bot for faction management. **Not directly relevant** to userscript development, but shows the breadth of Torn community tooling.

#### Bot Commands (43 commands)

Includes: `assist`, `bazaar`, `chain`, `info`, `lotto`, `perks`, `spy`, `stats`, `stocks`, `targets`, `trade`, and more.

**Notable:** The `spy`, `stats`, `stocks`, and `targets` commands likely contain Torn API integration patterns for server-side use.

---

## Summary: What to Adopt

### Already Adopted in Our Scripts
- IIFE wrapper pattern (from Xoke, community standard)
- Fetch/XHR interception (from TornTools, simplified)
- PDA API key injection (`###PDA-APIKEY###`)
- localStorage for persistence
- Debug log panel
- Dark theme colors

### Should Adopt Next
| Pattern | Source | Priority | Why |
|---|---|---|---|
| `requireElement()` / `waitForElement()` with MutationObserver | TornTools, TornHealAdvisor | High | Torn is a React SPA — DOM elements appear asynchronously. MutationObserver with auto-cleanup timeout is more reliable than setTimeout polling. |
| Absolute timestamp timers | TornTools | High | Our countdown timers will desync when tab is backgrounded. `dataset.end` pattern prevents this. |
| `safeFetch()` with AbortController timeout | TornTargetManager | High | Our `tornApiGet()` has no timeout. Hung requests block the script forever. Add 10-15s timeout. |
| `isTabFocused()` guard / PDA tab state | TornTools, PDA | Medium | Use `document.hidden` or `window.__tornpda.tab.state.isActiveTab` to skip processing when tab is inactive. Saves battery on mobile. |
| Batch API with per-item error isolation | TornTargetManager | Medium | `Promise.all(batch.map(fn.then(...).catch(...)))` — one failure doesn't kill the batch. Useful for War Manager profile scans. |
| `debounce()` utility | TornRankedWarTargetFinder | Medium | Prevents excessive function calls on filter inputs. Needed for bounty filter, market sniper. |
| Input validation helpers | TornTargetManager | Medium | Validate API keys (`/^[a-zA-Z0-9]{16}$/`), user IDs (`/^\d+$/`), faction IDs before use. |
| `window.topBannerInitData` | TornHealAdvisor | Medium | Torn stores user data (hospitalStamp, etc.) in a global. Free data without an API call. |
| RFCV token extraction | russianrob OC Loan Manager | Low | `document.cookie.match(/rfc_v=([^;]+)/)` — needed for POST requests to Torn internal endpoints. |
| Non-blocking notifications | Xoke | Low | Better UX than current approach for transient messages. Auto-dismiss with fade animation. |
| Virtual scroll handling | danielgoodwin97 | Low | Only needed if we scrape long lists (Deal Finder could benefit). |
| CSV export with injection protection | Xoke | Low | If we ever add data export features. Prefix cells with `'` to prevent formula execution. |
| TypeScript build pipeline | kek91 | Low | Type safety would help prevent bugs like the 0/0 energy issue, but adds build complexity. |

---

## Reusable Code Patterns (from community analysis)

### safeFetch with AbortController Timeout

From TornTargetManager.user.js — prevents hung requests:

```javascript
function safeFetch(url, timeout = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    return fetch(url, { signal: controller.signal })
        .then(response => {
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return response.json();
        })
        .catch(error => {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('Request timeout');
            throw error;
        });
}
```

### Batch API with Error Isolation

From TornTargetManager.user.js — parallel requests where one failure doesn't kill the batch:

```javascript
const batch = targetList.slice(start, start + BATCH_SIZE);
const results = await Promise.all(batch.map(target =>
    safeFetch(`https://api.torn.com/user/${target.id}?selections=profile&key=${apiKey}`)
        .then(data => ({ target, data, error: null }))
        .catch(error => ({ target, data: null, error }))
));
```

### MutationObserver with Auto-Cleanup

From TornHealAdvisor.user.js — observes DOM changes with automatic timeout disconnect:

```javascript
function waitForElement(selector, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const obs = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) { obs.disconnect(); clearTimeout(tid); resolve(el); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        const tid = setTimeout(() => { obs.disconnect(); reject(new Error('timeout')); }, timeoutMs);
    });
}
```

### Debounce Utility

From TornRankedWarTargetFinder.user.js:

```javascript
function debounce(func, wait) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(function() { func.apply(context, args); }, wait);
    };
}
```

### Centralized Regex Library

From TornRankedWarTargetFinder.user.js — pre-compiled patterns:

```javascript
var REGEX = {
    API_KEY: /^[a-zA-Z0-9]{16}$/,
    FACTION_ID: /^\d+$/,
    FOREIGN_HOSPITAL: /in an? .+ hospital/i,
    BATTLE_STATS: /(\d+\.?\d*)([kmb]?)/,
    HOSPITAL_TIME: /(\d+)\s*(second|sec|minute|min|hour|hr)/i,
    USER_ID: /XID=(\d+)/
};
```

### Non-Blocking Notification Toast

From TornRankedWarTargetFinder.user.js — auto-dismiss with fade:

```javascript
function showNotification(message, type) {
    var notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText =
        'position:fixed;top:20px;right:20px;z-index:10000;padding:15px 20px;border-radius:5px;' +
        'background:' + (type === 'error' ? '#c43b3b' : type === 'warning' ? '#b8860b' : '#2d6e2d') + ';' +
        'color:white;font-weight:bold;box-shadow:0 2px 10px rgba(0,0,0,.3);transition:opacity .3s;';
    document.body.appendChild(notification);
    setTimeout(function() {
        notification.style.opacity = '0';
        setTimeout(function() { notification.remove(); }, 300);
    }, 4000);
}
```

### Cross-Tab Synchronization

From TornTargetManager.user.js — detects changes from other tabs:

```javascript
function setupStorageListener() {
    let lastTimestamp = GM_getValue(STORAGE_KEY + '_timestamp', '0');
    setInterval(() => {
        const currentTimestamp = GM_getValue(STORAGE_KEY + '_timestamp', '0');
        if (currentTimestamp !== lastTimestamp) {
            lastTimestamp = currentTimestamp;
            loadSettings();
            if (pageActive) displayTable();
        }
    }, 2000);
}
```

### Torn Internal Data Access

From TornHealAdvisor.user.js — free user data without API call:

```javascript
const stamp = window.topBannerInitData &&
              window.topBannerInitData.user &&
              window.topBannerInitData.user.data &&
              window.topBannerInitData.user.data.hospitalStamp;
```

### RFCV Token for Torn Internal POST

From torn-oc-loan-manager-pda.user.js — CSRF token extraction:

```javascript
const getRfcvToken = () => {
    const match = document.cookie.match(/rfc_v=([^;]+)/);
    return match ? match[1] : null;
};

// Usage with URLSearchParams
const body = new URLSearchParams({ step: 'armouryTabContent', type: 'utilities', start: '0', ajax: 'true' });
await fetch(`https://www.torn.com/factions.php?rfcv=${rfcv}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    body,
    credentials: 'same-origin'
});
```

### Battle Stats Suffix Parsing

From TornTargetManager.user.js — handles k/m/b suffixes:

```javascript
function parseBattleStats(text) {
    if (!text) return 0;
    const clean = text.toLowerCase().replace(/[",\s]/g, '');
    const match = clean.match(/(\d+\.?\d*)([kmb]?)/);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const suffix = match[2];
    if (suffix === 'k') return num * 1000;
    if (suffix === 'm') return num * 1000000;
    if (suffix === 'b') return num * 1000000000;
    return num;
}
```
