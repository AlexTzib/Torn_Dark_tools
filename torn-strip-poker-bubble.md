# Torn PDA – Strip Poker Advisor (Bubble)

> Compact, pocket-friendly poker hand evaluator for Torn City's Strip Poker.
> Runs entirely in-browser — no API key required, no external calls.

---

## What It Does

| Feature | Detail |
|---------|--------|
| **Card Picker** | Two-tap entry: tap a rank (2–A), then a suit (♣♦♥♠). Selected cards appear above with tap-to-remove. |
| **Hand Evaluator** | Full 5-card poker hand recognition — High Card through Royal Flush. Handles ace-low straights (A-2-3-4-5). |
| **Win Probability** | Monte Carlo simulation (5 000 random opponent hands) computes Win / Tie / Lose percentages and an effective win % (ties count as half). |
| **Action Suggestion** | Color-coded recommendation: **RAISE** (≥72%), **CALL** (≥42%), **CAUTION** (≥30%), **FOLD** (<30%). |
| **Opponent Range** | Collapsible breakdown showing how often the opponent lands each hand type and what % of those beat yours. |
| **DOM Scan** | "Scan" button attempts to auto-detect cards from the page via image src/alt, data attributes, and suit-symbol text. Falls back to manual input gracefully. |
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
3. **Enter your 5 cards:**
   - Tap a rank (2, 3, … K, A) — it highlights green.
   - Tap a suit (♣ ♦ ♥ ♠) — the card is added.
   - Already-used suit buttons are greyed out.
   - Tap any selected card to remove it.
   - Or hit **Scan** to attempt automatic DOM detection.
4. Once 5 cards are entered, the advisor instantly shows:
   - **Hand name** (e.g. "Two Pair")
   - **Strength bar** with effective win %
   - **Action recommendation** (RAISE / CALL / CAUTION / FOLD)
5. Tap **"What can beat you?"** to expand the opponent range breakdown.
6. Hit **Clear** to reset for the next round.

---

## Panel Layout (260 px wide)

```
┌──────────────────────────┐
│ ♠ Poker Advisor    [Scan]│
│ Strip Poker evaluator  [○]│
├──────────────────────────┤
│ Your Hand (3/5)    Clear │
│ [A♠] [K♥] [10♣]         │
│                          │
│ [2][3][4]…[Q][K][A]     │  ← rank row
│     [♣] [♦] [♥] [♠]    │  ← suit row
│                          │
│ ▬▬▬ (after 5 cards) ▬▬▬ │
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

### Poker Engine

- **evaluate5()** — Determines hand rank (0–9) and a numeric score for tie-breaking via group-value encoding. Straights use `straightHigh` for correct ace-low ordering.
- **calcWinProb()** — Builds a 47-card remaining deck, Fisher-Yates partial-shuffles 5 000 opponent hands, evaluates each, counts wins/ties.
- **calcOppRange()** — Same simulation (3 000 samples) bucketed by hand name, tracking which beat the player's hand.
- **suggest()** — Maps effective win % to one of five action tiers with colour codes.

### DOM Scanning Strategies

| Strategy | Selector | Parses |
|----------|----------|--------|
| Images   | `img` elements | Card rank+suit from `src` and `alt` text patterns |
| Data attrs | `[data-card]`, `[data-rank]` | Structured card data |
| Text symbols | `[class*="card"]` with short text | Unicode suit symbols (♣♦♥♠) |

Scanning is best-effort. If it finds 1–5 valid cards it applies them; otherwise it logs a message and the user picks manually.

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

- **DOM scan is heuristic** — Torn's poker page uses React/CSS-module classes that change between builds. If auto-scan stops working, use the manual card picker.
- **Assumes 5-card poker** — If the game variant changes (e.g. community cards), the evaluator would need to be extended.
- **NPC strategy not modelled** — Win probability is calculated against a random opponent hand. The actual NPC may fold/bet predictably, which could shift optimal play.

---

## Files

| File | Purpose |
|------|---------|
| `torn-strip-poker-bubble.user.js` | The userscript (≈ 785 lines) |
| `torn-strip-poker-bubble.md` | This documentation |
