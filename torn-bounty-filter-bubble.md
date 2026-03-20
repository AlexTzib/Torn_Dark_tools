# Dark Tools - Bounty Filter

## Overview

A bounty overlay for [Torn City](https://www.torn.com) that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable bubble that expands into a panel listing active bounties enriched with each target's real-time status (hospital, jail, abroad, in Torn). Includes configurable state/level/reward filters, hospital release-timer awareness, and one-tap Attack links for fast claiming.

**The script is read-only. It never claims bounties or performs any game action on the player's behalf.**

## Features

|| Feature | Description |
||---|---|
|| **Bounty list** | Fetches all active bounties from the Torn API (`torn/?selections=bounties`) |
|| **Target enrichment** | Enriches each target with `v2/user/{id}?selections=profile` to determine status, level, rank, estimated battle stats, and timers (up to 30 targets per refresh, 350ms between calls) |
|| **State filters** | Toggle visibility per state: In Torn (OK), Hospital, Jail, Abroad, Unknown |
|| **Level filter** | Max Level — hide targets above a configurable level threshold (0 = no limit) |
|| **Reward filter** | Min Reward — hide bounties below a configurable dollar amount (0 = no limit) |
|| **Battle stats filter** | Max Stats — dropdown with 7 estimated stat ranges (< 2k through > 200M). Based on target's Torn rank. Hides targets above the selected range. |
|| **Hospital timer filter** | Hide hospital targets releasing in less than N minutes (configurable threshold, default 5 min) |
|| **State icons & colours** | Each bounty row shows a colour-coded icon: ✔ green (Torn), ⚕ red (Hospital), ⛔ orange (Jail), ✈ blue (Abroad), ❓ grey (Unknown) |
|| **Estimated stats display** | Each bounty row shows the target's estimated stat range (colour-coded) next to their state label |
|| **Profile links** | Target name links to their Torn profile |
|| **Attack button** | Red "Attack" link per bounty row opens the attack page for the user to act manually |
|| **Bounty list cache** | 10-minute localStorage persistence — cached bounty list survives panel close/reopen and page navigation |
|| **Status cache** | 10-minute localStorage persistence per target — avoids re-fetching status on every panel open. 1-minute in-memory TTL skips already-fresh targets during enrichment |
|| **Manual refresh** | Panel shows cached data on open; tap **Refresh** to fetch fresh bounties and re-enrich targets |
|| **API key auto-detection** | Captures API key from PDA injection, manual entry, or network traffic interception |
|| **Debug log** | Collapsible log panel with timestamped events and a "Copy" button for bug reporting |

## How It Works

```
┌─────────────────────────────────────────────────────┐
│  User taps bubble → panel opens                     │
│  Shows cached bounties (if any) immediately         │
│                                                     │
│  User taps Refresh ─────────────────┐               │
│                                     ▼               │
│  ┌──────────────┐    ┌───────────────────────────┐  │
│  │ API key       │───▶│ fetchBounties()            │  │
│  │ (PDA/manual/  │    │ Always fetches fresh data  │  │
│  │  intercepted) │    └────────────┬──────────────┘  │
│  └──────────────┘                 │                  │
│                                   ▼                  │
│                   ┌───────────────────────────┐      │
│                   │ GET v2/torn/?selections=   │      │
│                   │     bounties               │      │
│                   │ Parse bounty list           │      │
│                   │ Save to localStorage        │      │
│                   └────────────┬──────────────┘      │
│                                │                     │
│                                ▼                     │
│                   ┌───────────────────────────┐      │
│                   │ enrichBountyTargets()       │      │
│                   │ Up to 30 unique targets     │      │
│                   │ 350ms gap between calls     │      │
│                   │                             │      │
│                   │ GET v2/user/{id}?selections= │      │
│                   │     profile                 │      │
│                   │ Save results to localStorage│      │
│                   └────────────┬──────────────┘      │
│                                │                     │
│                                ▼                     │
│                   ┌───────────────────────────┐      │
│                   │ inferLocationState()        │      │
│                   │ extractTimerInfo()          │      │
│                   │ (shared helpers, common.js) │      │
│                   │                             │      │
│                   │ → state, label,             │      │
│                   │   remainingSec, level       │      │
│                   └────────────┬──────────────┘      │
│                                │                     │
│                                ▼                     │
│                   ┌───────────────────────────┐      │
│                   │ applyEnrichment()           │      │
│                   │ Merge status into bounties  │      │
│                   └────────────┬──────────────┘      │
│                                │                     │
│                                ▼                     │
│                   ┌───────────────────────────┐      │
│                   │ filteredBounties()           │      │
│                   │ Apply state / level / reward │      │
│                   │ / hospital-soon filters      │      │
│                   └────────────┬──────────────┘      │
│                                │                     │
│                                ▼                     │
│                   ┌───────────────────────────┐      │
│                   │ renderPanel()               │      │
│                   │ State icon, name (link),    │      │
│                   │ level, reward, timer,        │      │
│                   │ Attack button per row        │      │
│                   └───────────────────────────┘      │
└─────────────────────────────────────────────────────┘
```

### Enrichment Pipeline

For each unique target in the bounty list (up to 30 per refresh):
- **Profile fetch** — `v2/user/{id}?selections=profile` returns status, description, level, last action, timers. Handles both v2 nested (`data.profile`) and flat response formats.
- **Location inference** — `inferLocationState()` (shared in `common.js`) classifies the target into `torn`, `hospital`, `jail`, `abroad`/`traveling`, or `unknown`
- **Timer extraction** — `extractTimerInfo()` (shared in `common.js`) pulls the remaining seconds for hospital/jail states
- **Cache** — Results are cached in localStorage with a 10-minute TTL. In-memory 1-minute TTL skips already-fresh targets during enrichment.

### API Calls

The script makes **one call for the bounty list** plus **one call per unique target** (up to 30):

1. **Bounty list** — Torn API v2 (the `bounties` selection was migrated to v2-only in March 2025):
```
GET https://api.torn.com/v2/torn/?selections=bounties&key={key}
```
Returns `{ bounties: [ { target_id, target_name, target_level, reward, lister_id, lister_name, reason, quantity, is_anonymous, valid_until }, ... ] }`. Note: v2 returns an **array** (v1 returned an object keyed by bounty ID).

2. **Target status** — Torn API v2 (per target):
```
GET https://api.torn.com/v2/user/{target_id}?selections=profile&key={key}
```
Returns profile data used by `inferLocationState()` and `extractTimerInfo()` to determine state and remaining timer. The response may nest data under a `profile` key (v2 format) or return flat fields (v1 compatibility); the script handles both.

Calls are made sequentially with a **350ms gap** between each target lookup (~170 requests/minute for this script alone, shared budget with other scripts). A full enrichment of 30 targets takes approximately 10–11 seconds.

## Data Sources

|| Source | Method | Notes |
||---|---|---|
|| Bounty list | Torn API v2 (`v2/torn/?selections=bounties`) | Returns all active bounties as an array with target ID, name, level, reward, lister, quantity, reason, valid_until |
|| Target status | Torn API v2 (`v2/user/{id}?selections=profile`) | Returns profile data; parsed by `inferLocationState()` into state buckets. Handles v2 nested and flat formats. |
|| Location inference | Shared `inferLocationState()` in `common.js` | Classifies target as torn / hospital / jail / abroad / traveling / unknown |
|| Timer extraction | Shared `extractTimerInfo()` in `common.js` | Extracts remaining seconds for hospital / jail states |
|| Stat estimation | Shared `estimateStats()` in `common.js` | Maps target's rank to one of 7 battle stat ranges using community-sourced rank-to-stat correlations |
|| API key | PDA injection / manual entry / network interception | Three-tier priority system shared with other scripts |

## Torn Policy Compliance

|| Rule | Status |
||---|---|
|| No automation of game actions | Fully compliant — the script never claims bounties, attacks, or clicks any game button. "Attack" links open the attack page for the user to act manually. |
|| One-click-one-action principle | Fully compliant — each Attack link opens one browser tab, no chained actions |
|| Read-only data display | Fully compliant — all data shown is bounty and profile information from the Torn API |
|| API key handling | User's own key only; stored locally in `localStorage`; never sent externally |
|| No external server communication | Contacts only `api.torn.com`. No third-party services are used. |
|| API rate limits | 1 bounty list call + up to 30 profile calls per refresh, 350ms apart (~86 calls/min worst case); within the 100/min limit |
|| Passive fetch/XHR interception | Used only to capture API key from existing traffic; does not modify requests |
|| localStorage usage | Filter settings, status cache (10-min TTL), bounty list cache (10-min TTL), API key, and UI positions only |

## Installation

### Torn PDA
1. Open **Torn PDA** → Settings → **Userscripts**
2. Add a new script
3. Paste the contents of `torn-bounty-filter-bubble.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. **Set Injection Time to `Start`**
6. Save and reload any Torn page

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-bounty-filter-bubble.user.js`
3. Save — the script will activate on all `torn.com` pages
4. Open the panel and enter your Torn API key (16 characters) in the key field

## UI Controls

- **Bubble (orange gradient, "BTY")** — tap to expand; drag to reposition; 56px circle at z-index 999950
- **Refresh** button — fetches the bounty list and enriches targets with current status
- **○** button — collapses the panel back to the bubble
- **Filters card** — toggle state visibility (In Torn, Hospital, Jail, Abroad, Unknown); set Max Level, Min Reward, and Max Stats (estimated battle stat range dropdown); toggle "hide hospital releasing soon" with configurable minute threshold
- **Bounty rows** — each row shows: state icon (colour-coded), target name (profile link), level, state label with timer, estimated stat range (colour-coded), reward amount, and an Attack button
- **Status bar** — shows filtered/total count and last-updated time; progress indicator during enrichment
- **Log** section — tap the header to expand; "Copy" copies all entries to clipboard

## Limitations

- Requires an API key for all data — no third-party fallback.
- Each refresh makes up to 31 API calls (1 list + 30 targets). Avoid spamming the Refresh button.
- Only the first 30 unique targets are enriched per refresh; remaining targets show as "Unknown" until the next refresh cycle.
- The 350ms inter-call gap means a full enrichment of 30 targets takes ~10 seconds.
- Cached bounty list and statuses persist for 10 minutes in localStorage. Tap Refresh for fresh data.
- Hospital timer values are point-in-time snapshots — they count down visually but the underlying data is only as fresh as the last fetch.
- Browser/PDA environments may vary in fetch behaviour; `PDA_httpGet` is used when available.
- The script does not detect whether you have already claimed a bounty — expired or already-claimed bounties may still appear until the list refreshes.

## Changelog

### v1.2.0
- **Fix: state assessment** — Migrated target profile endpoint from v1 to v2 (`api.torn.com/v2/user/{id}?selections=profile`). Handles both v2 nested (`data.profile`) and flat response formats. Previously, state detection could fail silently if the v1 endpoint returned errors, causing all targets to show as "Unknown" and bypassing state filters.
- **Fix: hospital filter** — Hospital targets now correctly hide when the Hospital checkbox is unchecked (root cause: failed state assessment categorised them as "Unknown").
- **Cache: localStorage persistence** — Bounty list and target statuses are now cached in localStorage (10-minute TTL). Opening the panel shows cached data immediately instead of re-fetching from the API every time.
- **Manual refresh only** — Panel no longer auto-fetches on open. Tap the Refresh button to fetch fresh data. Reduces unnecessary API calls.

### v1.1.0
- Bumped version for PDA update with Dark Tools naming.

### v1.0.0
- Initial release: bounty list fetch, target enrichment, state/level/reward filters, hospital timer filter, attack links.
