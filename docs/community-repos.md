# Community Torn Script Repositories — Reference Guide

Research notes from analyzing popular open-source Torn City scripts and tools. These repos were studied to learn patterns, features, and techniques that can be adopted in our own scripts.

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
| `requireElement()` polling | TornTools | High | Torn is a React SPA — DOM elements appear asynchronously. Essential for reliable DOM interaction. |
| Absolute timestamp timers | TornTools | High | Our countdown timers will desync when tab is backgrounded. `dataset.end` pattern prevents this. |
| `isTabFocused()` guard | TornTools | Medium | Prevents unnecessary processing when tab is in background. Saves battery on mobile/PDA. |
| Non-blocking notifications | Xoke | Medium | Better UX than current approach for transient messages. |
| Virtual scroll handling | danielgoodwin97 | Low | Only needed if we scrape long lists (Deal Finder could benefit). |
| CSV export with injection protection | Xoke | Low | If we ever add data export features. |
| TypeScript build pipeline | kek91 | Low | Type safety would help prevent bugs like the 0/0 energy issue, but adds build complexity. |
