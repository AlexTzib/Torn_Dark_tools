# Torn PDA - Plushie Prices

## Overview

A plushie price comparison overlay for [Torn City](https://www.torn.com) that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable bubble that expands into a panel showing current **bazaar** and **item market** floor prices for all 13 Torn plushies, with sortable columns and a full-set cost total.

**The script is read-only. It never buys, sells, lists, or performs any game action on the player's behalf.**

## Features

|| Feature | Description |
||---|---|
|| **All 13 plushies** | Tracks Sheep, Teddy Bear, Kitten, Jaguar, Wolverine, Nessie, Red Fox, Monkey, Chamois, Panda, Lion, Camel, and Stingray plushies |
|| **Bazaar floor prices** | Fetches the lowest bazaar listing for each plushie via the Torn API |
|| **Item Market floor prices** | Fetches the lowest item market listing for each plushie via the Torn API |
|| **Best price highlight** | Green highlight on whichever source (bazaar or item market) has the lower price |
|| **Full set cost** | Bottom row shows the total cost to buy one of each plushie at the best available price |
|| **Sortable columns** | Click any column header (Plushie, Bazaar, Market, Best) to sort ascending/descending |
|| **Auto-refresh** | Prices auto-fetch when the panel is opened and cache is stale (10-minute TTL) |
|| **API key auto-detection** | Captures API key from PDA injection, manual entry, or network traffic interception |
|| **Price cache** | Caches fetched prices in `localStorage` with 10-minute TTL to avoid unnecessary API calls |
|| **Debug log** | Collapsible log panel with timestamped events and a "Copy" button for bug reporting |

## How It Works

```
┌───────────────────────────────────────────────┐
│  User taps bubble → panel opens               │
│                                               │
│  ┌──────────────┐    ┌─────────────────────┐  │
│  │ API key       │───▶│ fetchAllPrices()     │  │
│  │ (PDA/manual/  │    │ 13 plushies          │  │
│  │  intercepted) │    │ 250ms between each   │  │
│  └──────────────┘    └────────┬────────────┘  │
│                               │               │
│          For each plushie (in parallel):       │
│    ┌──────────────────┐ ┌─────────────────┐   │
│    │ Torn API v2       │ │ TornW3B          │   │
│    │ /v2/market/{id}/  │ │ weav3r.dev/api/  │   │
│    │ itemmarket        │ │ marketplace/{id} │   │
│    └────────┬─────────┘ └───────┬─────────┘   │
│             │                   │              │
│             └─────────┬─────────┘              │
│                       │                        │
│            ┌──────────▼──────────┐             │
│            │ Extract floor prices │             │
│            │ market = API floor   │             │
│            │ bazaar = W3B floor   │             │
│            │ best = min(both)     │             │
│            └──────────┬──────────┘             │
│                       │                        │
│            ┌──────────▼──────────┐             │
│            │ renderPanel()        │             │
│            │ Sortable price table │             │
│            │ + full set total     │             │
│            └─────────────────────┘             │
└───────────────────────────────────────────────┘
```

### Price Table

For each of the 13 plushies, the table shows:
- **Bazaar** — Lowest price from any player bazaar
- **Market** — Lowest price from the item market
- **Best** — The lower of the two (highlighted in green)

The cheapest source for each plushie is highlighted. A "Full Set (13)" row at the bottom shows the total cost to buy one of each at the best price.

### API Calls

The script makes **two parallel calls per plushie** (13 plushies = 26 total calls per refresh):

1. **Item Market** — Torn API v2:
```
GET https://api.torn.com/v2/market/{plushie_id}/itemmarket?key={key}
```
Returns `{ itemmarket: { item: { average_price }, listings: [{ price, amount }] } }`. Floor price = cheapest listing.

2. **Bazaar** — TornW3B (third-party, no key needed):
```
GET https://weav3r.dev/api/marketplace/{plushie_id}
```
Returns `{ bazaar_average, listings: [{ price, quantity, player_name, ... }] }`. Floor price = cheapest listing.

> **Why TornW3B?** The Torn API v2 `bazaar` selection returns a bazaar *directory* (store names/stats), not per-item price listings. This is the same approach used by TornTools.

Calls are made sequentially per plushie (API + W3B in parallel), with a 250ms delay between plushies to stay within Torn's rate limit (~100 requests/minute). A full refresh takes approximately 3-4 seconds.

## Plushie IDs

|| ID | Name |
||---|---|
|| 186 | Sheep Plushie |
|| 187 | Teddy Bear Plushie |
|| 215 | Kitten Plushie |
|| 258 | Jaguar Plushie |
|| 261 | Wolverine Plushie |
|| 266 | Nessie Plushie |
|| 268 | Red Fox Plushie |
|| 269 | Monkey Plushie |
|| 273 | Chamois Plushie |
|| 274 | Panda Plushie |
|| 281 | Lion Plushie |
|| 384 | Camel Plushie |
|| 618 | Stingray Plushie |

## Data Sources

|| Source | Method | Notes |
||---|---|---|
|| Plushie item market prices | Torn API v2 (`/v2/market/{id}/itemmarket`) | Returns `{ itemmarket: { listings: [{price, amount}], item: {average_price} } }`; floor from first listing |
|| Plushie bazaar prices | TornW3B (`weav3r.dev/api/marketplace/{id}`) | Returns `{ bazaar_average, listings: [{price, quantity, player_name}] }`; floor from first listing. No API key needed. |
|| API key | PDA injection / manual entry / network interception | Three-tier priority system shared with other scripts |

## Torn Policy Compliance

|| Rule | Status |
||---|---|
|| No automation of game actions | Fully compliant — the script never buys, sells, lists, or clicks any game button |
|| One-click-one-action principle | Fully compliant — no game actions are triggered |
|| Read-only data display | Fully compliant — all data shown is price information from the Torn API |
|| API key handling | User's own key only; stored locally in `localStorage`; never sent externally |
|| No external server communication | Contacts `api.torn.com` (item market) and `weav3r.dev` (bazaar prices via TornW3B). No user data is sent to TornW3B — only item IDs. |
|| API rate limits | 13 calls per refresh, 250ms apart (~52/min); well under the 100/min limit |
|| Passive fetch/XHR interception | Used only to capture API key from existing traffic; does not modify requests |
|| localStorage usage | Price cache (10-min TTL), API key, and UI positions only |

## Installation

### Torn PDA
1. Open **Torn PDA** → Settings → **Userscripts**
2. Add a new script
3. Paste the contents of `torn-pda-deal-finder-bubble.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. **Set Injection Time to `Start`**
6. Save and reload any Torn page

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-pda-deal-finder-bubble.user.js`
3. Save — the script will activate on all `torn.com` pages
4. Open the panel and enter your Torn API key (16 characters) in the key field

## UI Controls

- **Bubble (purple, teddy bear emoji)** — tap to expand; drag to reposition
- **Refresh** button — re-fetches all 13 plushie prices from the API
- **○** button — collapses the panel back to the bubble
- **Column headers** — click to sort by that column (toggle ascending/descending)
- **Log** section — tap the header to expand; "Copy" copies all entries to clipboard

## Limitations

- Requires an API key for item market prices (bazaar prices via TornW3B need no key).
- Each refresh makes 26 calls (13 to Torn API + 13 to TornW3B). Avoid spamming the Refresh button.
- Bazaar prices depend on TornW3B availability — if the service is down, only item market prices are shown.
- Prices are a snapshot — they can change between the first and last API call in a refresh cycle.
- The 10-minute cache TTL means prices may be slightly stale if checked within the cache window without refreshing.
