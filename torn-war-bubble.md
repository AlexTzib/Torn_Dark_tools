# Torn PDA - War Online Bubble (Location + Timers)

## Overview

A local-only war-tracking overlay for [Torn City](https://www.torn.com) that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable red bubble that expands into a panel showing enemy faction members grouped by online status, location (Torn / abroad / hospital / jail), and remaining timers, with detection of faster-than-expected timer drops (potential bail/bust activity).

**The script is strictly read-only. It never attacks, revives, busts, bails, or performs any game action on the player's behalf.**

## Features

| Feature | Description |
|---|---|
| **Enemy faction tracker** | Fetches the enemy faction's member list via the Torn API (`faction/{id}?selections=basic`) |
| **Online/activity grouping** | Sorts members into: Online in Torn, Online abroad, Recently active in Torn, Recently active abroad, Hospital, Jail, Unknown |
| **Location inference** | Detects hospital, jail, federal jail, traveling, abroad, or in-Torn status from member data |
| **Timer extraction** | Parses hospital/jail/travel remaining time from multiple possible API fields (timestamps, text durations, numeric seconds) |
| **Fast-drop detection** | Compares consecutive timer readings to flag members whose timers dropped faster than wall-clock time (> 45s discrepancy), suggesting bail/bust/revive activity |
| **Manual faction ID** | Allows the user to manually enter an enemy faction ID if auto-detection fails |
| **Manual API key** | Allows the user to paste their API key directly (preferred method); falls back to detecting the key from Torn PDA network traffic |
| **Auto-polling** | Refreshes every 60 seconds when the panel is open |

## How It Works

```
┌────────────────────────────┐
│  Torn PDA makes API calls  │
│  (normal app traffic)      │
│                            │
│  hookFetch / hookXHR       │──▷ extractApiKeyFromUrl()
│  (passive, read-only)      │    Captures the user's own key
└────────────────────────────┘    from URL params (fallback only;
                                   manual key entry is preferred)
                │
   ┌────────────▼────────────┐
   │  refreshEnemyFactionData │
   │  fetch(api.torn.com/     │
   │    faction/{id}?         │──▷ One read-only API call
   │    selections=basic&     │    per refresh cycle
   │    key=...)              │
   └────────────┬────────────┘
                │
   ┌────────────▼────────────┐
   │  normalizeMembers()      │
   │  memberLastActionInfo()  │──▷ Parse & enrich each member
   │  inferLocationState()    │
   │  extractTimerInfo()      │
   │  analyzeTimerChange()    │
   └────────────┬────────────┘
                │
   ┌────────────▼────────────┐
   │  groupedMembers()        │──▷ Bucket into display groups
   │  renderPanel()           │
   └─────────────────────────┘
```

## API Key Handling

The script needs a Torn API key to fetch enemy faction data. Two methods are supported:

| Method | How | Storage | Priority |
|---|---|---|---|
| **Manual entry** (preferred) | User pastes their key into the panel's "API key" field | `localStorage` (encrypted at rest by the browser) | Highest — used first if available |
| **Network interception** (fallback) | Reads the `key=` parameter from Torn API URLs that Torn PDA already sends | In-memory only (`STATE.apiKey`) — never written to disk | Used only if no manual key is saved |

**The API key is never sent to any external server.** All API calls go directly to `api.torn.com`.

## Data Sources

| Source | Method | Notes |
|---|---|---|
| Enemy faction members | Direct API call: `api.torn.com/faction/{id}?selections=basic` | One call per poll cycle (60s when panel is open) |
| API key | Manual entry (preferred) or passive interception from PDA traffic (fallback) | See table above |
| Enemy faction ID | Auto-detected from URL / page links, or manually entered | Stored in `localStorage` |
| Timer history | Computed from consecutive API responses | Stored in `localStorage` (max 500 entries, 7-day expiry) |

## Torn Policy Compliance

| Rule | Status |
|---|---|
| No automation of game actions | Fully compliant — the script never attacks, bails, busts, revives, or triggers any game action |
| One-click-one-action principle | Fully compliant — no game actions are triggered |
| Read-only data display | Fully compliant — all data shown is from the Torn API `basic` selection, displayed in an overlay |
| API key handling | Manual entry is the preferred path; fallback interception only reads the user's own key from their own PDA traffic, stored in memory only |
| API rate limiting | One call per 60 seconds when the panel is open; no calls when minimized; well within the ~100/min rate limit |
| No external server communication | Fully compliant — the only outbound call is to `api.torn.com` |
| Faction data access | Uses `selections=basic` (the minimum needed) — does not request sensitive selections |
| Fast-drop detection | Passive analysis of timer deltas — no actions are taken; it only highlights the information |
| localStorage usage | Timer track history (max 500 entries, 7-day TTL), faction ID, API key (if manually entered), UI positions |

### Policy Notes

- **Viewing enemy faction online status is allowed** — this is public information accessible via the Torn API's `faction/basic` endpoint, the same data visible on the faction page.
- **Timer analysis** is advisory only and does not interact with the game in any way.
- The script follows the same patterns as established community tools (TornTools, YATA) that display faction member status.

## Installation

### Torn PDA
1. Open **Torn PDA** → Settings → **Userscripts**
2. Add a new script
3. Paste the contents of `torn-war-bubble.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. Save and reload any Torn page

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-war-bubble.user.js`
3. Save — the script will activate on all `torn.com` pages

## UI Controls

- **Bubble (red, "WAR")** — tap to expand; drag to reposition
- **Refresh** button — immediately fetches fresh faction data
- **○** button — collapses the panel back to the bubble
- **API key field** — paste your Torn API key here (recommended over auto-detection)
- **Manual faction ID** — enter the enemy faction ID if auto-detection doesn't work
- Auto-polling runs every 60 seconds while the panel is open; stops when minimized

## Limitations

- Faction `basic` selection provides limited status data — some members may show "Unknown location" if the API doesn't include detailed status fields.
- Timer accuracy depends on the precision of the API response fields.
- Fast-drop detection uses a 45-second threshold to avoid false positives from normal API timing variance.
- The script can only track one enemy faction at a time.
