# Torn PDA - Safe AI Advisor Bubble

## Overview

A local-only advisory overlay for [Torn City](https://www.torn.com) that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable chat-head bubble that expands into a panel showing player status, cooldowns, stock-block ROI estimates, and general gameplay advice.

**The script is strictly read-only. It never clicks, buys, sells, attacks, or performs any game action on the player's behalf.**

## Features

| Feature | Description |
|---|---|
| **Status card** | Displays cached energy, nerve, happy, drug / booster / medical cooldowns |
| **Happy Jump Advisor** | Scores the current bar & cooldown state to estimate readiness for a "happy jump" training window |
| **Stock Block ROI** | Shows the closest next stock-benefit block for each held stock, estimated cost, and rough cash-payback days for cash-returning blocks |
| **Battle stats** | Shows cached STR / SPD / DEX / DEF |
| **Funds** | Cash on hand and bank balance |
| **Advice panel** | Contextual tips (energy cap warning, nerve cap warning, jump-window hints, nearest stock blocks) |

## How It Works

```
Torn page  ──fetch/XHR──▷  api.torn.com
                │
          (response flows back)
                │
     ┌──────────▼──────────┐
     │  hookFetch / hookXHR │   Passive read-only interception
     │  (clones response)   │   of responses already in transit.
     └──────────┬──────────┘   Original response is untouched.
                │
        STATE.userData / STATE.tornData
                │
          renderPanel()  ──▷  UI overlay
```

1. The script monkey-patches `window.fetch` and `XMLHttpRequest` to **clone and read** API responses that Torn PDA (or the browser) already sends.
2. It merges the parsed JSON into an in-memory `STATE` object.
3. When the user opens the panel, `renderPanel()` builds an HTML summary from that state.
4. No additional API calls are made. No data leaves the browser.

## Data Sources

| Source | Method | Notes |
|---|---|---|
| User bars, cooldowns, battle stats, money | Passive interception of `api.torn.com/user` responses | Only reads responses the app already makes |
| Stock market data | Passive interception of `api.torn.com/torn` responses | Requires the user to visit the stock page once |
| Stock benefit rules | Hard-coded `STOCK_RULES` table | Static reference data (share thresholds, benefit types, payout frequencies) |

## Torn Policy Compliance

| Rule | Status |
|---|---|
| No automation of game actions | Fully compliant — the script never initiates attacks, purchases, travel, training, or any game action |
| One-click-one-action principle | Fully compliant — no game actions are triggered at all |
| Read-only data display | Fully compliant — all data shown is derived from API responses the app already fetches |
| No API key extraction | Fully compliant — the script does not read, store, or transmit any API key |
| No external server communication | Fully compliant — zero outbound network requests; all data stays in the browser |
| Passive fetch/XHR interception | Tolerated pattern — same technique used by TornTools and other widely-accepted community scripts |
| localStorage usage | Only for UI position persistence (bubble/panel coordinates) |

## Installation

### Torn PDA
1. Open **Torn PDA** → Settings → **Userscripts**
2. Add a new script
3. Paste the contents of `torn-assistant.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. Save and reload any Torn page

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-assistant.user.js`
3. Save — the script will activate on all `torn.com` pages

## UI Controls

- **Bubble** — tap to expand the panel; drag to reposition
- **Refresh** button — re-renders the panel with the latest cached data
- **○** button — collapses the panel back to the bubble
- Both bubble and panel positions are remembered in `localStorage`

## Limitations

- Data freshness depends on which Torn PDA pages the user has visited in the current session (e.g., stock data requires visiting the stock market page).
- The Happy Jump Advisor is heuristic-based and should not replace manual judgment.
- Stock ROI estimates are rough: they only model cash-returning blocks and ignore share-price movement.
