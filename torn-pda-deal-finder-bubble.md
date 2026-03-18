# Torn PDA - Deal Finder Bubble

## Overview

A local-only deal-finding overlay for [Torn City](https://www.torn.com) that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable bubble that expands into a panel showing potential flip profits on the **Item Market** and **Bazaar** pages, accounting for the standard 5% item-market sales tax.

**The script is strictly read-only. It never buys, sells, lists, or performs any game action on the player's behalf.**

## Features

| Feature | Description |
|---|---|
| **Page context detection** | Automatically identifies whether the current page is an Item Market or Bazaar listing |
| **DOM listing scraper** | Extracts visible item prices and quantities from the current page |
| **Flip profit calculator** | Computes net profit after the 5% item-market tax for each visible listing |
| **Cross-market comparison** | Compares bazaar prices against cached item-market floor prices (or market value) to find arbitrage opportunities |
| **Price cache** | Remembers floor prices across page visits to enable cross-market deal evaluation |
| **Deal classification** | Color-codes deals: green (> $500k profit), yellow (positive but small), red (negative) |
| **Debug log** | Collapsible log panel with timestamped events and a "Copy Log" button for bug reporting |

## How It Works

```
┌──────────────────────────────┐
│     Torn Item Market or      │
│     Bazaar page loads        │
│                              │
│   ┌─────────────────────┐    │    ┌─────────────────────┐
│   │  DOM listing scraper │───────▶│  scrapeListingsFromDom│
│   │  (reads prices from  │    │    │  (parses $, qty,     │
│   │   visible elements)  │    │    │   seller text)       │
│   └─────────────────────┘    │    └──────────┬──────────┘
│                              │               │
│   ┌─────────────────────┐    │    ┌──────────▼──────────┐
│   │  hookFetch / hookXHR │───────▶│  Price cache update  │
│   │  (passive API sniff) │    │    │  (localStorage)      │
│   └─────────────────────┘    │    └──────────┬──────────┘
│                              │               │
└──────────────────────────────┘    ┌──────────▼──────────┐
                                    │  Deal calculation    │
                                    │  • net after 5% tax  │
                                    │  • profit & ROI %    │
                                    └──────────┬──────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │  renderPanel()       │
                                    │  (sorted deal list)  │
                                    └─────────────────────┘
```

### Item Market Mode
When viewing an item-market listing, the script compares the **cheapest visible listing** against the **second-cheapest** to identify quick undercut flips.

### Bazaar Mode
When viewing a bazaar, the script compares bazaar listing prices against:
1. The **cached item-market floor** (if the user previously visited the same item on the item market), or
2. The **market value** shown on the page

Profit is calculated as: `net_sell_price - buy_price`, where `net_sell_price = gross_price × (1 - 0.05)`.

## Data Sources

| Source | Method | Notes |
|---|---|---|
| Visible listing prices | DOM scraping | Parses price text from listing elements; uses targeted CSS selectors with a broad fallback |
| Item market floor, bazaar floor, market value | Passive fetch/XHR interception + DOM scraping | Cached in `localStorage` per item (max 200 items, 7-day expiry) |
| User / torn market API data | Passive fetch/XHR interception | Reads responses the app already makes |

## Torn Policy Compliance

| Rule | Status |
|---|---|
| No automation of game actions | Fully compliant — the script never buys, sells, lists, or clicks any game button |
| One-click-one-action principle | Fully compliant — no game actions are triggered |
| Read-only data display | Fully compliant — all data shown is derived from visible page content and passively intercepted API responses |
| No API key extraction | Fully compliant — the script does not read, store, or transmit any API key |
| No external server communication | Fully compliant — zero outbound network requests |
| DOM scraping for display | Allowed — standard technique used by all major Torn community scripts |
| Passive fetch/XHR interception | Tolerated pattern — same technique used by TornTools and other community scripts |
| localStorage usage | Price cache (max 200 items, 7-day TTL) and UI positions only |

## Installation

### Torn PDA
1. Open **Torn PDA** → Settings → **Userscripts**
2. Add a new script
3. Paste the contents of `torn-pda-deal-finder-bubble.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. Save and reload any Torn page

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-pda-deal-finder-bubble.user.js`
3. Save — the script will activate on all `torn.com` pages

## UI Controls

- **Bubble (green, "DF")** — tap to expand; drag to reposition
- **Refresh** button — re-scans the current page DOM and recalculates deals
- **○** button — collapses the panel back to the bubble
- **Debug Log** section — tap the header to expand; "Copy Log" copies all entries to clipboard

## Limitations

- DOM scraping is inherently fragile — Torn page structure changes may require selector updates.
- Bazaar deal detection requires a prior visit to the same item's Item Market page to cache the floor price.
- The profit estimate does **not** include the optional anonymous-listing fee.
- The script shows deals based on **currently visible** listings only — it cannot see listings that haven't been rendered in the DOM yet.
