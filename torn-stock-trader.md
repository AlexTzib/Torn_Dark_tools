# Dark Tools — Stock Trader Bubble

**Bubble:** Gold "$" (56 px) | **Panel:** 400 px | **z-index:** 999930

A stock market analyzer for Torn City. Fetches real-time stock data via the Torn API, tracks price history over time, computes technical indicators, and generates advisory buy/sell signals. This guide explains every element you see in the panel, what the signals mean, and how the logic works.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [The Bubble](#the-bubble)
3. [Panel Layout — Tabs](#panel-layout--tabs)
4. [Overview Tab — The Stock List](#overview-tab--the-stock-list)
5. [Detail View — Stock Breakdown](#detail-view--stock-breakdown)
6. [Holdings Tab — Your Portfolio](#holdings-tab--your-portfolio)
7. [Settings Tab](#settings-tab)
8. [Understanding the Signals](#understanding-the-signals)
9. [Signal Levels Explained](#signal-levels-explained)
10. [How the Score Is Calculated](#how-the-score-is-calculated)
11. [Technical Indicators Explained](#technical-indicators-explained)
12. [Benefit Block & ROI](#benefit-block--roi)
13. [Data & Caching](#data--caching)
14. [API Usage & Rate Limits](#api-usage--rate-limits)
15. [Compliance](#compliance)
16. [Disclaimer](#disclaimer)

---

## Quick Start

1. Tap the gold **$** bubble on any Torn page
2. Enter your API key if prompted (automatic in Torn PDA)
3. The Overview tab loads all Torn stocks with prices and signals
4. Tap any stock row to see the full detail breakdown
5. Check the Holdings tab to track your owned stocks and P&L

---

## The Bubble

The gold circle with **$** floats on every Torn page. Tap it to open the panel. Drag it to reposition (position is saved). When the panel is open, the bubble hides. Close the panel and the bubble reappears.

---

## Panel Layout — Tabs

The panel has three tabs at the top, plus a special Detail View:

| Tab | What It Shows |
|---|---|
| **Overview** | All Torn stocks in a scrollable list with prices, daily change, mini charts, and signal badges |
| **Holdings** | Your owned stocks, portfolio value, per-stock profit/loss |
| **Settings** | Watchlist management, notification toggles, data controls |
| *(Detail View)* | Opens when you tap any stock — full breakdown with charts, indicators, and analysis |

Below the tabs is a **status bar** showing: how many stocks are loaded, how many have active signals, when data was last updated, and a **Refresh** button.

---

## Overview Tab — The Stock List

This is the main screen. Each row shows one Torn stock:

```
 TCT   Torn City Investments           $3.45   +1.23%   [mini chart]   [LEAN BUY]
```

### What Each Element Means

| Element | Description |
|---|---|
| **Ticker** (e.g. TCT) | The stock's abbreviation. Shown in yellow if it's on your watchlist. |
| **"owned" dot** | A small green dot appears next to the ticker if you own shares of this stock. |
| **Full name** | The stock's full company name (in grey). |
| **Price** | Current share price from the Torn API (updated every 5 minutes). |
| **Daily change %** | How much the price has moved in the last 24 hours. Green = up, red = down. |
| **Mini sparkline** | A tiny line chart showing the recent price history at a glance. Green line = price went up overall, red line = price went down. |
| **Signal badge** | The computed recommendation. See [Signal Levels Explained](#signal-levels-explained) below. |

### Filter Toggles (above the list)

| Filter | What It Does |
|---|---|
| **Watchlist** | Only show stocks in your watchlist (hide everything else) |
| **Owned** | Only show stocks you currently own shares of |
| **Signals Only** | Hide stocks with a HOLD signal (only show stocks with buy or sell signals) |

### Sort Dropdown

| Sort Option | Sorts By |
|---|---|
| **Signal** | Signal score (strongest BUY signals first) |
| **Change%** | Daily price change percentage (biggest gainers first) |
| **Price** | Share price (highest first) |
| **Name** | Ticker alphabetically (A to Z) |
| **Benefit ROI** | Annual return on investment for benefit-paying stocks (highest first) |

### Interacting

- **Tap any stock row** to open its Detail View
- **Tap Refresh** to force-reload all stock data from the API

---

## Detail View — Stock Breakdown

When you tap a stock from the Overview or Holdings tab, you see its full breakdown. Here's every section explained:

### Header Bar

```
[Back]   TCT   Torn City Investments   [Watch / Watching]
```

- **Back** — returns to the Overview tab
- **Watch / Watching** — toggle this stock on/off your watchlist. Yellow = watching.

### Price & Signal Card

```
$3.45                                    [LEAN BUY]
Cap: 2.1B - Investors: 15,432           Score: 2.5
```

| Element | Meaning |
|---|---|
| **Price** | Current share price (large text) |
| **Cap** | Total market capitalization (price x total shares in the market). Shown as B (billions), M (millions), etc. |
| **Investors** | How many players currently own shares of this stock |
| **Signal badge** | The recommendation — see [Signal Levels](#signal-levels-explained) |
| **Score** | The raw numeric score the algorithm computed. Positive = bullish, negative = bearish. The higher the absolute number, the stronger the signal. |

### Price History Chart

A sparkline graph showing the stock's price movement from the API chart data. Green line means the price ended higher than it started; red means it ended lower. The label shows how many data points are in the chart.

### Performance Table

Shows how the stock has performed over different time periods:

| Column | Meaning |
|---|---|
| **Period** | The timeframe: 1 Hour, 1 Day, 1 Week, 1 Month, 1 Year, All Time |
| **Change** | How much the price changed in that period as a percentage. Green = up, red = down. |
| **High** | The highest price reached during that period |
| **Low** | The lowest price reached during that period |

This table is one of the primary inputs to the signal algorithm. Large positive changes over longer periods push toward BUY; large negative changes push toward SELL.

### Signal Analysis

A bullet-point list showing **exactly why** the algorithm gave this signal. Each line is one factor that contributed to the score. Examples:

- "Day: +2.3% (mild up)" — the stock rose 2.3% in the last 24 hours, adding +0.5 to the score
- "SMA6 > SMA12 (golden cross)" — the short-term average crossed above the long-term average, a classic buy indicator, adding +1.5
- "RSI 28 — oversold (buy opportunity)" — the stock is oversold according to the RSI indicator, adding +2
- "Near day low (support zone)" — the current price is near the bottom of today's trading range, suggesting it may bounce up, adding +1

This section is the most important for understanding **why** a signal was given. Read through each reason to decide if you agree with the assessment.

### Your Position (only if you own this stock)

| Field | Meaning |
|---|---|
| **Shares** | How many shares you own |
| **Value** | Current market value of your position (shares x current price) |
| **Bonus** | Whether your stock benefit is available to collect, or how many days of progress you have |
| **Last buy price** | The price you paid in your most recent transaction |
| **Unrealized P&L** | Your profit or loss if you sold right now. Green = profit, red = loss. Shows both dollar amount and percentage. |

### Benefit Block (only for benefit-paying stocks)

Six stocks pay cash benefits: TCT, GRN, IOU, TMI, TSB, CNC. If you're viewing one of these, you'll see:

| Field | Meaning |
|---|---|
| **Required** | How many shares you need to own to qualify for the benefit |
| **Investment** | What it would cost to buy that many shares at the current price |
| **Payout** | How much cash the benefit pays each month |
| **Annual ROI** | Your yearly return as a percentage of the investment. Higher = better. Green if > 3%, yellow otherwise. |
| **Payback** | How many days until the benefit payouts equal your initial investment |

### Technical Indicators

Raw values of the computed indicators:

| Indicator | What It Is | How to Read It |
|---|---|---|
| **SMA-6** | Simple Moving Average over 6 data points (short-term trend) | If higher than SMA-12, the short-term trend is up |
| **SMA-12** | Simple Moving Average over 12 data points (medium-term trend) | If higher than SMA-6, the short-term trend is down |
| **EMA-12** | Exponential Moving Average over 12 points (reacts faster to recent changes) | If the current price is far above this, the stock may be "stretched" |
| **RSI-14** | Relative Strength Index over 14 periods | Below 30 = oversold (potential buy). Above 70 = overbought (potential sell). 30-70 = neutral zone. Color-coded: green (oversold), red (overbought), yellow (neutral). |

---

## Holdings Tab — Your Portfolio

### Portfolio Summary Card (top)

| Field | Meaning |
|---|---|
| **Portfolio Value** | Total current market value of all your stock holdings |
| **Total P&L** | Combined profit/loss across all positions |
| **Position count** | How many different stocks you own |
| **Updated** | How long ago the holdings data was refreshed |

### Per-Stock Cards

Each stock you own gets a card showing:
- Ticker, name, and signal badge
- Number of shares, current price, and total value
- P&L in dollars and percentage
- Bonus progress (if it's a benefit stock)

Tap any card to open its Detail View.

---

## Settings Tab

### Watchlist

Your watchlist is a custom list of stock tickers you want to track closely. Watchlisted stocks show with a yellow ticker name in the Overview.

- **Remove:** Tap the X next to any ticker badge to remove it
- **Add:** Type a ticker (e.g. "TCT") and tap Add
- **Reset to Defaults:** Restores the default watchlist of 15 popular stocks

Default watchlist: TCT, GRN, IOU, TMI, TSB, CNC, FHG, SYM, MCS, EVL, EWM, LAG, PRN, THS, LSC

### Notifications

| Setting | What It Does |
|---|---|
| **Enable notifications** | Master toggle for browser/PDA notifications |
| **Notify on BUY signals** | Get alerted when a watchlisted stock gets a BUY, LEAN BUY, or STRONG BUY signal |
| **Notify on SELL signals** | Get alerted when a watchlisted stock gets a SELL, LEAN SELL, or STRONG SELL signal |

Notifications are deduplicated — you won't get spammed with the same alert. Each signal only notifies once every 30 minutes.

### Data Management

| Button | What It Does |
|---|---|
| **Fetch Watchlist Details** | Downloads detailed chart/performance data for every stock in your watchlist (needed for full signal analysis) |
| **Clear History** | Erases all locally stored price snapshots. The script will start collecting fresh data from scratch. |

---

## Understanding the Signals

The script computes a **numeric score** for each stock. The score represents the balance of bullish (positive) and bearish (negative) factors. The score is then mapped to a human-readable signal label.

**Positive score = more reasons to buy. Negative score = more reasons to sell. Near zero = no clear direction.**

The signal is **advisory only** — it tells you what the data suggests, not what you should do. Always consider:
- Your current cash situation
- How long you plan to hold
- Whether you're buying for the benefit block or for trading
- The overall market environment

---

## Signal Levels Explained

There are 7 signal levels, from strongest buy to strongest sell:

| Signal | Score | Color | Icon | What It Means |
|---|---|---|---|---|
| **STRONG BUY** | 4 or higher | Bright green | Double up arrow | Multiple strong bullish indicators align. The stock shows strong upward momentum across several timeframes, may be oversold, and/or has excellent benefit ROI. This is the strongest buy recommendation. |
| **BUY** | 2 to 3.9 | Green | Up arrow | Clear bullish signals. The stock is trending up with supporting technical indicators. The data suggests this is a good entry point. |
| **LEAN BUY** | 0.5 to 1.9 | Green | Up arrow | Slightly bullish. There are some positive factors but they're not overwhelming. The stock leans toward being a buy, but the signal is mild. Could go either way. Consider buying if you already like the stock, but don't rush. |
| **HOLD** | -0.4 to 0.4 | Yellow | Circle dot | No clear direction. The bullish and bearish factors roughly cancel out, or there isn't enough data. If you own it, there's no strong reason to sell. If you don't own it, there's no strong reason to buy. Wait for a clearer signal. |
| **LEAN SELL** | -0.5 to -1.9 | Red | Down arrow | Slightly bearish. There are some negative factors but they're not overwhelming. The stock leans toward being overvalued or in a mild downtrend. If you're already thinking about selling, this supports that. Not urgent. |
| **SELL** | -2 to -3.9 | Red | Down arrow | Clear bearish signals. The stock is trending down with supporting technical indicators. The data suggests this is a good time to exit or avoid buying. |
| **STRONG SELL** | -4 or lower | Bright red | Double down arrow | Multiple strong bearish indicators align. The stock shows strong downward momentum, may be overbought, and/or is significantly overvalued. This is the strongest sell recommendation. |

### In Simple Terms

- **STRONG BUY / BUY** — "The data says this stock looks good right now"
- **LEAN BUY** — "The data slightly favors buying, but it's not a strong signal"
- **HOLD** — "Nothing interesting is happening, wait and see"
- **LEAN SELL** — "The data slightly favors selling, but it's not a strong signal"
- **SELL / STRONG SELL** — "The data says this stock doesn't look good right now"

---

## How the Score Is Calculated

The algorithm checks four categories of factors and adds up points. Each factor can add or subtract from the total score.

### Category 1: Performance Trends (from API data)

The script looks at how the stock price has changed over different time periods. Longer timeframes carry more weight because they're more reliable.

| Period | Bullish Condition | Points | Bearish Condition | Points |
|---|---|---|---|---|
| **1 Hour** | Price up > +2% | +1 | Price down > -2% | -1 |
| **1 Day** | Up > +3% | +1 | Down > -3% | -1 |
| | Up > +0.5% | +0.5 | Down > -0.5% | -0.5 |
| **1 Week** | Up > +5% | +1.5 | Down > -5% | -1.5 |
| | Up > +1% | +0.5 | Down > -1% | -0.5 |
| **1 Month** | Up > +10% | +2 | Down > -10% | -2 |
| | Up > +2% | +1 | Down > -2% | -1 |

**Example:** If a stock is up 4% today (+1), up 6% this week (+1.5), and up 12% this month (+2), that alone gives a score of +4.5 = STRONG BUY.

### Category 1b: Support & Resistance (Day Range Position)

The script checks where the current price sits within today's high-low range:

| Position in Range | What It Means | Points |
|---|---|---|
| **Bottom 20%** (near day low) | Price is near a "support zone" — it may bounce back up | +1 |
| **Top 20%** (near day high) | Price is near a "resistance zone" — it may have trouble going higher | -0.5 |

### Category 2: Technical Indicators (from API chart history)

These require the detailed chart data (fetched per-stock from `/v2/torn/{id}/stocks`).

#### SMA Crossover (Golden Cross / Death Cross)

- **SMA-6** = average of the last 6 price points (short-term direction)
- **SMA-12** = average of the last 12 price points (medium-term direction)

| Condition | Name | Points | Meaning |
|---|---|---|---|
| SMA-6 is >1% above SMA-12 | **Golden Cross** | +1.5 | The short-term trend has crossed above the longer trend — momentum is shifting upward |
| SMA-6 is >1% below SMA-12 | **Death Cross** | -1.5 | The short-term trend has crossed below the longer trend — momentum is shifting downward |

#### RSI (Relative Strength Index)

RSI measures whether a stock has been bought too aggressively (overbought) or sold too aggressively (oversold). It ranges from 0 to 100.

| RSI Range | Label | Points | Meaning |
|---|---|---|---|
| **Below 30** | Oversold | +2 | The stock has been sold heavily and may be undervalued — potential buying opportunity |
| **30-40** | Approaching oversold | +0.5 | Getting close to oversold territory |
| **40-60** | Neutral | 0 | Normal trading range, no signal |
| **60-70** | Approaching overbought | -0.5 | Getting close to overbought territory |
| **Above 70** | Overbought | -2 | The stock has been bought heavily and may be overvalued — potential sell signal |

#### Price vs EMA-12

EMA (Exponential Moving Average) reacts faster to recent price changes than SMA. This check looks at whether the current price has stretched too far from the trend.

| Condition | Points | Meaning |
|---|---|---|
| Price is >5% above EMA-12 | -0.5 | Stock may be overextended — could pull back |
| Price is >5% below EMA-12 | +0.5 | Stock may be undervalued relative to its trend |

### Category 3: Local Price History

The script records its own hourly price snapshots (stored locally for up to 7 days). If enough data has been collected:

| Condition | Points | Meaning |
|---|---|---|
| Local SMA-3 is >0.5% above Local SMA-6 | +0.5 | Your locally-tracked data confirms a short-term uptrend |
| Local SMA-3 is >0.5% below Local SMA-6 | -0.5 | Your locally-tracked data confirms a short-term downtrend |

This category has less weight because it's based on less data, but it adds a confirmation signal from the script's own observations over time.

### Category 4: Benefit ROI (cash-paying stocks only)

Only applies to: TCT, GRN, IOU, TMI, TSB, CNC — the stocks that pay regular cash benefits.

| Condition | Points | Meaning |
|---|---|---|
| Annual ROI > 5% | +1 | The benefit payout relative to the investment cost is very attractive |
| Annual ROI > 2% | +0.5 | Decent passive income return |

The ROI is calculated as: `(monthly payout / frequency days x 365) / (required shares x current price) x 100`

### Score Calculation Example

Imagine stock **GRN** with these conditions:
- Last day: +3.5% → **+1** (strong up)
- Last week: +2% → **+0.5** (uptrend)
- Last month: +8% → **+1** (uptrend)
- SMA-6 > SMA-12 → **+1.5** (golden cross)
- RSI at 45 → **0** (neutral)
- Benefit ROI at 3.2% → **+0.5** (decent)

**Total score: +4.5 → STRONG BUY**

The Signal Analysis section in the Detail View would list all six of these reasons as bullet points, so you can see exactly what's driving the recommendation.

---

## Technical Indicators Explained

For users unfamiliar with trading terminology:

### SMA (Simple Moving Average)

Takes the last N prices and averages them. Smooths out noise to show the overall direction.

- **SMA-6** reacts quickly — it shows what the stock has been doing very recently
- **SMA-12** reacts more slowly — it shows the broader trend

When SMA-6 crosses above SMA-12, it's called a **golden cross** (bullish). When SMA-6 crosses below SMA-12, it's called a **death cross** (bearish). These are widely-used signals in technical analysis.

### EMA (Exponential Moving Average)

Like SMA but gives more weight to recent prices. This means it reacts faster to price changes. EMA-12 is used as a "fair value" reference — if the stock price is way above or below the EMA, it might snap back.

### RSI (Relative Strength Index)

Measures the speed and magnitude of recent price changes. Think of it as a "momentum meter":

- **0-30**: The stock has been falling fast. It might be "oversold" — too many people sold and the price may be artificially low.
- **30-70**: Normal range. No extreme momentum in either direction.
- **70-100**: The stock has been rising fast. It might be "overbought" — too many people bought and the price may be artificially high.

RSI is shown in the Detail View's Technical Indicators card, color-coded: green (oversold/buy zone), red (overbought/sell zone), yellow (neutral).

---

## Benefit Block & ROI

Six Torn stocks pay regular cash benefits if you hold enough shares:

| Stock | Required Shares | Monthly Payout | Payout Label |
|---|---|---|---|
| **TCT** | 100,000 | $1,000,000 | $1M/mo |
| **GRN** | 500,000 | $4,000,000 | $4M/mo |
| **IOU** | 3,000,000 | $12,000,000 | $12M/mo |
| **TMI** | 6,000,000 | $25,000,000 | $25M/mo |
| **TSB** | 3,000,000 | $50,000,000 | $50M/mo |
| **CNC** | 7,500,000 | $80,000,000 | $80M/mo |

The Benefit Block card in the Detail View calculates:
- **Investment** = required shares x current price (what it costs to buy in)
- **Annual ROI** = (monthly payout x 12) / investment x 100
- **Payback** = how many days of payouts to recover the investment cost

A higher ROI means the benefit is a better deal relative to the stock's current price. If the stock price drops, ROI goes up (cheaper to buy the benefit block). If the stock price rises, ROI goes down.

---

## Data & Caching

| Data | Cache Duration | Storage |
|---|---|---|
| All stocks overview | 5 minutes | localStorage |
| Per-stock chart details | 15 minutes | localStorage |
| User stock holdings | 5 minutes | localStorage |
| Local price snapshots | 7 days (max 168 points per stock) | localStorage |
| Watchlist | Permanent (until you change it) | localStorage |
| Settings & filters | Permanent (until you change them) | localStorage |

- Data refreshes automatically every 5 minutes while the panel is open
- Closing the panel stops all polling (saves API calls)
- The "Refresh" button forces an immediate reload regardless of cache
- Local price snapshots are taken once per hour and kept for 7 days

---

## API Usage & Rate Limits

| Action | API Calls | When |
|---|---|---|
| Load all stocks | 1 | Every 5 min (auto-poll when panel open) |
| Load user holdings | 1 | Every 5 min |
| Fetch stock detail | 1 per stock | When you tap a stock, or manual "Fetch Watchlist Details" |
| Full watchlist scan | ~15 calls | Manual only (350ms gap between calls) |

Normal usage: ~2-3 calls per minute. Full watchlist scan: ~17 calls over ~6 seconds. Well under Torn's 100 calls/min limit.

---

## Compliance

| Requirement | Status |
|---|---|
| No game-action automation | Compliant — display only, no buying/selling |
| One-click-one-action | Compliant — no game actions at all |
| No API key extraction/abuse | Own key only; PDA/manual/intercepted |
| No external server comms | Only `api.torn.com` |
| API rate limits respected | ~3 calls/min normal, ~17 on full refresh |
| No request modification | Compliant — read-only interception |
| Read-only display | Compliant — advisory signals only |

---

## Disclaimer

**Stock signals are advisory only.** The algorithm uses basic technical analysis (moving averages, RSI, trend detection) which is inherently imperfect. Past performance does not predict future results. Torn's stock market has unique dynamics different from real-world markets. Always use your own judgment when making investment decisions. The script never buys or sells for you — it only shows information.
