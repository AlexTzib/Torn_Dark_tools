# Dark Tools - War Manager

## Overview

A war target assignment manager overlay for [Torn City](https://www.torn.com) that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable bubble that expands into a panel showing both faction rosters, estimates battle stats from public profile data, assigns enemy targets to own-faction members by configurable stat thresholds, and generates copy-paste messages for faction chat. Includes an online enemy report with attack links, a member selector for personal target lists, and configurable polling.

**The script is read-only. It never attacks, chains, or performs any game action on the player's behalf — all attack links require a manual user click.**

## Features

|| Feature | Description |
||---|---|
|| **Faction roster loading** | Fetches both own and enemy faction member lists from the Torn API (`faction/{id}?selections=basic`) |
|| **Stat scanning** | Scans member profiles (`user/{id}?selections=profile,personalstats,criminalrecord`) with 650ms gaps to stay under API rate limits |
|| **Stat estimation** | Uses `estimateStats` (from `common.js`) to map rank → battle stat midpoint, multiplied by a 0.7 safety factor for conservative matching |
|| **Target assignment** | `computeAssignments` pairs own-faction attackers to enemy targets by stat percentage threshold (configurable, default 120%) |
|| **Priority sorting** | `sortEnemiesByPriority` ranks enemies by: online+in Torn → hospital timer < 10 min → online elsewhere → hospital → recently active → offline |
|| **Member selector** | Pick any online own-faction member to build their personal target list at the current threshold |
|| **Online enemy report** | Live list of online enemies grouped by location (In Torn / Hospital / Abroad), with attack links, profile links, and copy name |
|| **Message generation** | Three formats: detailed (with profile + attack URLs), compact (one-liners), and per-member target lists — all copy-to-clipboard |
|| **Configurable threshold** | Stat threshold slider (10%–200%) controls how strong an enemy a member may be assigned |
|| **Configurable polling** | Refresh interval selector: 1 min, 2 min (default), 5 min, 10 min |
|| **Auto enemy detection** | Detects enemy faction from manual input, URL/links, or API war data (`fetchOwnFactionWars`) |
|| **Profile cache** | Caches scanned profiles in `localStorage` with 30-minute TTL to avoid redundant API calls |
|| **API key auto-detection** | Captures API key from PDA injection, manual entry, or network traffic interception |
|| **Debug log** | Collapsible log panel with timestamped events and a "Copy" button for bug reporting |

## How It Works

```
┌──────────────────────────────────────────────────────┐
│  User taps bubble → panel opens                      │
│                                                      │
│  ┌──────────────┐    ┌────────────────────────────┐  │
│  │ API key       │───▶│ detectEnemyFaction()        │  │
│  │ (PDA/manual/  │    │ manual ID / URL / API wars  │  │
│  │  intercepted) │    └────────────┬───────────────┘  │
│  └──────────────┘                 │                   │
│                                   ▼                   │
│          ┌────────────────────────────────────┐       │
│          │ refreshAll()                        │       │
│          │  fetchOwnFactionMembers()           │       │
│          │  fetchEnemyFactionMembers()          │       │
│          │  computeAssignments()                │       │
│          └────────────────┬───────────────────┘       │
│                           │                           │
│    ┌──────────────────────▼──────────────────────┐    │
│    │ Torn API v1                                  │    │
│    │ /faction/?selections=basic      (own)        │    │
│    │ /faction/{id}?selections=basic  (enemy)      │    │
│    └──────────────────────┬──────────────────────┘    │
│                           │                           │
│          User clicks "Scan All Stats"                 │
│                           │                           │
│    ┌──────────────────────▼──────────────────────┐    │
│    │ For each member (650ms gap):                 │    │
│    │ /user/{id}?selections=profile,               │    │
│    │   personalstats,criminalrecord               │    │
│    │                                              │    │
│    │ → rank, level, crimes, networth              │    │
│    │ → estimateStats() → stat midpoint            │    │
│    │ → midpoint × 0.7 (STAT_SAFETY_FACTOR)       │    │
│    └──────────────────────┬──────────────────────┘    │
│                           │                           │
│    ┌──────────────────────▼──────────────────────┐    │
│    │ computeAssignments()                         │    │
│    │ • Own online members sorted by midpoint desc │    │
│    │ • Enemies (not jailed) sorted by priority    │    │
│    │ • Match: enemy.midpoint ≤ own.midpoint × pct │    │
│    │ • Two-pass: scanned first, then unscanned    │    │
│    └──────────────────────┬──────────────────────┘    │
│                           │                           │
│    ┌──────────────────────▼──────────────────────┐    │
│    │ Render panel:                                │    │
│    │  War status / Member selector /              │    │
│    │  Online enemy report / Assignments /          │    │
│    │  Copy message buttons                         │    │
│    └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

### Stat Estimation

For each scanned member:
- **Rank** is fetched from the profile endpoint — Torn rank is directly determined by total battle stats
- **Midpoint** = community-sourced rank → stat bracket mapping via `rankToMidpoint()` in `common.js`
- **Safety factor** = midpoint × 0.7 (`STAT_SAFETY_FACTOR`) — conservative estimate so assigned targets are slightly weaker than raw midpoint suggests
- **Estimate label** = one of 7 display ranges (e.g., "< 2k", "2k–25k", … "> 200M") with colour coding

### Target Assignment Algorithm

`computeAssignments()` runs two passes:
1. **Scanned pass** — own members with stat estimates are matched to enemies with stat estimates where `enemy.midpoint ≤ own.midpoint × (threshold% / 100)`
2. **Unscanned pass** — own members without estimates get the next unassigned enemy (any)

The configurable **threshold** (default 120%) controls how much stronger the target may be relative to the attacker's estimated stats. Higher = riskier fights, lower = safer.

### API Calls

The script makes **two faction calls** on each refresh (own + enemy):

1. **Own faction** — Torn API v1:
```
GET https://api.torn.com/faction/?selections=basic&key={key}
```
Returns faction name, ID, and member list with status/last-action metadata.

2. **Enemy faction** — Torn API v1:
```
GET https://api.torn.com/faction/{enemy_id}?selections=basic&key={key}
```
Same structure, returns enemy roster.

On **stat scan**, one call per member with 650ms gaps (~92 calls/min):
```
GET https://api.torn.com/user/{id}?selections=profile,personalstats,criminalrecord&key={key}
```
Returns `{ rank, level, criminalrecord: {...}, personalstats: { networth } }`. Only online own members + all enemies are scanned; offline own members are skipped to save API calls.

## Data Sources

|| Source | Method | Notes |
||---|---|---|
|| Own faction roster | Torn API v1 (`/faction/?selections=basic`) | Returns faction ID, name, and member list with status/last-action fields |
|| Enemy faction roster | Torn API v1 (`/faction/{id}?selections=basic`) | Same structure; enemy faction ID from manual input, URL detection, or API war data |
|| Member profiles | Torn API v1 (`/user/{id}?selections=profile,personalstats,criminalrecord`) | Rank, level, crimes total, networth — used for stat estimation |
|| Stat estimation | Shared `estimateStats()` + `rankToMidpoint()` in `common.js` | Maps rank to stat bracket midpoint; 7 colour-coded display ranges |
|| War detection | Torn API v1 (`/faction/?selections=basic`) + page URL parsing | Auto-detects enemy faction from active/upcoming wars |
|| API key | PDA injection / manual entry / network interception | Three-tier priority system shared with other scripts |

## Torn Policy Compliance

|| Rule | Status |
||---|---|
|| No automation of game actions | Fully compliant — the script never attacks, chains, or clicks any game button. "Attack" links open the page for the user to act manually. |
|| One-click-one-action principle | Fully compliant — each link opens one browser tab, no chained actions |
|| Read-only data display | Fully compliant — all data shown is faction roster information and stat estimates from the Torn API |
|| API key handling | User's own key only; stored locally in `localStorage`; never sent externally |
|| No external server communication | Contacts only `api.torn.com`. No third-party services are used. |
|| API rate limits | 2 faction calls per refresh cycle; stat scans use 650ms gaps (~92 calls/min), well under the 100/min limit; online-only own members scanned to reduce call count |
|| Passive fetch/XHR interception | Used only to capture API key from existing traffic; does not modify requests |
|| localStorage usage | Profile cache (30-min TTL), enemy faction ID, stat threshold, poll interval, API key, and UI positions only |

## Installation

### Torn PDA
1. Open **Torn PDA** → Settings → **Userscripts**
2. Add a new script
3. Paste the contents of `torn-war-manager.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. **Set Injection Time to `Start`**
6. Save and reload any Torn page

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-war-manager.user.js`
3. Save — the script will activate on all `torn.com` pages
4. Open the panel and enter your Torn API key (16 characters) in the key field

## UI Controls

- **Bubble (orange, "MGR")** — tap to expand; drag to reposition (z-index 999945)
- **War Status** card — shows own/enemy faction names, online counts, hospital counts, detected war type & timer
- **Enemy Faction ID** — input field to manually set the enemy faction ID; auto-detected if a war is active
- **Settings** — stat threshold slider (10%–200%, default 120%) and refresh rate selector (1/2/5/10 min)
- **Scan All Stats** button — scans profiles for stat estimation; shows progress counter; tap again to stop
- **Refresh Data** button — re-fetches both faction rosters and recomputes assignments
- **Pick Attacker** — clickable member buttons to select an own-faction member and view their personal target list
- **Target list** — shows matched enemies for the selected member with Attack/Profile links and Copy button
- **Online Enemy Report** — grouped by location (In Torn / Hospital-Other / Abroad-Traveling); each row has Attack link, Profile link
- **Target Assignments** — auto-generated attacker → target pairs with "Copy Compact" and "Copy Detailed" buttons
- **Enemy — Available Targets** — full list of non-jailed enemies with status and stat estimates
- **Log** section — tap the header to expand; "Copy" copies all entries to clipboard
- **○** button — collapses the panel back to the bubble

## Limitations

- Requires an API key for all data (faction rosters and member profiles).
- Stat estimation is approximate — based on community-sourced rank → stat bracket mappings, not actual battle stats.
- The 0.7 safety factor makes assignments conservative; some beatable targets may be excluded.
- Each stat scan makes one API call per member with 650ms delays — scanning a large faction (100+ members) takes over a minute.
- Profile cache TTL is 30 minutes; stat estimates may be stale if a member ranks up within that window.
- Only online own-faction members are scanned to save API calls — offline members will have no stat estimate.
- Enemy faction must be set manually if no active/upcoming war is detected via the API.
- Polling only runs while the panel is open; collapsing to the bubble pauses refresh cycles.
- Hospital/travel timers are inferred from API data and may drift between refreshes.
- The script cannot detect if a target has already been attacked by another faction member.
- Browser notifications are not used — coordination relies on copy-paste messages.
- Version 1.3.2 (`SCRIPT_KEY: tpda_war_manager_v1`).
