# Torn PDA - Safe AI Advisor Bubble

## Overview

A local-only advisory overlay for [Torn City](https://www.torn.com) that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable chat-head bubble that expands into a panel showing player status, cooldowns, stock-block ROI estimates, war timing, drug-free energy planning, and general gameplay advice.

**The script is strictly read-only. It never clicks, buys, sells, attacks, or performs any game action on the player's behalf.**

## Features

| Feature | Description |
|---|---|
| **Status card** | Displays cached energy, nerve, happy, drug / booster / medical cooldowns |
| **Happy Jump Advisor** | Scores the current bar & cooldown state to estimate readiness for a "happy jump" training window |
| **Stock Block ROI** | Shows the closest next stock-benefit block for each held stock, estimated cost, and rough cash-payback days for cash-returning blocks |
| **War Timing card** | Faction war readiness advisory based on current status and cooldowns |
| **Drug-Free Energy Plan** | Optimal energy usage plan without drugs, based on current bars and cooldowns |
| **Battle stats** | Shows cached STR / SPD / DEX / DEF |
| **Funds** | Cash on hand and bank balance |
| **Advice panel** | Contextual tips (energy cap warning, nerve cap warning, jump-window hints, nearest stock blocks) |
| **Debug log** | Collapsible log panel with timestamped events and a "Copy Log" button for bug reporting |

## How It Works

```
┌────────────────────────────────────────────────┐
│            API Key Resolution                   │
│                                                 │
│  Priority 1: ###PDA-APIKEY### (Torn PDA auto)  │
│  Priority 2: Manual entry (localStorage)        │
│  Priority 3: Network interception (fallback)    │
└──────────────────┬─────────────────────────────┘
                   │
    ┌──────────────▼──────────────┐
    │     fetchDirectData()       │  Direct API calls for
    │  api.torn.com/user          │  user + faction data
    │  api.torn.com/faction       │  (on init + on refresh)
    └──────────────┬──────────────┘
                   │
    ┌──────────────▼──────────────┐
    │  hookFetch / hookXHR        │  Passive read-only interception
    │  (clones responses)         │  of existing API traffic for
    │                             │  additional data (torn/market)
    └──────────────┬──────────────┘
                   │
           STATE.userData / STATE.tornData / STATE.factionData
                   │
             renderPanel()  ──▷  UI overlay
```

1. On startup, the script resolves the API key using a three-tier priority: PDA injection > saved manual key > network interception.
2. If a key is available, `fetchDirectData()` makes direct calls to `api.torn.com/user` and `api.torn.com/faction` for immediate data.
3. The script also monkey-patches `window.fetch` and `XMLHttpRequest` to passively intercept additional API responses (e.g., torn/market data).
4. All data is merged into an in-memory `STATE` object.
5. When the user opens the panel, `renderPanel()` builds an HTML summary from that state.

## API Key Handling

| Priority | Source | How | Storage |
|---|---|---|---|
| 1 (highest) | **Torn PDA injection** | PDA replaces `###PDA-APIKEY###` in the script source at injection time | In-memory (part of script source) |
| 2 | **Manual entry** | User pastes key in the panel's key field | `localStorage` |
| 3 (lowest) | **Network interception** | Reads the `key=` param from Torn API URLs the app sends | In-memory only |

- In **Torn PDA**, the key loads automatically — no user action needed.
- In **Tampermonkey/Greasemonkey**, use the manual entry field.
- The key is **never sent to any external server** — only to `api.torn.com`.

## Data Sources

| Source | Method | Notes |
|---|---|---|
| User bars, cooldowns, battle stats, money | Direct API call (`user` endpoint) + passive interception | Direct call on init; interception catches additional data |
| Faction data | Direct API call (`faction` endpoint) + passive interception | Used for war timing card |
| Stock market data | Passive interception of `api.torn.com/torn` responses | Requires the user to visit the stock page once |
| Stock benefit rules | Hard-coded `STOCK_RULES` table | Static reference data (share thresholds, benefit types, payout frequencies) |

## Torn Policy Compliance

| Rule | Status |
|---|---|
| No automation of game actions | Fully compliant — the script never initiates attacks, purchases, travel, training, or any game action |
| One-click-one-action principle | Fully compliant — no game actions are triggered at all |
| Read-only data display | Fully compliant — all data shown is derived from API responses |
| API key handling | Uses PDA's own injection mechanism (`###PDA-APIKEY###`); manual entry as fallback; the user's own key only |
| No external server communication | Fully compliant — only calls `api.torn.com` using the user's own key |
| API rate limiting | Direct calls are on-demand only (init + manual refresh), well within rate limits |
| Passive fetch/XHR interception | Tolerated pattern — same technique used by TornTools and other widely-accepted community scripts |
| localStorage usage | UI position persistence, manual API key (if entered), debug log (in-memory only) |

## Installation

### Torn PDA
1. Open **Torn PDA** → Settings → **Userscripts**
2. Add a new script
3. Paste the contents of `torn-assistant.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. Save and reload any Torn page
6. The API key is loaded automatically — no configuration needed

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-assistant.user.js`
3. Save — the script will activate on all `torn.com` pages
4. Open the panel and enter your Torn API key in the key field

## UI Controls

- **Bubble** — tap to expand the panel; drag to reposition
- **Refresh** button — re-renders the panel with the latest cached data and triggers a fresh API fetch
- **○** button — collapses the panel back to the bubble
- **API key field** — manual key entry (optional in Torn PDA, required in Tampermonkey)
- **Debug Log** section — tap the header to expand; "Copy Log" copies all entries to clipboard
- Both bubble and panel positions are remembered in `localStorage`

## Limitations

- Data freshness depends on which Torn PDA pages the user has visited in the current session (e.g., stock data requires visiting the stock market page).
- The Happy Jump Advisor is heuristic-based and should not replace manual judgment.
- Stock ROI estimates are rough: they only model cash-returning blocks and ignore share-price movement.
- Outside Torn PDA, the `###PDA-APIKEY###` placeholder is not replaced, so manual key entry is required.
