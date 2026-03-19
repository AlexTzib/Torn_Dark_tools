# Torn PDA – Strip Poker Advisor (Bubble)

> Texas Hold'em poker advisor for Torn City's Strip Poker.
> Runs entirely in-browser — no API key required, no external calls.

---

## What It Does

| Feature | Detail |
|---------|--------|
| **Card Picker** | Two-tap entry: tap a rank (2–A), then a suit (♣♦♥♠). Hole/Community toggle lets you pick where cards go. |
| **Auto-Detection** | Intercepts XHR/fetch game data to automatically read your hole cards and community cards separately. Also scans DOM for Torn's CSS-class card format (e.g. `hearts-2`, `spades-K`). MutationObserver triggers auto-scan when new cards appear. |
| **Hand Evaluator** | Full Texas Hold'em evaluation — finds the best 5-card hand from your 2 hole cards + up to 5 community cards. Recognises High Card through Royal Flush. Handles ace-low straights (A-2-3-4-5). |
| **Win Probability** | Monte Carlo simulation (3 000 trials) deals remaining community cards + 2 random opponent hole cards, evaluates best-of-7 for each player. Computes Win / Tie / Lose percentages and effective win %. |
| **Action Suggestion** | Color-coded recommendation: **RAISE** (≥72%), **CALL** (≥42%), **CAUTION** (≥30%), **FOLD** (<30%). |
| **Opponent Range** | Collapsible breakdown showing how often the opponent lands each hand type and what % of those beat yours. |
| **DOM Scan** | "Scan" button manually triggers DOM card detection. Also runs automatically via MutationObserver when game elements change. Falls back to manual input gracefully. |
| **Tiny Bubble** | 40 px dark-green circle (♠) — intentionally small so it won't cover the poker screen on mobile/PDA. |

---

## Installation

| Method | Steps |
|--------|-------|
| **Torn PDA** | Settings → User Scripts → paste the raw `.user.js` URL → set injection to **Start** |
| **Tampermonkey** | Dashboard → "+" → paste full script → Save |

No API key is needed — the advisor is 100 % client-side math.

---

## How to Use

1. Open the Strip Poker page in Torn.
2. Tap the **♠ bubble** to open the panel.
3. **Cards are detected automatically** when the poker game sends data.
   - The header shows **(auto)** when cards came from game data, **(scanned)** from DOM scan.
   - Hole cards and community cards are shown in **separate sections**.
   - You can also **enter cards manually**: toggle Hole/Community target, tap a rank, then a suit.
   - Or hit **Scan** to force a DOM re-scan.
   - Tap any selected card to remove it.
4. Once you have **2 hole cards + 3+ community cards** (flop or later), the advisor instantly shows:
   - **Best hand name** from all possible 5-card combinations (e.g. "Two Pair")
   - **Strength bar** with effective win %
   - **Action recommendation** (RAISE / CALL / CAUTION / FOLD)
5. Evaluation updates automatically as more community cards appear (turn, river).
6. Tap **"What can beat you?"** to expand the opponent range breakdown.
7. Hit **Clear All** to reset for the next round.

---

## Panel Layout (260 px wide)

```
┌──────────────────────────┐
│ ♠ Poker Advisor    [Scan]│
│ Hold'em evaluator    [○] │
├──────────────────────────┤
│ Your Cards (2/2)  (auto) │
│ [A♠] [K♥]      Clear All │
│                          │
│ Community Cards (3/5)    │
│ [10♣] [J♦] [4♠]         │
│                          │
│ [Hole] [Community]       │  ← pick target toggle
│ [2][3][4]…[Q][K][A]     │  ← rank row
│     [♣] [♦] [♥] [♠]    │  ← suit row
│                          │
│ ▬▬ (after 2+3 cards) ▬▬ │
│ TWO PAIR                 │
│ ████████░░░░░  62%       │
│ W 58% · T 8% · L 34%    │
│                          │
│ ┌──────────────────────┐ │
│ │       CALL           │ │
│ │  Good hand — play it │ │
│ └──────────────────────┘ │
│                          │
│ ▶ What can beat you?     │
│                          │
│ Log (3)          [Copy]  │
└──────────────────────────┘
```

---

## Technical Details

### Poker Engine (v2.0.0 — Texas Hold'em)

- **evaluate5()** — Determines hand rank (0–9) and a numeric score for tie-breaking via group-value encoding. Straights use `straightHigh` for correct ace-low ordering.
- **bestOfN(cards)** — Evaluates all C(n,5) combinations from the available cards (up to 7), returns the strongest hand. This is the core Hold'em evaluator that picks the best 5 out of 7.
- **calcWinProb(hole, community)** — Monte Carlo simulation (3 000 trials). For each trial: deals remaining community cards to complete 5, deals 2 random opponent hole cards, evaluates best-of-7 for both players, counts wins/ties/losses.
- **calcOppRange(hole, community)** — Same simulation (3 000 samples) bucketed by opponent hand name, tracking which beat the player's hand.
- **suggest()** — Maps effective win % to one of five action tiers with colour codes.

### Card Detection (v2.0.0)

The script uses three complementary methods to detect your poker hand:

| Method | How It Works | Priority |
|--------|-------------|----------|
| **XHR/Fetch interception** | Hooks `fetch()` and `XMLHttpRequest` to intercept poker game JSON responses. Looks for structured fields: `player.hand`, `yourCards`, `community`, `board`, `tableCards`, etc. Falls back to deep-scanning for `classCode` fields. | Highest — installed immediately on script load |
| **DOM CSS-class scan** | Scans elements with CSS classes matching `hearts-N`, `diamonds-K`, etc. | Medium — runs on Scan button or MutationObserver trigger |
| **Legacy DOM scan** | Checks `<img>` src/alt, `[data-card]` attributes, and unicode suit symbols in `[class*="card"]` elements | Lowest — fallback strategies |

The URL matcher also matches `/holdem/i` patterns in addition to `poker`, `stripPoker`, and related `sid`/`action`/`step` parameters.

A `MutationObserver` watches for DOM changes and automatically triggers a scan (debounced 500ms) when the panel is open.

XHR-detected cards take priority over DOM-scanned cards to prevent overwriting accurate game data with potentially noisy DOM reads.

### Hold'em Card Separation

When cards are auto-detected, the script attempts to separate hole cards from community cards:

1. **Structured fields** — Tries known field names first (`player.hand` → hole, `community`/`board` → table)
2. **Deep scan heuristic** — If no structured fields found, treats the first 2 unique cards as hole cards and the rest as community cards
3. **DOM scan** — Same heuristic (first 2 = hole, rest = community)

### Compact Design Choices

| Aspect | Value | Why |
|--------|-------|-----|
| Bubble size | 40 px | Won't cover the poker table on pocket/PDA screens |
| Panel width | 260 px | Leaves room for the game UI on small screens |
| z-index base | 999960 | Below all other TPDA bubbles (war=999970, plushie=999980, AI=999990) |
| No API calls | — | Pure math, zero network overhead, no key needed |

### localStorage Keys

| Key | Content |
|-----|---------|
| `tpda_strip_poker_v1_bubble_pos` | `{right, bottom}` bubble position |
| `tpda_strip_poker_v1_panel_pos`  | `{left, top}` panel position |

---

## Limitations

- **XHR interception depends on URL patterns** — The script matches URLs containing `poker`, `holdem`, `stripPoker`, or related `sid`/`action`/`step` parameters. If Torn changes their endpoint naming, the auto-detection may need updating.
- **DOM scan is heuristic** — Torn's poker page uses React/CSS-module classes that change between builds. If auto-scan stops working, use the manual card picker.
- **Card separation is best-effort** — Without knowing Torn's exact JSON structure, hole vs community card separation relies on heuristics when structured fields aren't available.
- **NPC strategy not modelled** — Win probability is calculated against a random opponent hand. The actual NPC may fold/bet predictably, which could shift optimal play.
- **Monte Carlo variance** — 3 000 simulations gives roughly ±2% accuracy. Results may differ slightly between evaluations.

---

## Changelog

### v2.0.0 — Texas Hold'em Rewrite
- Rewrote from 5-card draw to **Texas Hold'em** format (2 hole + 5 community cards)
- Added `bestOfN()` evaluator for best-5-of-7 hand selection
- Separated UI into **Hole Cards** and **Community Cards** sections
- Added **Hole/Community toggle** in card picker
- Updated Monte Carlo simulation to deal remaining community + 2 opponent hole cards
- Updated XHR interception to detect hole and community cards separately
- Added `/holdem/` URL pattern matching
- DOM scanner now handles up to 7 cards (was 5)

### v1.1.0 — Auto-Detection
- Added XHR/fetch interception for automatic card detection
- Added DOM CSS-class scanning for Torn's card format
- Added MutationObserver for automatic re-scanning

### v1.0.0 — Initial Release
- Manual 5-card entry with hand evaluation and win probability

---

## Files

| File | Purpose |
|------|---------|
| `torn-strip-poker-bubble.user.js` | The userscript (≈ 1900 lines) |
| `torn-strip-poker-bubble.md` | This documentation |
