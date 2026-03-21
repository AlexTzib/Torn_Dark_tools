# Dark Tools - Traveler Utility

## Overview

A quick-travel navigation overlay for [Torn City](https://www.torn.com) that runs inside **Torn PDA** (or any Tampermonkey/Greasemonkey-compatible browser).
It displays a draggable bubble that expands into a panel showing your current travel status and one-tap navigation buttons for common travel destinations (Mexico, Cayman Islands, Canada). When abroad, it shows contextual actions (open shop, fly home).

**The script is read-only. It never buys, sells, flies, or performs any game action on the player's behalf. All buttons navigate to the relevant Torn page where the user must confirm the action manually.**

## Features

|| Feature | Description |
||---|---|
|| **Travel status** | Shows whether you're in Torn, abroad (with country name), or in flight (with ETA countdown) |
|| **Quick-travel buttons** | One tap to navigate to the travel agency page for Mexico, Cayman Islands, or Canada |
|| **Abroad actions** | When abroad: button to open the abroad shop page (plushies, flowers) or fly home |
|| **In-flight ETA** | Progress bar and countdown timer when traveling |
|| **Arrival tips** | Shows what to do when you arrive (buy plushies, visit bank, buy flowers) |
|| **Auto-polling** | Refreshes travel status every 30 seconds while the panel is open |
|| **API key auto-detection** | Captures API key from PDA injection, manual entry, or network traffic interception |
|| **Debug log** | Collapsible log panel with timestamped events and a "Copy" button for bug reporting |

## How It Works

```
+------------------------------------------------+
|  User taps bubble -> panel opens               |
|                                                |
|  +---------------+    +---------------------+  |
|  | API key        |-->| fetchTravelStatus()  |  |
|  | (PDA/manual/   |   | user/?selections=    |  |
|  |  intercepted)  |   | travel,profile       |  |
|  +---------------+    +----------+----------+  |
|                                  |              |
|                     +------------v-----------+  |
|                     | parseTravelData()       |  |
|                     | Determine: in Torn /    |  |
|                     | abroad / traveling      |  |
|                     +------------+-----------+  |
|                                  |              |
|                     +------------v-----------+  |
|                     | renderPanel()           |  |
|                     | Show status card +      |  |
|                     | context-appropriate     |  |
|                     | action buttons          |  |
|                     +------------------------+  |
+------------------------------------------------+
```

### State Detection

The script determines your location from the API response:
- **Traveling**: `travel.time_left > 0` — shows ETA countdown and progress bar
- **Abroad**: status state contains "abroad" or description matches "In Mexico/Canada/Cayman..." — shows shop and return buttons
- **In Torn**: default state — shows quick-travel destination buttons

### Context-Sensitive Actions

| Location | Actions Shown |
|---|---|
| In Torn City | Fly to Mexico (plushies, ~26 min), Fly to Cayman (banking, ~35 min), Fly to Canada (flowers, ~41 min) |
| Abroad (Mexico/Canada) | Open abroad shop, Fly back to Torn |
| Abroad (Cayman) | Banking info note, Fly back to Torn |
| In Flight | ETA countdown with progress bar, arrival tips for destination |

## API Calls

The script makes **one** API call per poll cycle:

```
GET https://api.torn.com/user/?selections=travel,profile&key={key}
```

Returns travel status (destination, time_left, departed, timestamp) and profile status (state, description).

- Polling interval: every 30 seconds while panel is open
- Polling stops when panel is collapsed to bubble
- Tagged with `&_tpda=1` to avoid double-processing by fetch/XHR hooks

## Countries

|| Country | Flag | Typical Items | Approx. Fly Time |
||---|---|---|---|
|| Mexico | MX | Plushies | ~26 min |
|| Cayman Islands | KY | Banking | ~35 min |
|| Canada | CA | Flowers | ~41 min |

## Data Sources

|| Source | Method | Notes |
||---|---|---|
|| Travel status | Torn API v1 (`user/?selections=travel,profile`) | Returns travel destination, time_left, status state/description |
|| API key | PDA injection / manual entry / network interception | Three-tier priority system shared with other scripts |

## Torn Policy Compliance

|| Rule | Status |
||---|---|
|| No automation of game actions | Fully compliant — the script never initiates travel, purchases, or any game action. All buttons navigate to the relevant Torn page where the user must confirm manually. |
|| One-click-one-action principle | Fully compliant — each button navigates to one page |
|| Read-only data display | Fully compliant — shows travel status from the API only |
|| API key handling | User's own key only; stored locally in `localStorage`; never sent externally |
|| No external server communication | Only contacts `api.torn.com` |
|| API rate limits | 1 call per 30s while panel is open (~2/min); well under the 100/min limit |
|| No request modification | Compliant — fetch/XHR hooks only read, never modify |
|| Passive fetch/XHR interception | Used only to capture API key from existing traffic; does not modify requests |
|| localStorage usage | API key, bubble/panel positions only |

## Installation

### Torn PDA
1. Open **Torn PDA** -> Settings -> **Userscripts**
2. Add a new script
3. Paste the contents of `torn-traveler-utility-bubble.user.js`
4. Set the match pattern to `https://www.torn.com/*`
5. **Set Injection Time to `Start`**
6. Save and reload any Torn page

### Tampermonkey / Greasemonkey
1. Install the Tampermonkey or Greasemonkey browser extension
2. Create a new script and paste the contents of `torn-traveler-utility-bubble.user.js`
3. Save — the script will activate on all `torn.com` pages
4. Open the panel and enter your Torn API key (16 characters) in the key field

## UI Controls

- **Bubble (blue, airplane icon)** — tap to expand; drag to reposition
- **Refresh button** — manually refresh travel status
- **Collapse button** — collapses the panel back to the bubble
- **Fly buttons** — navigate to the travel agency page (user must confirm travel on the page)
- **Shop button** — navigate to the abroad shop page (user must buy manually)
- **Return button** — navigate to the travel agency to fly home (user must confirm)
- **Log** section — tap the header to expand; "Copy" copies all entries to clipboard

## Limitations

- Requires an API key for travel status (no status shown without one).
- Flight times shown are approximate — actual times depend on travel-related merits and perks.
- The script navigates to the travel agency page but cannot pre-select the destination — the user must choose the country on the page.
- Only three destinations are included (Mexico, Cayman, Canada). Other countries can be added by modifying the `COUNTRIES` array.
- The progress bar during flight uses 45 minutes as the maximum estimate, which may not be exact for all destinations.
