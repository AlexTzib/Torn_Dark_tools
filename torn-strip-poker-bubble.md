# Dark Tools - Strip Poker

## Overview

A Texas Hold'em poker advisor for Torn City's Strip Poker that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable bubble that expands into a compact panel showing hand evaluation, win probability (Monte Carlo simulation), and action recommendations. Auto-detects cards from game data via XHR/fetch interception and DOM scanning, or allows manual two-tap entry.

**The script is 100% client-side math. No API key required, no external calls.**

## Features

|| Feature | Description |
||---------|-------------|
|| **Card Picker** | Two-tap entry: tap a rank (2-A), then a suit. Hole/Community toggle lets you pick where cards go. |
|| **Auto-Detection** | Intercepts XHR/fetch game data to automatically read your hole cards and community cards separately. Also scans DOM for Torn's CSS-class card format (e.g. `hearts-2`, `spades-K`). MutationObserver triggers auto-scan when new cards appear. |
|| **Hand Evaluator** | Full Texas Hold'em evaluation -- finds the best 5-card hand from your 2 hole cards + up to 5 community cards. Recognises High Card through Royal Flush. Handles ace-low straights (A-2-3-4-5). |
|| **Win Probability** | Monte Carlo simulation (5 000 trials) deals remaining community cards + random opponent hole cards for each active player, evaluates best-of-7 for each. Computes Win / Tie / Lose percentages and effective win %. |
|| **Multi-Opponent** | Detects active player count via DOM selectors. Simulates N-1 opponents -- you must beat ALL to win. Manual +/- adjustment buttons in panel. |
|| **Action Suggestion** | Color-coded recommendation: **RAISE** (>=72%), **CALL** (>=42%), **CAUTION** (>=30%), **FOLD** (<30%). |
|| **Opponent Range** | Collapsible breakdown showing how often each opponent hand type occurs and what % of those beat yours. |
|| **DOM Scan** | "Scan" button manually triggers DOM card detection. Also runs automatically via 1-second polling + MutationObserver when game elements change. Falls back to manual input gracefully. |
|| **Tiny Bubble** | 40 px dark-green circle -- intentionally small so it won't cover the poker screen on mobile/PDA. |

## How It Works

```
+-------------------------------------------------+
|  User opens Strip Poker page                    |
|                                                 |
|  hookFetch() + hookXHR()                        |
|  (installed at script load, before DOM ready)   |
|  Intercept ALL torn.com page requests           |
|      |                                          |
|      v                                          |
|  handlePokerPayload(data)                       |
|  Extract cards from JSON fields:                |
|  player.hand, yourCards, community,             |
|  board, tableCards, currentGame[]               |
|      |                                          |
|      v                                          |
|  Separate: first 2 = hole, rest = community     |
|  (structured fields preferred over heuristic)   |
+---------+---------------------------------------+
          |
          |   +-- scanDom() (1s polling + MutationObserver)
          |   |   4 strategies:
          |   |   1. [class*="playerMeGateway"] selectors
          |   |   2. Generic suit-class scan
          |   |   3. data-card / data-rank attributes
          |   |   4. img src/alt patterns
          |   |
          v   v
  +-------------------------------+
  | myCards[] (hole, 0-2)         |
  | tableCards[] (community, 0-5) |
  +---------------+---------------+
                  |
                  v  (when 2 hole + 3+ community)
  +-------------------------------+
  | bestOfN(cards)                |
  | Evaluate all C(n,5) combos   |
  | Return best {name,rank,score}|
  +---------------+---------------+
                  |
                  v
  +-------------------------------+
  | calcWinProb(hole, community,  |
  |   numPlayers)                 |
  | 5000 Monte Carlo trials       |
  | Must beat ALL opponents       |
  +---------------+---------------+
                  |
                  v
  +-------------------------------+
  | suggest(prob)                 |
  | RAISE / CALL / CAUTION / FOLD|
  +-------------------------------+
```

### Poker Engine

- **evaluate5()** -- Determines hand rank (0-9) and a numeric score for tie-breaking via group-value encoding. Straights use `straightHigh` for correct ace-low ordering.
- **bestOfN(cards)** -- Evaluates all C(n,5) combinations from the available cards (up to 7), returns the strongest hand. This is the core Hold'em evaluator that picks the best 5 out of 7.
- **calcWinProb(hole, community, numPlayers)** -- Monte Carlo simulation (5 000 trials). For each trial: deals remaining community cards to complete 5, deals 2 random hole cards for each of N-1 opponents, evaluates best-of-7 for all players, counts wins only when you beat ALL opponents.
- **calcOppRange(hole, community, numPlayers)** -- Same simulation (3 000 samples) bucketed by opponent hand name, tracking which beat the player's hand.
- **suggest()** -- Maps effective win % (win + tie x 0.5) to one of four action tiers with colour codes.

### Card Detection

The script uses three complementary methods to detect your poker hand:

|| Method | How It Works | Priority |
||--------|-------------|----------|
|| **XHR/Fetch interception** | Hooks `fetch()` and `XMLHttpRequest` to intercept poker game JSON responses. Looks for structured fields: `player.hand`, `yourCards`, `community`, `board`, `tableCards`, etc. Falls back to deep-scanning for `classCode` fields. | Highest -- installed immediately on script load |
|| **DOM CSS-class scan** | 4 strategies targeting Torn holdem DOM: `[class*="playerMeGateway"]` for hole cards, `[class*="communityCards"]` for community. Parses CSS-module classes like `hearts-2___xYz1a` via unanchored regex. | Medium -- runs on 1-second polling loop + MutationObserver |
|| **Legacy DOM scan** | Checks `<img>` src/alt, `[data-card]` attributes, and unicode suit symbols in `[class*="card"]` elements | Lowest -- fallback strategies |

XHR-detected cards take priority over DOM-scanned cards to prevent overwriting accurate game data with potentially noisy DOM reads.

### Hold'em Card Separation

When cards are auto-detected, the script attempts to separate hole cards from community cards:

1. **Structured fields** -- Tries known field names first (`player.hand` -> hole, `community`/`board` -> table)
2. **Deep scan heuristic** -- If no structured fields found, treats the first 2 unique cards as hole cards and the rest as community cards
3. **DOM scan** -- Same heuristic (first 2 = hole, rest = community)

### Compact Design Choices

|| Aspect | Value | Why |
||--------|-------|-----|
|| Bubble size | 40 px | Won't cover the poker table on pocket/PDA screens |
|| Panel width | 260 px | Leaves room for the game UI on small screens |
|| z-index base | 999960 | Sits behind War Bubble and above Bounty Filter |
|| No API calls | -- | Pure math, zero network overhead, no key needed |

## Data Sources

|| Source | Method | Notes |
||--------|--------|-------|
|| Hole cards | XHR/fetch interception or DOM scan | `player.hand`, `yourCards`, or first 2 detected cards |
|| Community cards | XHR/fetch interception or DOM scan | `community`, `board`, `tableCards`, or remaining detected cards |
|| Opponent count | DOM scan | `[class*="opponent"]` elements not folded/sitting out; user-adjustable with +/- buttons |
|| Win probability | Local Monte Carlo simulation | 5 000 trials for win %, 3 000 for opponent range breakdown |

No external API calls. No API key needed. All data comes from intercepting the game's own network traffic and DOM state.

## Torn Policy Compliance

|| Rule | Status |
||------|--------|
|| No automation of game actions | Fully compliant -- the script never bets, folds, raises, or performs any game action. All poker actions require user input. |
|| One-click-one-action principle | Fully compliant -- the card picker is for display/analysis only; no game actions are triggered |
|| Read-only data display | Fully compliant -- shows hand evaluation, probability, and advice overlay only |
|| API key handling | Not applicable -- no API key is needed or used |
|| No external server communication | Fully compliant -- zero external network calls. XHR/fetch hooks only read Torn's own game traffic. |
|| API rate limits | Not applicable -- no API calls are made |
|| Passive fetch/XHR interception | Intercepts all Torn page requests to find poker game data; does not modify any requests or responses |
|| localStorage usage | Bubble and panel positions only (`tpda_strip_poker_v1_bubble_pos`, `tpda_strip_poker_v1_panel_pos`) |

## Installation

### Torn PDA
1. Open **Torn PDA** -> Settings -> **Userscripts**
2. Add a new script
3. Paste the contents of `torn-strip-poker-bubble.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. **Set Injection Time to `Start`** (required for XHR/fetch hooks to install before game data loads)
6. Save and reload any Torn page

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-strip-poker-bubble.user.js`
3. Save -- the script will activate on all `torn.com` pages

No API key is needed -- the advisor is 100% client-side math.

## UI Controls

- **Bubble (dark-green, 40px)** -- tap to expand; drag to reposition; intentionally small to avoid covering the poker table
- **Scan** button -- forces a DOM re-scan for cards
- **circle** button -- collapses the panel back to the bubble
- **Card picker** -- toggle between Hole / Community target, tap rank then suit to add a card; tap a selected card to remove it; greyed-out cards are already in use
- **Clear All** -- resets all cards for the next round
- **Hand display** -- shows detected/entered cards with source indicator: (auto), (scanned), or (manual)
- **Strength bar** -- visual bar with effective win % after evaluation
- **Action card** -- color-coded RAISE / CALL / CAUTION / FOLD recommendation
- **Opponent count** -- shows detected players with +/- buttons for manual adjustment
- **"What can beat you?"** -- collapsible opponent range breakdown
- **Log** section -- tap the header to expand; "Copy" copies all entries to clipboard

```
+---------------------------+
| Poker Advisor    [Scan]   |
| Hold'em evaluator    [o]  |
+---------------------------+
| Your Cards (2/2)  (auto)  |
| [As] [Kh]      Clear All  |
|                           |
| Community Cards (3/5)     |
| [10c] [Jd] [4s]          |
|                           |
| [Hole] [Community]        |  <- pick target toggle
| [2][3][4]...[Q][K][A]     |  <- rank row
|     [c] [d] [h] [s]      |  <- suit row
|                           |
| -- (after 2+3 cards) --   |
| TWO PAIR                  |
| ########.....  62%        |
| W 58%  T 8%  L 34%        |
|                           |
| +----------------------+  |
| |       CALL           |  |
| |  Good hand - play it |  |
| +----------------------+  |
|                           |
| Players: 2  [-] [+]      |
| > What can beat you?      |
|                           |
| Log (3)          [Copy]   |
+---------------------------+
```

## Limitations

- **XHR interception depends on URL patterns** -- The script matches URLs containing `poker`, `holdem`, `stripPoker`, or related `sid`/`action`/`step` parameters. If Torn changes their endpoint naming, the auto-detection may need updating.
- **DOM scan is heuristic** -- Torn's poker page uses React/CSS-module classes that change between builds. If auto-scan stops working, use the manual card picker.
- **Card separation is best-effort** -- Without knowing Torn's exact JSON structure, hole vs community card separation relies on heuristics when structured fields aren't available.
- **NPC strategy not modelled** -- Win probability is calculated against random opponent hands. The actual NPC may fold/bet predictably, which could shift optimal play.
- **Monte Carlo variance** -- 5 000 simulations gives roughly +/-2% accuracy. Results may differ slightly between evaluations.
- **Multi-opponent scaling** -- With many opponents (6+) the simulation is more compute-intensive and win probabilities drop significantly (must beat ALL opponents).

## Changelog

### v2.2.0 -- Multi-Opponent Awareness
- `detectActivePlayers()` counts opponents via DOM selectors
- `calcWinProb()` and `calcOppRange()` simulate N-1 opponents (must beat ALL to win)
- UI shows opponent count with +/- adjustment buttons

### v2.1.0 -- DOM Detection Fix
- `parseCardClass()` uses unanchored regex (Torn CSS modules have hash suffixes)
- Rewrote `scanDom()` with 4 strategies targeting Torn holdem DOM selectors
- Added 1-second polling loop + change detection

### v2.0.0 -- Texas Hold'em Rewrite
- Rewrote from 5-card draw to Texas Hold'em format (2 hole + 5 community cards)
- Added `bestOfN()` evaluator for best-5-of-7 hand selection
- Separated UI into Hole Cards and Community Cards sections
- Added Hole/Community toggle in card picker
- Updated Monte Carlo simulation to deal remaining community + opponent hole cards
- Updated XHR interception to detect hole and community cards separately

### v1.1.0 -- Auto-Detection
- Added XHR/fetch interception for automatic card detection
- Added DOM CSS-class scanning for Torn's card format
- Added MutationObserver for automatic re-scanning

### v1.0.0 -- Initial Release
- Manual 5-card entry with hand evaluation and win probability
