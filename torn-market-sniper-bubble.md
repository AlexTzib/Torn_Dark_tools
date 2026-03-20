# Dark Tools - Market Sniper

## Overview

A market profit finder overlay for [Torn City](https://www.torn.com) that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable bubble that expands into a panel showing profitable deals by comparing buy prices (item market and bazaar floors) against expected sell prices (market average). Includes configurable filters, a customizable watchlist, deal dismissal, and optional notifications for high-value opportunities.

**The script is read-only. It never buys, sells, lists, or performs any game action on the player's behalf.**

## Features

|| Feature | Description |
||---|---|
|| **Watchlist scanning** | Scans a configurable list of high-liquidity items (default: Xanax, Vicodin, FHC, Erotic DVD, Donator Pack, Energy Drink, Morphine, SED) |
|| **Dual-source pricing** | Fetches both item market (Torn API v2) and bazaar (TornW3B) floor prices for each item |
|| **Profit calculation** | For each item: buy price (best floor), sell price (market avg), tax estimate, net profit, ROI% |
|| **Filters** | Minimum net profit, minimum ROI%, profitable-only toggle, hide dismissed deals |
|| **Sort options** | Sort by net profit, ROI%, or newest (discovery time); ascending or descending |
|| **Configurable tax** | Adjustable tax% field for conservative profit estimates (default 0%) |
|| **Deal dismissal** | Dismiss individual deals (auto-expires after 1 hour); bulk clear option |
|| **Watchlist editor** | Add/remove items from the watchlist directly in the panel |
|| **Notifications** | Browser notifications for deals exceeding configurable profit/ROI thresholds (with 5-min dedup) |
|| **Bubble badge** | Red badge on the bubble showing count of active profitable deals |
|| **Auto-scan** | Prices auto-fetch when the panel is opened and cache is stale (5-minute TTL) |
|| **API key auto-detection** | Captures API key from PDA injection, manual entry, or network traffic interception |
|| **Price cache** | Caches fetched prices in `localStorage` with 5-minute TTL to avoid unnecessary API calls |
|| **Debug log** | Collapsible log panel with timestamped events and a "Copy" button for bug reporting |

## How It Works

```
┌────────────────────────────────────────────────┐
│  User taps bubble → panel opens                │
│                                                │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │ API key       │───▶│ scanAllItems()        │  │
│  │ (PDA/manual/  │    │ N watchlist items     │  │
│  │  intercepted) │    │ 300ms between each    │  │
│  └──────────────┘    └────────┬─────────────┘  │
│                               │                │
│          For each item (in parallel):          │
│    ┌──────────────────┐ ┌─────────────────┐    │
│    │ Torn API v2       │ │ TornW3B          │    │
│    │ /v2/market/{id}/  │ │ weav3r.dev/api/  │    │
│    │ itemmarket        │ │ marketplace/{id} │    │
│    └────────┬─────────┘ └───────┬─────────┘    │
│             │                   │               │
│             └─────────┬─────────┘               │
│                       │                         │
│            ┌──────────▼──────────┐              │
│            │ Extract floor prices │              │
│            │ best buy = min(both) │              │
│            │ sell = market avg    │              │
│            └──────────┬──────────┘              │
│                       │                         │
│            ┌──────────▼──────────┐              │
│            │ calcDealProfit()     │              │
│            │ (shared calculator)  │              │
│            │ net profit, ROI%,    │              │
│            │ tax estimate         │              │
│            └──────────┬──────────┘              │
│                       │                         │
│            ┌──────────▼──────────┐              │
│            │ Filter / Sort / Show │              │
│            │ + notify if above    │              │
│            │   thresholds         │              │
│            └──────────────────────┘              │
└────────────────────────────────────────────────┘
```

### Profit Calculation

For each watchlist item:
- **Buy price** = min(item market floor, bazaar floor) — the cheapest available option
- **Sell price** = item market average price — what the item typically trades at
- **Tax** = configurable percentage of sell price (default 0%)
- **Net profit** = sell price - buy price - tax
- **ROI%** = net profit / buy price × 100

The shared `calcDealProfit()` function in `common.js` handles this math and is reusable by future features.

### API Calls

The script makes **two parallel calls per watchlist item** (default 8 items = 16 total calls per scan):

1. **Item Market** — Torn API v2:
```
GET https://api.torn.com/v2/market/{item_id}/itemmarket?key={key}
```
Returns `{ itemmarket: { item: { name, average_price }, listings: [{ price, amount }] } }`. Floor price = cheapest listing.

2. **Bazaar** — TornW3B (third-party, no key needed):
```
GET https://weav3r.dev/api/marketplace/{item_id}
```
Returns `{ bazaar_average, listings: [{ price, quantity, player_name, ... }] }`. Floor price = cheapest listing.

> **Why TornW3B?** The Torn API v2 `bazaar` selection returns a bazaar *directory* (store names/stats), not per-item price listings. This is the same approach used by TornTools and the Plushie Prices script.

Calls are made sequentially per item (API + W3B in parallel), with a 300ms delay between items to stay within Torn's rate limit (~100 requests/minute). A full scan takes approximately 2-3 seconds for 8 items.

## Default Watchlist

|| ID | Name | Notes |
||---|---|---|
|| 206 | Xanax | High-demand drug, very liquid |
|| 196 | Vicodin | Common drug |
|| 367 | Feathery Hotel Coupon | FHC — popular special item |
|| 366 | Erotic DVD | Commonly traded special item |
|| 370 | Donator Pack | Commonly traded |
|| 283 | Energy Drink | Consumable |
|| 197 | Morphine | Medical item |
|| 398 | Small Explosive Device | SED — tactical item |

The watchlist is fully customizable — add or remove items in the Watchlist section of the panel.

## Data Sources

|| Source | Method | Notes |
||---|---|---|
|| Item market prices | Torn API v2 (`/v2/market/{id}/itemmarket`) | Returns `{ itemmarket: { listings: [{price, amount}], item: {name, average_price} } }`; floor from first listing |
|| Bazaar prices | TornW3B (`weav3r.dev/api/marketplace/{id}`) | Returns `{ bazaar_average, listings: [{price, quantity}] }`; floor from first listing. No API key needed. |
|| Profit math | Shared `calcDealProfit()` in `common.js` | buy, sell, tax%, extra fees → net profit, ROI% |
|| Notifications | Shared `tpdaNotify()` in `common.js` | Browser Notification API with dedup |
|| API key | PDA injection / manual entry / network interception | Three-tier priority system shared with other scripts |

## Torn Policy Compliance

|| Rule | Status |
||---|---|
|| No automation of game actions | Fully compliant — the script never buys, sells, lists, or clicks any game button. "Buy" links open the page for the user to act manually. |
|| One-click-one-action principle | Fully compliant — each link opens one browser tab, no chained actions |
|| Read-only data display | Fully compliant — all data shown is price information from the Torn API |
|| API key handling | User's own key only; stored locally in `localStorage`; never sent externally |
|| No external server communication | Contacts `api.torn.com` (item market) and `weav3r.dev` (bazaar prices via TornW3B). No user data is sent to TornW3B — only item IDs. |
|| API rate limits | 16 calls per scan (8 items × 2 sources), 300ms apart (~53/min); well under the 100/min limit |
|| Passive fetch/XHR interception | Used only to capture API key from existing traffic; does not modify requests |
|| localStorage usage | Price cache (5-min TTL), watchlist, settings, dismissed deals, API key, and UI positions only |

## Installation

### Torn PDA
1. Open **Torn PDA** → Settings → **Userscripts**
2. Add a new script
3. Paste the contents of `torn-market-sniper-bubble.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. **Set Injection Time to `Start`**
6. Save and reload any Torn page

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-market-sniper-bubble.user.js`
3. Save — the script will activate on all `torn.com` pages
4. Open the panel and enter your Torn API key (16 characters) in the key field

## UI Controls

- **Bubble (green, "MKT")** — tap to expand; drag to reposition; red badge shows profitable deal count
- **Scan** button — scans all watchlist items for current prices and deals
- **○** button — collapses the panel back to the bubble
- **Filters & Sort** — toggle profitable-only, hide dismissed, set min profit/ROI, choose sort order
- **Notifications** — toggle deal alerts, set profit/ROI thresholds
- **Watchlist** — collapsible editor to add/remove items by ID and name
- **Deal cards** — show item name, buy price (source), sell price, net profit, ROI%; "Buy" link + dismiss button
- **Clear dismissed** — removes all dismissed deal entries
- **Log** section — tap the header to expand; "Copy" copies all entries to clipboard

## Shared Components Created

This feature adds the following reusable shared components to `common.js`:

- **`calcDealProfit(buyPrice, sellPrice, taxPct, extraFees)`** — Returns `{ buyPrice, sellPrice, taxPct, taxAmount, extraFees, netProfit, roiPct }` or `null` if inputs are invalid. Reusable by stock ROI, bank ROI, trade helpers, etc.
- **`tpdaNotify(key, title, body, ttlMs)`** — Browser notification with duplicate suppression. Returns true if notification fired, false if suppressed.
- **`tpdaRequestNotifyPermission()`** — Requests browser notification permission if not yet granted.

## Limitations

- Requires an API key for item market prices (bazaar prices via TornW3B need no key).
- Each scan makes 2 calls per watchlist item. Avoid spamming the Scan button.
- Bazaar prices depend on TornW3B availability — if the service is down, only item market prices are shown.
- "Sell price" is the market average, not a guaranteed sale price — actual resale may vary.
- Prices are a snapshot — they can change between the first and last API call in a scan cycle.
- The 5-minute cache TTL means prices may be slightly stale if checked within the cache window without scanning.
- Browser notifications require permission and may not work in all environments (e.g., PDA WebView).
- Dismissed deals auto-expire after 1 hour.
