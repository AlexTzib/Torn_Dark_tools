# Torn Dark Tools

A collection of **local-only, read-only** userscript overlays for [Torn City](https://www.torn.com), designed primarily for [Torn PDA](https://github.com/Mephiles/torn-pda) but also compatible with Tampermonkey / Greasemonkey in desktop browsers.

All scripts follow a **display-only** philosophy: they show information derived from existing API traffic or page content but **never automate, click, buy, sell, attack, or perform any game action**.

---

## Scripts

| Script | Bubble | Purpose | API Calls |
|---|---|---|---|
| [**AI Advisor**](docs/torn-assistant.md) | Blue "AI" | Status dashboard, happy-jump advisor, stock-block ROI, advice | None — passive interception only |
| [**Deal Finder**](docs/torn-pda-deal-finder-bubble.md) | Green "DF" | Item Market / Bazaar flip-profit calculator | None — DOM scraping + passive interception |
| [**War Bubble**](docs/torn-war-bubble.md) | Red "WAR" | Enemy faction online tracker, location buckets, timer analysis | `faction/{id}?selections=basic` (1 call / 60s) |

---

## Design Philosophy

### 1. No Automation

Every script adheres to Torn's core rule: **one click = one action**. None of the scripts:
- Initiate attacks, purchases, travel, training, or any game action
- Chain multiple actions from a single user interaction
- Auto-refresh pages or auto-submit forms
- Click buttons or interact with game UI elements programmatically

### 2. Minimal Data Footprint

- **AI Advisor** and **Deal Finder** make **zero** additional network requests. They passively read API responses that Torn PDA (or the browser) already sends and scrape visible DOM content.
- **War Bubble** makes **one** read-only API call per 60-second polling cycle (only while the panel is open) using the minimum `selections=basic` endpoint.

### 3. Transparent API Key Handling

- **AI Advisor** and **Deal Finder** do not touch API keys at all.
- **War Bubble** prefers a **manually entered** API key (stored in `localStorage`). As a fallback, it can detect the key from Torn PDA's own network traffic (stored in memory only, never persisted, never sent externally). The key is used exclusively for direct calls to `api.torn.com`.

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
| No API key extraction/abuse | No key used | No key used | Manual entry preferred; fallback uses user's own key from PDA traffic |
| No external server comms | Compliant | Compliant | Only `api.torn.com` |
| API rate limits respected | N/A | N/A | 1 req/60s (well under 100/min) |
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
├── README.md                              ← this file
├── torn-assistant.user.js                 ← AI Advisor bubble script
├── torn-pda-deal-finder-bubble.user.js    ← Deal Finder bubble script
├── torn-war-bubble.user.js                ← War Online bubble script
└── docs/
    ├── torn-assistant.md                  ← AI Advisor documentation
    ├── torn-pda-deal-finder-bubble.md     ← Deal Finder documentation
    └── torn-war-bubble.md                 ← War Bubble documentation
```

---

## Code Quality Improvements Applied

During the review process, the following improvements were made:

1. **Bug fix (AI Advisor):** `makeDraggableBubble` initialized `startX`/`startY` as `0` but compared them to `null`, meaning the drag-end handler could never fire on the first drag. Fixed to initialize as `null`.

2. **API key handling (War Bubble):** Added a manual API key input field as the **preferred** method, with the network-interception fallback clearly documented. The manual key is persisted in `localStorage`; the intercepted key remains memory-only.

3. **Cache expiry (Deal Finder):** Added automatic cache pruning — max 200 items, 7-day TTL — to prevent unbounded `localStorage` growth.

4. **Timer track cleanup (War Bubble):** Added automatic pruning of the timer-change history — max 500 entries, 7-day TTL — to prevent unbounded `localStorage` growth.

5. **DOM scraping optimization (Deal Finder):** `scrapeListingsFromDom()` now tries targeted CSS selectors first (`.items-list li`, `[class*="market"] li`, etc.) before falling back to the broad `li, tr, div` scan, improving performance on mobile devices.

6. **Line ending normalization:** Converted all files from CRLF to LF for cross-platform consistency.

---

## License

These scripts are provided as-is for personal use with the Torn City game. Use at your own risk. The authors are not responsible for any consequences of using these scripts, including but not limited to account actions by Torn staff.

---

## Disclaimer

These tools are **not affiliated with or endorsed by** Torn City, Chedburn Ltd, or the Torn PDA project. They are community-created tools that aim to comply with Torn's rules and policies. If Torn's rules change, these scripts should be re-evaluated for compliance.
