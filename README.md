# Torn Dark Tools

A collection of **local-only, read-only** userscript overlays for [Torn City](https://www.torn.com), designed primarily for [Torn PDA](https://github.com/Mephiles/torn-pda) but also compatible with Tampermonkey / Greasemonkey in desktop browsers.

All scripts follow a **display-only** philosophy: they show information derived from existing API traffic or page content but **never automate, click, buy, sell, attack, or perform any game action**.

---

## Scripts

| Script | Bubble | Purpose | API Calls |
|---|---|---|---|
| [**AI Advisor**](torn-assistant.md) | Blue "AI" | Status dashboard, happy-jump advisor, stock-block ROI, war timing, drug-free energy plan | Direct API fetching + passive interception |
| [**Deal Finder**](torn-pda-deal-finder-bubble.md) | Green "DF" | Item Market / Bazaar flip-profit calculator | None — DOM scraping + passive interception |
| [**War Bubble**](torn-war-bubble.md) | Red "WAR" | Enemy faction online tracker, location buckets, timer analysis, attack links | `faction/{id}?selections=basic` (configurable 30s–10min) |

---

## Design Philosophy

### 1. No Automation

Every script adheres to Torn's core rule: **one click = one action**. None of the scripts:
- Initiate attacks, purchases, travel, training, or any game action
- Chain multiple actions from a single user interaction
- Auto-refresh pages or auto-submit forms
- Click buttons or interact with game UI elements programmatically

### 2. Minimal Data Footprint

- **Deal Finder** makes **zero** additional network requests. It passively reads API responses that Torn PDA (or the browser) already sends and scrapes visible DOM content.
- **AI Advisor** makes direct API calls for `user` and `faction` data using the user's own key, and also passively intercepts existing traffic for additional data.
- **War Bubble** makes **one** read-only API call per polling cycle (configurable: 30s / 1min / 2min / 5min / 10min, only while the panel is open) using the minimum `selections=basic` endpoint.

### 3. Transparent API Key Handling

All scripts that need an API key use a three-tier priority system:

| Priority | Source | How | Storage |
|---|---|---|---|
| 1 (highest) | **Torn PDA injection** | PDA replaces `###PDA-APIKEY###` in the script source at injection time | In-memory (part of script source) |
| 2 | **Manual entry** | User pastes key in the panel's key field | `localStorage` |
| 3 (lowest) | **Network interception** | Reads the `key=` param from Torn API URLs that PDA/browser sends | In-memory only |

- In **Torn PDA**, the key is loaded automatically — no user action needed.
- In **Tampermonkey/Greasemonkey**, use the manual entry field (PDA injection is unavailable).
- **Deal Finder** does not use any API key.
- The key is **never sent to any external server** — only to `api.torn.com`.

### 4. Local-Only Data

- No external servers are contacted (other than `api.torn.com` by the War Bubble).
- All cached data lives in the browser's `localStorage` with automatic expiry and size limits.
- No analytics, telemetry, or tracking of any kind.

---

## Torn Policy Compliance Summary

| Requirement | AI Advisor | Deal Finder | War Bubble |
|---|---|---|---|
| No game-action automation | Compliant | Compliant | Compliant |
| One-click-one-action | Compliant | Compliant | Compliant |
| No API key extraction/abuse | PDA key auto-injected; manual fallback; own key only | No key used | PDA key auto-injected; manual fallback; own key only |
| No external server comms | Only `api.torn.com` | Compliant | Only `api.torn.com` |
| API rate limits respected | On-demand only | N/A | Configurable 30s–10min (well under 100/min) |
| No request modification | Compliant | Compliant | Compliant |
| Read-only display | Compliant | Compliant | Compliant |

For a detailed compliance breakdown, see each script's individual documentation in the `docs/` folder.

---

## Shared Architecture

All three scripts share a common bubble/panel architecture:

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
5. Save and reload any Torn page
6. The bubble(s) will appear in the bottom-right corner

### Tampermonkey / Greasemonkey (desktop browsers)
1. Install the [Tampermonkey](https://www.tampermonkey.net/) or Greasemonkey extension
2. Create a new script for each `.user.js` file
3. Paste the script contents and save
4. Navigate to `torn.com` — the bubble(s) will appear

### Multiple Scripts
All three scripts can run simultaneously. They use separate z-index bases and auto-stack their bubbles vertically to avoid overlap.

---

## Repository Structure

```
Torn_Dark_tools/
├── AGENTS.md                              ← Developer reference (architecture, PDA internals, policies)
├── README.md                              ← this file
├── urls                                   ← raw GitHub URLs for Torn PDA remote loading
├── torn-assistant.user.js                 ← AI Advisor bubble script
├── torn-assistant.md                      ← AI Advisor documentation
├── torn-pda-deal-finder-bubble.user.js    ← Deal Finder bubble script
├── torn-pda-deal-finder-bubble.md         ← Deal Finder documentation
├── torn-war-bubble.user.js                ← War Online bubble script
└── torn-war-bubble.md                     ← War Bubble documentation
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

7. **Cache expiry (Deal Finder):** Added automatic cache pruning — max 200 items, 7-day TTL — to prevent unbounded `localStorage` growth.

8. **Timer track cleanup (War Bubble):** Added automatic pruning of the timer-change history — max 500 entries, 7-day TTL — to prevent unbounded `localStorage` growth.

9. **DOM scraping optimization (Deal Finder):** `scrapeListingsFromDom()` now tries targeted CSS selectors first before falling back to the broad `li, tr, div` scan, improving performance on mobile devices.

10. **Debug log panels (all scripts):** Collapsible log section at the bottom of each panel with timestamped event entries and a "Copy Log" button for sharing during bug reports.

11. **API response normalization (AI Advisor):** Torn API v1 returns bars (`energy`, `nerve`, etc.), battle stats, and money at the top level — not nested under wrapper objects. `mergeUserData()` now normalizes the flat response into the `user.bars`, `user.battlestats`, and `user.money` structures the rendering code expects. This fixed energy/stats showing 0/0.

12. **Line ending normalization:** Converted all files from CRLF to LF for cross-platform consistency.

---

## Contributing Rules

- **When adding or renaming a `.user.js` script, always update the `urls` file** with the corresponding raw GitHub URL (`https://raw.githubusercontent.com/AlexTzib/Torn_Dark_tools/main/<filename>`). This file is used by Torn PDA for remote script loading.

---

## License

These scripts are provided as-is for personal use with the Torn City game. Use at your own risk. The authors are not responsible for any consequences of using these scripts, including but not limited to account actions by Torn staff.

---

## Disclaimer

These tools are **not affiliated with or endorsed by** Torn City, Chedburn Ltd, or the Torn PDA project. They are community-created tools that aim to comply with Torn's rules and policies. If Torn's rules change, these scripts should be re-evaluated for compliance.
