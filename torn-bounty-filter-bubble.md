# Dark Tools - Bounty Filter

## Overview

A bounty overlay for [Torn City](https://www.torn.com) that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable bubble that expands into a panel listing active bounties enriched with each target's real-time status (hospital, jail, abroad, in Torn). Includes configurable state/level/reward filters, hospital release-timer awareness, and one-tap Attack links for fast claiming.

**The script is read-only. It never claims bounties or performs any game action on the player's behalf.**

## Features

|| Feature | Description |
||---|---|
|| **Bounty list** | Fetches all active bounties from the Torn API (`torn/?selections=bounties`) |
|| **Target enrichment** | Enriches each target with `user/{id}?selections=profile` to determine status, level, and timers (up to 30 targets per refresh, 350ms between calls) |
|| **State filters** | Toggle visibility per state: In Torn (OK), Hospital, Jail, Abroad, Unknown |
|| **Level filter** | Max Level — hide targets above a configurable level threshold (0 = no limit) |
|| **Reward filter** | Min Reward — hide bounties below a configurable dollar amount (0 = no limit) |
|| **Hospital timer filter** | Hide hospital targets releasing in less than N minutes (configurable threshold, default 5 min) |
|| **State icons & colours** | Each bounty row shows a colour-coded icon: ✔ green (Torn), ⚕ red (Hospital), ⛔ orange (Jail), ✈ blue (Abroad), ❓ grey (Unknown) |
|| **Profile links** | Target name links to their Torn profile |
|| **Attack button** | Red "Attack" link per bounty row opens the attack page for the user to act manually |
|| **Bounty list cache** | 2-minute TTL — avoids redundant API calls when reopening the panel |
|| **Status cache** | 1-minute TTL per target — avoids re-fetching status within the cache window |
|| **Auto-fetch on open** | Bounties auto-fetch when the panel is opened and cache is stale |
|| **API key auto-detection** | Captures API key from PDA injection, manual entry, or network traffic interception |
|| **Debug log** | Collapsible log panel with timestamped events and a "Copy" button for bug reporting |

## How It Works

```
┌─────────────────────────────────────────────────────┐
│  User taps bubble → panel opens                     │
│                                                     │
│  ┌──────────────┐    ┌───────────────────────────┐  │
│  │ API key       │───▶│ fetchBounties()            │  │
│  │ (PDA/manual/  │    │ if cache stale (>2 min)    │  │
│  │  intercepted) │    └────────────┬──────────────┘  │
│  └──────────────┘                 │                  │
│                                   ▼                  │
│                   ┌───────────────────────────┐      │
│                   │ GET torn/?selections=      │      │
│                   │     bounties               │      │
│                   │ Parse bounty list           │      │
│                   └────────────┬──────────────┘      │
│                                │                     │
│                                ▼                     │
│                   ┌───────────────────────────┐      │
│                   │ enrichBountyTargets()       │      │
│                   │ Up to 30 unique targets     │      │
│                   │ 350ms gap between calls     │      │
│                   │                             │      │
│                   │ GET user/{id}?selections=   │      │
│                   │     profile                 │      │
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
- **Profile fetch** — `user/{id}?selections=profile` returns status, description, level, last action, timers
- **Location inference** — `inferLocationState()` (shared in `common.js`) classifies the target into `torn`, `hospital`, `jail`, `abroad`/`traveling`, or `unknown`
- **Timer extraction** — `extractTimerInfo()` (shared in `common.js`) pulls the remaining seconds for hospital/jail states
- **Cache** — Each result is cached with a 1-minute TTL to avoid re-fetching the same target within the window

### API Calls

The script makes **one call for the bounty list** plus **one call per unique target** (up to 30):

1. **Bounty list** — Torn API v2 (the `bounties` selection was migrated to v2-only in March 2025):
```
GET https://api.torn.com/v2/torn/?selections=bounties&key={key}
```
Returns `{ bounties: [ { target_id, target_name, target_level, reward, lister_id, lister_name, reason, quantity, is_anonymous, valid_until }, ... ] }`. Note: v2 returns an **array** (v1 returned an object keyed by bounty ID).

2. **Target status** — Torn API v1 (per target):
```
GET https://api.torn.com/user/{target_id}?selections=profile&key={key}
```
Returns profile data used by `inferLocationState()` and `extractTimerInfo()` to determine state and remaining timer.

Calls are made sequentially with a **350ms gap** between each target lookup (~170 requests/minute for this script alone, shared budget with other scripts). A full enrichment of 30 targets takes approximately 10–11 seconds.

## Data Sources

|| Source | Method | Notes |
||---|---|---|
|| Bounty list | Torn API v2 (`v2/torn/?selections=bounties`) | Returns all active bounties as an array with target ID, name, level, reward, lister, quantity, reason, valid_until |
|| Target status | Torn API v1 (`user/{id}?selections=profile`) | Returns profile data; parsed by `inferLocationState()` into state buckets |
|| Location inference | Shared `inferLocationState()` in `common.js` | Classifies target as torn / hospital / jail / abroad / traveling / unknown |
|| Timer extraction | Shared `extractTimerInfo()` in `common.js` | Extracts remaining seconds for hospital / jail states |
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
|| localStorage usage | Filter settings, status cache (1-min TTL), bounty list cache (2-min TTL), API key, and UI positions only |

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
- **Filters card** — toggle state visibility (In Torn, Hospital, Jail, Abroad, Unknown); set Max Level and Min Reward; toggle "hide hospital releasing soon" with configurable minute threshold
- **Bounty rows** — each row shows: state icon (colour-coded), target name (profile link), level, state label with timer, reward amount, and an Attack button
- **Status bar** — shows filtered/total count and last-updated time; progress indicator during enrichment
- **Log** section — tap the header to expand; "Copy" copies all entries to clipboard

## Limitations

- Requires an API key for all data — no third-party fallback.
- Each refresh makes up to 31 API calls (1 list + 30 targets). Avoid spamming the Refresh button.
- Only the first 30 unique targets are enriched per refresh; remaining targets show as "Unknown" until the next refresh cycle.
- The 350ms inter-call gap means a full enrichment of 30 targets takes ~10 seconds.
- Bounty list cache (2-min TTL) means new bounties may not appear immediately if checked within the cache window without refreshing.
- Status cache (1-min TTL) means a target's state may be slightly stale within the cache window.
- Hospital timer values are point-in-time snapshots — they count down visually but the underlying data is only as fresh as the last fetch.
- Browser/PDA environments may vary in fetch behaviour; `PDA_httpGet` is used when available.
- The script does not detect whether you have already claimed a bounty — expired or already-claimed bounties may still appear until the list refreshes.
