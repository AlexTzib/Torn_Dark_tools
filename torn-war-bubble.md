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
| **Attack buttons** | Each member row has "Copy Attack URL", "Copy Name", and "Go Attack" link buttons |
| **Manual faction ID** | Allows the user to manually enter an enemy faction ID if auto-detection fails |
| **Configurable poll interval** | Dropdown to set refresh rate: 30s / 1min / 2min / 5min / 10min |
| **Debug log** | Collapsible log panel with timestamped events and a "Copy Log" button for bug reporting |

## How It Works

```
┌────────────────────────────────────────────────┐
│            API Key Resolution                   │
│                                                 │
│  Priority 1: ###PDA-APIKEY### (Torn PDA auto)  │
│  Priority 2: Manual entry (localStorage)        │
│  Priority 3: Network interception (fallback)    │
└──────────────────┬─────────────────────────────┘
                   │
   ┌───────────────▼────────────┐
   │  refreshEnemyFactionData    │
   │  fetch(api.torn.com/        │
   │    faction/{id}?            │──▷ One read-only API call
   │    selections=basic&        │    per refresh cycle
   │    key=...)                 │
   └───────────────┬────────────┘
                   │
   ┌───────────────▼────────────┐
   │  normalizeMembers()         │
   │  memberLastActionInfo()     │──▷ Parse & enrich each member
   │  inferLocationState()       │
   │  extractTimerInfo()         │
   │  analyzeTimerChange()       │
   └───────────────┬────────────┘
                   │
   ┌───────────────▼────────────┐
   │  groupedMembers()           │──▷ Bucket into display groups
   │  renderPanel()              │
   └────────────────────────────┘
```

## API Key Handling

The script needs a Torn API key to fetch enemy faction data. Three methods are supported:

| Priority | Source | How | Storage |
|---|---|---|---|
| 1 (highest) | **Torn PDA injection** | PDA replaces `###PDA-APIKEY###` in the script source at injection time | In-memory (part of script source) |
| 2 | **Manual entry** | User pastes key in the panel's key field | `localStorage` |
| 3 (lowest) | **Network interception** | Reads the `key=` param from Torn API URLs that PDA sends | In-memory only — never persisted |

- In **Torn PDA**, the key loads automatically — no user action needed.
- In **Tampermonkey/Greasemonkey**, use the manual entry field.
- **The API key is never sent to any external server.** All API calls go directly to `api.torn.com`.

## Data Sources

| Source | Method | Notes |
|---|---|---|
| Enemy faction members | Direct API call: `api.torn.com/faction/{id}?selections=basic` | One call per poll cycle (configurable interval) |
| API key | PDA injection (primary), manual entry, or passive interception (fallback) | See table above |
| Enemy faction ID | Auto-detected from URL / page links, or manually entered | Stored in `localStorage` |
| Timer history | Computed from consecutive API responses | Stored in `localStorage` (max 500 entries, 7-day expiry) |

## Torn Policy Compliance

| Rule | Status |
|---|---|
| No automation of game actions | Fully compliant — the script never attacks, bails, busts, revives, or triggers any game action |
| One-click-one-action principle | Fully compliant — attack buttons open URLs or copy text (one click = one browser action) |
| Read-only data display | Fully compliant — all data shown is from the Torn API `basic` selection, displayed in an overlay |
| API key handling | Uses PDA's own injection mechanism; manual entry as fallback; the user's own key only |
| API rate limiting | Configurable interval (30s–10min, default 1min) when panel is open; no calls when minimized; well within the ~100/min rate limit |
| No external server communication | Fully compliant — the only outbound call is to `api.torn.com` |
| Faction data access | Uses `selections=basic` (the minimum needed) — does not request sensitive selections |
| Fast-drop detection | Passive analysis of timer deltas — no actions are taken; it only highlights the information |
| Attack buttons | Standard one-click links: "Go Attack" opens the attack page, copy buttons copy text to clipboard — same as manually clicking a profile link |
| localStorage usage | Timer track history (max 500 entries, 7-day TTL), faction ID, API key (if manually entered), poll interval preference, UI positions |

### Policy Notes

- **Viewing enemy faction online status is allowed** — this is public information accessible via the Torn API's `faction/basic` endpoint, the same data visible on the faction page.
- **Timer analysis** is advisory only and does not interact with the game in any way.
- **Attack buttons** do not automate attacks — they provide links/clipboard text that the user must manually act on (one click = one action).
- The script follows the same patterns as established community tools (TornTools, YATA) that display faction member status.

## Installation

### Torn PDA
1. Open **Torn PDA** → Settings → **Userscripts**
2. Add a new script
3. Paste the contents of `torn-war-bubble.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. **Set Injection Time to `Start`**
6. Save and reload any Torn page
7. The API key is loaded automatically — no configuration needed

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-war-bubble.user.js`
3. Save — the script will activate on all `torn.com` pages
4. Open the panel and enter your Torn API key in the key field

## UI Controls

- **Bubble (red, "WAR")** — tap to expand; drag to reposition
- **Refresh** button — immediately fetches fresh faction data
- **○** button — collapses the panel back to the bubble
- **Poll interval dropdown** — set refresh rate: 30s / 1min / 2min / 5min / 10min
- **API key field** — manual key entry (optional in Torn PDA, required in Tampermonkey)
- **Manual faction ID** — enter the enemy faction ID if auto-detection doesn't work
- **Attack buttons** — per-member: "Go Attack" (link), "Copy URL", "Copy Name"
- **Debug Log** section — tap the header to expand; "Copy Log" copies all entries to clipboard
- Auto-polling runs at the configured interval while the panel is open; stops when minimized

## Limitations

- Faction `basic` selection provides limited status data — some members may show "Unknown location" if the API doesn't include detailed status fields.
- Timer accuracy depends on the precision of the API response fields.
- Fast-drop detection uses a 45-second threshold to avoid false positives from normal API timing variance.
- The script can only track one enemy faction at a time.
- Outside Torn PDA, the `###PDA-APIKEY###` placeholder is not replaced, so manual key entry is required.
