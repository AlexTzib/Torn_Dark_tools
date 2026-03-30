# Dark Tools — Stock Trader Bubble

**Bubble:** Gold "$" (56 px) | **Panel:** 400 px | **z-index:** 999930

A stock market analyzer for Torn City. Fetches real-time stock data, tracks price history, computes technical indicators (SMA, EMA, RSI), and generates buy/sell signals based on trend analysis. Includes portfolio tracking with P&L calculations and stock benefit ROI analysis.

---

## Features

| Feature | Description |
|---|---|
| **Stock Overview** | All Torn stocks with current price, daily change %, mini sparkline chart, and signal badge |
| **Buy/Sell Signals** | Computed from performance trends, SMA crossover, RSI, support/resistance, and benefit ROI |
| **Signal Strength** | 7 levels: STRONG BUY, BUY, LEAN BUY, HOLD, LEAN SELL, SELL, STRONG SELL |
| **Price History** | Hourly snapshots stored locally for up to 7 days; API chart history for detailed analysis |
| **Technical Indicators** | SMA-6, SMA-12, EMA-12, RSI-14 computed from API chart data |
| **Stock Detail View** | Full breakdown: performance table (1h/1d/1w/1m/1y/all), chart, signals, indicators |
| **Portfolio Tracking** | Shows your holdings, per-stock P&L, bonus progress, and portfolio total value |
| **Benefit ROI Calculator** | For cash-paying stocks (TCT, GRN, IOU, TMI, TSB, CNC): investment cost, annual ROI, payback period |
| **Watchlist** | Track specific stocks; filter view to watchlist-only |
| **Notifications** | Optional browser alerts on BUY/SELL signals for watchlisted stocks |
| **Filters & Sorting** | Filter by watchlist/owned/signals-only; sort by signal/change/price/name/ROI |

---

## Signal Analysis Algorithm

The signal engine scores each stock on multiple factors:

### 1. API Performance Data (from `/v2/torn/{id}/stocks`)

| Period | Weight | Thresholds |
|---|---|---|
| Last Hour | ±1 | > +2% bullish, < -2% bearish |
| Last Day | ±0.5 to ±1 | > +3% strong up, > +0.5% mild up |
| Last Week | ±0.5 to ±1.5 | > +5% strong uptrend, > +1% uptrend |
| Last Month | ±1 to ±2 | > +10% strong, > +2% moderate |
| Day Range Position | ±0.5 to +1 | < 20% of range = near support, > 80% = near resistance |

### 2. Technical Indicators (from API chart history)

| Indicator | Weight | Logic |
|---|---|---|
| SMA-6 vs SMA-12 | ±1.5 | Golden cross (SMA6 > SMA12 × 1.01) = buy; death cross = sell |
| RSI-14 | ±0.5 to ±2 | < 30 = oversold (buy); > 70 = overbought (sell) |
| Price vs EMA-12 | ±0.5 | > 5% above = stretched (sell pressure); > 5% below = undervalued |

### 3. Local History (own collected snapshots)

| Indicator | Weight | Logic |
|---|---|---|
| Local SMA-3 vs SMA-6 | ±0.5 | Short-term local trend confirmation |

### 4. Benefit ROI (cash-paying stocks only)

| Condition | Weight |
|---|---|
| Annual ROI > 5% | +1 |
| Annual ROI > 2% | +0.5 |

### Signal Mapping

| Score Range | Signal | Badge Color |
|---|---|---|
| ≥ 4 | STRONG BUY | Bright green |
| ≥ 2 | BUY | Green |
| ≥ 0.5 | LEAN BUY | Green |
| -0.5 to 0.5 | HOLD | Yellow |
| ≤ -0.5 | LEAN SELL | Red |
| ≤ -2 | SELL | Red |
| ≤ -4 | STRONG SELL | Bright red |

---

## Data Sources

| Source | Endpoint | Data | Cache |
|---|---|---|---|
| Torn API v2 | `/v2/torn/stocks` | All stocks: price, cap, shares, investors, bonus | 5 min |
| Torn API v2 | `/v2/torn/{id}/stocks` | Per-stock: chart history, performance periods | 15 min |
| Torn API v2 | `/v2/user/stocks` | User holdings: shares, transactions, bonus progress | 5 min |
| localStorage | `tpda_stock_trader_v1_history` | Hourly price snapshots for 7 days | Persistent |

---

## API Usage

| Action | Calls | Frequency |
|---|---|---|
| All stocks overview | 1 | Every 5 min (auto-poll when panel open) |
| User holdings | 1 | Every 5 min |
| Watchlist details | 1 per watchlist stock | Manual or every 15 min |
| Total per refresh | ~17 (1 + 1 + 15 watchlist) | 350ms gap between detail calls |

Rate impact: ~3 calls/min during normal use. Well under the 100/min limit.

---

## UI Tabs

### Overview Tab
- Filter toggles: Watchlist / Owned / Signals Only
- Sort dropdown: Signal / Change% / Price / Name / Benefit ROI
- Stock list with: ticker, name, price, daily %, sparkline chart, signal badge
- Click any stock to open detail view

### Holdings Tab
- Portfolio summary card: total value, total P&L
- Per-holding cards: shares, value, P&L, bonus progress
- Click any holding to open detail view

### Settings Tab
- Watchlist management: add/remove tickers, reset to defaults
- Notification toggles: enable/disable, buy alerts, sell alerts
- Data management: fetch watchlist details, clear history cache

### Detail View (click any stock)
- Price & signal overview
- SVG sparkline chart from API history
- Performance table: 1h / 1d / 1w / 1m / 1y / all-time
- Signal analysis: detailed breakdown of all factors
- Your position: shares, value, P&L (if owned)
- Benefit block: investment cost, payout, annual ROI, payback (if applicable)
- Technical indicators: SMA-6, SMA-12, EMA-12, RSI-14

---

## localStorage Keys

| Key | Content |
|---|---|
| `tpda_stock_trader_v1_market` | All stocks + fetch timestamp |
| `tpda_stock_trader_v1_detail` | Per-stock chart details |
| `tpda_stock_trader_v1_user_stocks` | User holdings |
| `tpda_stock_trader_v1_history` | Hourly price snapshots (7 days) |
| `tpda_stock_trader_v1_watchlist` | User's watchlist tickers |
| `tpda_stock_trader_v1_settings` | Filter, sort, notification preferences |
| `tpda_stock_trader_v1_bubble_pos` | Bubble position |
| `tpda_stock_trader_v1_panel_pos` | Panel position |

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

**Stock signals are advisory only.** The algorithm uses basic technical analysis (moving averages, RSI, trend detection) which is inherently imperfect. Past performance does not predict future results. Torn's stock market has unique dynamics different from real-world markets. Always use your own judgment when making investment decisions.
