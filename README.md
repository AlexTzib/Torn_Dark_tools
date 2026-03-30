# Torn Dark Tools

A collection of **local-only, read-only** userscript overlays for [Torn City](https://www.torn.com), designed primarily for [Torn PDA](https://github.com/Mephiles/torn-pda) but also compatible with Tampermonkey / Greasemonkey in desktop browsers.

All scripts follow a **display-only** philosophy: they show information derived from existing API traffic or page content but **never automate, click, buy, sell, attack, or perform any game action**.

---

## What Each Tool Does

### AI Advisor (Blue "AI" bubble)

Your personal Torn assistant. It pulls your player data via the API and shows a dashboard with:

- **Status bars** — energy, nerve, happy, life (current / max)
- **Cooldowns** — drug, booster, medical countdowns
- **Happy Jump Advisor** — scores your readiness for a happy jump (checks energy, happy, drug cooldown, booster cooldown) and tells you exactly what's blocking you
- **Drug-Free Energy Plan** — shows how to get the most energy without drugs (e.g., "Use 2 cans + refill" or "Wait for booster CD then use 6-pack")
- **War Timing & Booster Alignment** — when a faction war is active, checks if your booster cooldown will be clear before the war starts/resumes
- **Stock Block ROI Helper** — for your stock holdings, shows how many shares you need for the next benefit block, estimated cost, and days-to-payback for cash-returning stocks
- **Battle Stats** — STR/SPD/DEX/DEF at a glance
- **Funds** — cash on hand and bank balance

### Plushie Prices (Purple teddy bear bubble)

A plushie price comparison tool. Fetches current bazaar and item market floor prices for all 13 Torn plushies and displays them in a sortable table.

- **Sortable price table** — columns for Bazaar, Item Market, and Best price
- **Best price highlight** — green highlight on whichever source is cheaper
- **Full set cost** — total cost to buy one of each plushie at the best price
- **10-minute cache** — avoids unnecessary API calls between checks
- **API key auto-detection** — works with PDA injection, manual entry, or network interception

### War Bubble (Red "WAR" bubble)

An enemy faction online tracker for faction wars. Enter (or auto-detect) the enemy faction ID and it shows:

- **Online/idle/offline member counts** with last-action timestamps
- **Location buckets** — who's in Torn, abroad, hospital, jail, traveling
- **Hospital/jail timers** with analysis (detects faster-than-expected timer drops that could indicate revives or early releases)
- **Attack buttons** per member — "Go Attack" link, "Copy URL", "Copy Name"
- **Configurable polling** — 30s / 1min / 2min / 5min / 10min refresh rate

### Strip Poker Advisor (Green "♠" bubble)

A compact poker hand evaluator for Torn's Strip Poker mini-game. Designed to be tiny (40 px bubble, 260 px panel) so it won't block the pocket/PDA screen.

- **Two-tap card picker** — tap a rank (2–A), then a suit (♣♦♥♠) to enter your hand
- **5-card hand evaluation** — recognises all poker hands from High Card to Royal Flush
- **Monte Carlo win probability** — simulates 5 000 random opponent hands to calculate Win / Tie / Lose %
- **Action suggestion** — color-coded RAISE / CALL / CAUTION / FOLD based on effective win %
- **Opponent range breakdown** — shows how often the opponent lands each hand type and what % of those beat yours
- **DOM auto-scan** — attempts to read cards from the page automatically; falls back to manual input
- **No API key needed** — pure client-side math, zero network calls

### Market Sniper (Green "MKT" bubble)

A market profit finder that scans item market and bazaar prices for your watchlist items, detects underpriced deals, and calculates profit metrics.

- **Watchlist scanning** — scans a configurable list of high-liquidity items (Xanax, FHC, Erotic DVD, Donator Pack, and more)
- **Dual-source pricing** — fetches item market (Torn API) and bazaar (TornW3B) floor prices
- **Profit calculator** — buy price, sell price, estimated tax, net profit, ROI% for each item
- **Filters & sorting** — minimum profit, minimum ROI, sort by profit/ROI/newest, hide dismissed deals
- **Notifications** — browser alerts on deals exceeding your profit/ROI thresholds (with dedup)
- **Bubble badge** — red counter showing how many profitable deals are available
- **Customizable watchlist** — add/remove items directly in the panel

### War Manager (Orange "MGR" bubble)

A war manager that scans both your faction and the enemy faction, estimates battle stats, and provides a comprehensive enemy report with live hospital timers.

- **Dual-faction scanning** — fetches own and enemy faction member rosters
- **Stat estimation** — scans member profiles, estimates total battle stats from rank, level, crimes, networth
- **Battle stat caching** — scanned stats persist for 24 hours in localStorage so members stay marked between sessions
- **Online enemy report** — shows all enemies grouped by status: Online in Torn, In Hospital, Abroad/Traveling, In Jail, Offline
- **Live hospital timers** — countdown timers that tick every second showing when hospitalized enemies will be released
- **Hospital section** — dedicated section for ALL hospitalized enemies (online or offline) sorted by soonest release
- **Battle stats on every row** — each member row shows their estimated stat range (or "not scanned" indicator)
- **Attack & profile links** per member — one-click attack link, profile link
- **Copy-paste reports** — copy individual sections or the full report for faction chat
- **Configurable polling** — 1min / 2min / 5min / 10min refresh rate
- **Auto enemy detection** — detects enemy faction from URL, page links, or API war data

### Traveler Utility (Blue airplane bubble)

A quick-travel navigation tool. Shows your current travel status and provides one-tap buttons to navigate to common destinations.

- **Travel status** — shows whether you're in Torn, abroad, or in flight with ETA countdown
- **Quick-travel buttons** — one tap to open the travel agency page for Mexico, Cayman Islands, or Canada
- **Abroad actions** — when abroad: open the shop page, or fly back to Torn
- **In-flight ETA** — progress bar and countdown timer while traveling
- **Arrival tips** — contextual tips for what to do when you arrive at your destination
- **Auto-polling** — refreshes travel status every 30 seconds while the panel is open

### Stock Trader (Gold "$" bubble)

A stock market analyzer that fetches real-time stock data, tracks price history, and generates buy/sell signals based on technical analysis.

- **Stock overview** — all Torn stocks with current price, daily change %, mini sparkline charts, and signal badges
- **Buy/sell signals** — computed from SMA crossover, RSI, momentum trends, support/resistance zones, and benefit ROI
- **7 signal levels** — STRONG BUY, BUY, LEAN BUY, HOLD, LEAN SELL, SELL, STRONG SELL
- **Stock detail view** — performance breakdown (1h/1d/1w/1m/1y), chart history, technical indicators (SMA-6, SMA-12, EMA-12, RSI-14)
- **Portfolio tracking** — your holdings with per-stock P&L, bonus progress, total portfolio value
- **Benefit ROI calculator** — for cash-paying stocks: investment cost, annual ROI, payback period
- **Watchlist** — track specific stocks with optional browser notifications on signals
- **Price history** — hourly snapshots stored locally for up to 7 days

---

## Scripts

| Script | Bubble | Purpose | API Calls |
|---|---|---|---|
| [**AI Advisor**](torn-assistant.md) | Blue "AI" | Status dashboard, happy-jump advisor, stock-block ROI, war timing, drug-free energy plan | Direct API fetching + passive interception |
| [**Plushie Prices**](torn-pda-deal-finder-bubble.md) | Purple teddy bear | Plushie bazaar vs item market price comparison | `market/{id}?selections=bazaar,itemmarket` (13 calls per refresh) |
| [**War Bubble**](torn-war-bubble.md) | Red "WAR" | Enemy faction online tracker, location buckets, timer analysis, attack links | `faction/{id}?selections=basic` (configurable 30s–10min) |
| [**Strip Poker Advisor**](torn-strip-poker-bubble.md) | Green "♠" | Poker hand evaluator, win probability, action suggestion | None (client-side only) |
| [**War Manager**](torn-war-manager-bubble.md) | Orange "MGR" | War target assignment, stat estimation, online enemy report, message generation | `faction/?selections=basic` + `user/{id}?selections=profile,personalstats,criminalrecord` |
| [**Bounty Filter**](torn-bounty-filter-bubble.md) | Orange "BTY" | Filter bounties by state (hospital/jail/abroad/in Torn), hospital timers, level, reward | `torn/?selections=bounties` + `user/{id}?selections=profile` |
| [**Market Sniper**](torn-market-sniper-bubble.md) | Green "MKT" | Market profit finder — scans watchlist items for underpriced deals, shows profit/ROI | `/v2/market/{id}/itemmarket` + TornW3B bazaar (16 calls per scan) |
| [**Traveler Utility**](torn-traveler-utility.md) | Blue airplane | Quick-travel navigation, travel status, abroad shop links, flight ETA | `user/?selections=travel,profile` (1 call per 30s) |
| [**Stock Trader**](torn-stock-trader.md) | Gold "$" | Stock market analyzer — price tracking, SMA/EMA/RSI signals, buy/sell recommendations, portfolio P&L | `/v2/torn/stocks` + `/v2/torn/{id}/stocks` + `/v2/user/stocks` (~17 calls per refresh) |

---

## Design Philosophy

### 1. No Automation

Every script adheres to Torn's core rule: **one click = one action**. None of the scripts:
- Initiate attacks, purchases, travel, training, or any game action
- Chain multiple actions from a single user interaction
- Auto-refresh pages or auto-submit forms
- Click buttons or interact with game UI elements programmatically

### 2. Minimal Data Footprint

- **Plushie Prices** makes **13** API calls per refresh (one per plushie), fetching bazaar and item market listings. Calls are spaced 250ms apart. Prices are cached for 10 minutes.
- **AI Advisor** makes direct API calls for `user` and `faction` data using the user's own key, and also passively intercepts existing traffic for additional data.
- **War Bubble** makes **one** read-only API call per polling cycle (configurable: 30s / 1min / 2min / 5min / 10min, only while the panel is open) using the minimum `selections=basic` endpoint.
- **Strip Poker Advisor** makes **zero** API calls — it runs entirely on client-side poker math (Monte Carlo simulation).
- **Market Sniper** makes **16** API calls per scan (8 watchlist items × 2 sources). Calls are spaced 300ms apart. Prices are cached for 5 minutes.
- **Traveler Utility** makes **1** API call per 30-second poll cycle (only while the panel is open).

### 3. Transparent API Key Handling

All scripts that need an API key use a three-tier priority system:

| Priority | Source | How | Storage |
|---|---|---|---|
| 1 (highest) | **Torn PDA injection** | PDA replaces `###PDA-APIKEY###` in the script source at injection time | In-memory (part of script source) |
| 2 | **Manual entry** | User pastes key in the panel's key field | `localStorage` |
| 3 (lowest) | **Network interception** | Reads the `key=` param from Torn API URLs that PDA/browser sends | In-memory only |

- In **Torn PDA**, the key is loaded automatically — no user action needed.
- In **Tampermonkey/Greasemonkey**, use the manual entry field (PDA injection is unavailable).
- The key is **never sent to any external server** — only to `api.torn.com`.

### 4. Local-Only Data

- No external servers are contacted (other than `api.torn.com`).
- All cached data lives in the browser's `localStorage` with automatic expiry and size limits.
- No analytics, telemetry, or tracking of any kind.

---

## Torn Policy Compliance Summary

| Requirement | AI Advisor | Plushie Prices | War Bubble | Strip Poker | War Manager | Bounty Filter | Market Sniper | Traveler Utility | Stock Trader |
|---|---|---|---|---|---|---|---|---|---|
| No game-action automation | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant |
| One-click-one-action | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant |
| No API key extraction/abuse | PDA key auto-injected; manual fallback; own key only | Own key stored locally; PDA/manual/intercepted | PDA key auto-injected; manual fallback; own key only | No API key needed | PDA key auto-injected; manual fallback; own key only | Own key stored locally; PDA/manual/intercepted | Own key stored locally; PDA/manual/intercepted | Own key stored locally; PDA/manual/intercepted | Own key stored locally; PDA/manual/intercepted |
| No external server comms | Only `api.torn.com` | Only `api.torn.com` | Only `api.torn.com` | None at all | Only `api.torn.com` | Only `api.torn.com` | `api.torn.com` + `weav3r.dev` (item IDs only) | Only `api.torn.com` | Only `api.torn.com` |
| API rate limits respected | On-demand only | 13 calls per refresh, 250ms apart, 10-min cache | Configurable 30s–10min (well under 100/min) | N/A (no API calls) | 2 faction + N profile calls, 650ms gaps | 1 + up to 30 calls, 350ms gaps, 1-2 min cache | 16 calls per scan, 300ms apart, 5-min cache | 1 call per 30s (~2/min) | ~17 calls per refresh, 350ms gaps, 5-15 min cache |
| No request modification | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant |
| Read-only display | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant | Compliant |

For a detailed compliance breakdown, see each script's individual documentation in the `docs/` folder.

---

## Shared Architecture

All eight scripts share a common bubble/panel architecture:

```
┌─────────────┐     click      ┌──────────────────┐
│  Draggable  │ ─────────────▶ │  Expandable panel │
│  bubble     │                │  (draggable)      │
│  (56×56px)  │ ◀───────────── │                   │
└─────────────┘   collapse     └──────────────────┘
```

### Common Patterns
- **IIFE wrapper** — each script is a self-contained immediately-invoked function
- **Passive fetch/XHR hooks** — monkey-patch `window.fetch` and `XMLHttpRequest` to clone and read API responses without modifying them
- **Draggable UI** — pointer-event-based drag with position persistence in `localStorage`
- **Viewport clamping** — panels and bubbles stay within the visible area on resize
- **Deep merge** — API payloads are incrementally merged into state so partial responses build up a complete picture over time
- **HTML escaping** — all user-facing text is escaped via `escapeHtml()` to prevent XSS
- **Debug log** — collapsible log panel at the bottom of each script's panel with timestamped entries and a "Copy Log" button for easy bug reporting
- **Stacked z-index** — each bubble/panel uses a separate z-index base so multiple overlays can coexist

### Shared Utility Functions (duplicated in each script)
| Function | Purpose |
|---|---|
| `safeJsonParse(text)` | JSON.parse with try/catch |
| `deepMerge(target, source)` | Recursive object merge |
| `formatNumber(n)` | Locale-formatted number |
| `formatMoney(n)` | Dollar-prefixed locale number |
| `formatSeconds(sec)` | Human-readable duration (e.g., `2d 5h 30m`) |
| `ageText(ts)` | "X ago" relative time |
| `escapeHtml(str)` | XSS-safe HTML escaping |
| `addLog(msg)` | Appends timestamped entry to debug log (max 100 entries) |
| `getStorage(key, fallback)` | Safe localStorage getter |
| `setStorage(key, value)` | Safe localStorage setter |
| `clampToViewport(...)` | Keep elements within visible bounds |
| `bringToFront(el)` | Increment z-index for focus |

> **Note:** These utilities are intentionally duplicated rather than shared via a common module, because each script is designed to be a standalone userscript installable independently.

---

## Installation

### Torn PDA (recommended)
1. Open **Torn PDA** → Settings → **Userscripts**
2. Add a new script for each `.user.js` file you want to use
3. Paste the script contents
4. Set the match pattern to `https://www.torn.com/*`
5. **Set Injection Time to `Start`** — this is required so fetch/XHR hooks capture API traffic during page load
6. Save and reload any Torn page
7. The bubble(s) will appear in the bottom-right corner

### Tampermonkey / Greasemonkey (desktop browsers)
1. Install the [Tampermonkey](https://www.tampermonkey.net/) or Greasemonkey extension
2. Create a new script for each `.user.js` file
3. Paste the script contents and save
4. Navigate to `torn.com` — the bubble(s) will appear

### Multiple Scripts
All eight scripts can run simultaneously. They use separate z-index bases and auto-stack their bubbles vertically to avoid overlap.

---

## Using the Bubbles on PC (Tampermonkey / Greasemonkey)

When running in a desktop browser with Tampermonkey or Greasemonkey, the bubble UI works like this:

### Bubble Controls
- **Click** the bubble to open its panel
- **Drag** the bubble to move it anywhere on screen — it remembers its position between page loads
- Bubbles auto-stack vertically in the bottom-right corner so they don't overlap

### Panel Controls
- **Drag the header bar** (the dark bar at the top with the title) to reposition the panel
- **Click the close button** (circle icon in the top-right of the header) to collapse back to the bubble
- Panel position is saved between page loads

### Keyboard Shortcuts
- There are no keyboard shortcuts — all interaction is mouse-based (click and drag)

### Tips for Desktop Use
- **Multiple panels can be open at once** — each script has its own z-index, so panels stack on top of each other. Click a panel's header to bring it to the front.
- **Resize-safe** — if you resize your browser window, bubbles and panels automatically clamp to stay within the visible area
- **API key entry** — click the "API Key" section header in any panel to expand it, paste your Torn API key, and click Save. The key is shared across all scripts (saved once = works everywhere).
- **Scrollable content** — if a panel has more content than fits on screen, the body area scrolls independently while the header stays fixed
- **Copy buttons** — most sections have "Copy" buttons that copy formatted text to your clipboard for pasting into faction chat

---

## Repository Structure

```
Torn_Dark_tools/
├── AGENTS.md                              ← Developer reference (architecture, PDA internals, policies)
├── README.md                              ← this file
├── build.py                               ← Build script: injects common.js into src/*.src.js → output .user.js
├── urls                                   ← raw GitHub URLs for Torn PDA remote loading
├── docs/
│   ├── torn-api-patterns.md               ← Torn API patterns, DOM selectors, community research
│   └── community-repos.md                 ← Community Torn script repos analysis & learnings
├── src/
│   ├── common.js                          ← Shared utilities injected into all scripts at build time
│   ├── torn-assistant.src.js              ← AI Advisor source
│   ├── torn-pda-deal-finder-bubble.src.js ← Plushie Prices source
│   ├── torn-war-bubble.src.js             ← War Bubble source
│   ├── torn-strip-poker-bubble.src.js     ← Strip Poker Advisor source
│   ├── torn-bounty-filter-bubble.src.js   ← Bounty Filter source
│   ├── torn-market-sniper.src.js          ← Market Sniper source
│   ├── torn-traveler-utility.src.js       ← Traveler Utility source
│   └── torn-stock-trader.src.js           ← Stock Trader source
├── torn-assistant.user.js                 ← AI Advisor bubble (built output)
├── torn-assistant.md                      ← AI Advisor documentation
├── torn-pda-deal-finder-bubble.user.js    ← Plushie Prices bubble (built output)
├── torn-pda-deal-finder-bubble.md         ← Plushie Prices documentation
├── torn-war-bubble.user.js                ← War Online bubble (built output)
├── torn-war-bubble.md                     ← War Bubble documentation
├── torn-strip-poker-bubble.user.js        ← Strip Poker Advisor bubble (built output)
├── torn-strip-poker-bubble.md             ← Strip Poker Advisor documentation
├── torn-bounty-filter-bubble.user.js      ← Bounty Filter bubble (built output)
├── torn-bounty-filter-bubble.md           ← Bounty Filter documentation
├── torn-market-sniper-bubble.user.js      ← Market Sniper bubble (built output)
├── torn-market-sniper-bubble.md           ← Market Sniper documentation
├── torn-traveler-utility-bubble.user.js   ← Traveler Utility bubble (built output)
├── torn-traveler-utility.md               ← Traveler Utility documentation
├── torn-stock-trader-bubble.user.js       ← Stock Trader bubble (built output)
└── torn-stock-trader.md                   ← Stock Trader documentation
```

---

## Code Quality Improvements Applied

During the review process, the following improvements were made:

1. **Bug fix (AI Advisor):** `makeDraggableBubble` initialized `startX`/`startY` as `0` but compared them to `null`, meaning the drag-end handler could never fire on the first drag. Fixed to initialize as `null`.

2. **Automatic PDA key injection (AI Advisor, War Bubble):** Scripts use the `###PDA-APIKEY###` placeholder that Torn PDA replaces at injection time, so the API key is loaded automatically with zero user config. Manual entry is kept as a fallback for non-PDA environments.

3. **Direct API fetching (AI Advisor):** Added `fetchDirectData()` for `user` and `faction` endpoints, since Torn PDA's native API calls bypass the WebView and are invisible to fetch/XHR hooks.

4. **War timing & drug-free energy plan (AI Advisor):** New advisory cards for faction war readiness and optimal drug-free energy usage.

5. **Configurable poll interval (War Bubble):** Dropdown to set the refresh rate: 30s / 1min / 2min / 5min / 10min (default 1min).

6. **Attack buttons (War Bubble):** Each enemy member row has Copy Attack URL, Copy Name, and "Go Attack" link buttons.

7. **Plushie Prices v2.0 rewrite:** Completely reworked the Deal Finder into a dedicated plushie price checker. Fetches bazaar and item market prices for all 13 Torn plushies via the Torn API, displays a sortable comparison table with best-price highlighting and full-set cost, with 10-minute price caching.

8. **Timer track cleanup (War Bubble):** Added automatic pruning of the timer-change history — max 500 entries, 7-day TTL — to prevent unbounded `localStorage` growth.

9. **Debug log panels (all scripts):** Collapsible log section at the bottom of each panel with timestamped event entries and a "Copy Log" button for sharing during bug reports.

10. **API response normalization (AI Advisor):** Torn API v1 returns bars (`energy`, `nerve`, etc.), battle stats, and money at the top level — not nested under wrapper objects. `mergeUserData()` now normalizes both V1 (flat) and V2 (nested with `.value` properties) response formats into the `user.bars`, `user.battlestats`, and `user.money` structures the rendering code expects. Also handles PDA-intercepted V2 calls. Fixed energy/stats showing 0/0.

11. **Line ending normalization:** Converted all files from CRLF to LF for cross-platform consistency.

---

## Contributing Rules

- **When adding or renaming a `.user.js` script, always update the `urls` file** with the corresponding raw GitHub URL (`https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/<filename>`). This file is used by Torn PDA for remote script loading.

---

## License

These scripts are provided as-is for personal use with the Torn City game. Use at your own risk. The authors are not responsible for any consequences of using these scripts, including but not limited to account actions by Torn staff.

---

## Disclaimer

These tools are **not affiliated with or endorsed by** Torn City, Chedburn Ltd, or the Torn PDA project. They are community-created tools that aim to comply with Torn's rules and policies. If Torn's rules change, these scripts should be re-evaluated for compliance.
