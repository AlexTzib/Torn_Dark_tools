# Testing Workflow

## Overview

These scripts cannot be unit-tested with a test runner. They run inside a browser (Torn PDA WebView or Tampermonkey in Chrome/Firefox) and depend on the Torn City DOM and API. Testing is manual.

## Testing in Torn PDA (Primary Target)

### Setup

1. Open Torn PDA app
2. Go to Settings > Userscripts
3. Add script: paste full `.user.js` contents, OR use the raw GitHub URL from the `urls` file
4. Set match pattern: `https://www.torn.com/*`
5. **Set Injection Time to `Start`** - CRITICAL for scripts with fetch/XHR hooks
6. Save and reload any Torn page

### What to Verify

| Check | How |
|---|---|
| Bubble appears | Look for the colored circle (position may vary) |
| Bubble is draggable | Long-press and drag |
| Panel opens on tap | Tap the bubble |
| Panel is draggable | Drag the header area |
| Data loads | Panel shows real data, not "Unknown" or "0" everywhere |
| API key detected | Status should show "Active (pda)" or similar |
| Debug log is clean | Expand Debug Log section; check for unexpected errors |
| No freezing | Panel opens/closes smoothly; scrolling is responsive |
| Copy buttons work | Tap copy buttons; paste somewhere to verify |
| Links open correctly | Attack links / profile links should navigate properly |

### Debugging in PDA

- **Debug Log panel**: Every script has a collapsible debug log at the bottom. Expand it to see timestamped events.
- **"Copy Log" button**: Copies all log entries to clipboard for sharing.
- **PDA's WebView console**: Not directly accessible. Use `addLog()` calls in the script to surface information.
- **If script doesn't load**: Check injection time is set to `Start`. Check match pattern is `https://www.torn.com/*`.

## Testing in Tampermonkey (Desktop Browser)

### Setup

1. Install Tampermonkey extension (Chrome, Firefox, Edge)
2. Click Tampermonkey icon > Create a new script
3. Delete the template and paste the full `.user.js` contents
4. Save (Ctrl+S)
5. Navigate to `https://www.torn.com/`
6. Enter API key in the script's panel (PDA injection doesn't work here)

### What to Verify

Same as PDA, plus:
- Browser console (F12) shows no unhandled errors
- `###PDA-APIKEY###` is treated as "no key" (manual entry required)
- `PDA_httpGet` / `PDA_httpPost` are not available (scripts should fall back to regular `fetch`)

## Testing Specific Features

### API Key Priority System

| Test | Expected Result |
|---|---|
| In PDA with no manual key saved | Key source shows "pda" |
| In PDA with manual key saved | Key source shows "manual" (overrides PDA) |
| In Tampermonkey with manual key | Key source shows "manual" |
| In Tampermonkey with no key | Key source shows "Not available" until traffic is intercepted |
| Delete manual key, reload | Falls back to PDA key (in PDA) or intercepted key |

### Section Collapse/Expand (War Bubble)

| Test | Expected Result |
|---|---|
| Tap section header | Toggles between collapsed (arrow right) and expanded (arrow down) |
| First tap on fresh install | Should expand (default state is collapsed) |
| Collapse All button | All sections collapse; show-all state resets |
| Expand All button | All sections expand |
| Show all link (in large section) | Reveals remaining members beyond the 15-member cap |
| Collapse then re-expand | Show-all resets; section shows capped again |

### Network Interception (Strip Poker, Deal Finder)

| Test | Expected Result |
|---|---|
| Navigate to the relevant game page | Script detects data from XHR/fetch responses |
| Check debug log | Should show `[XHR]` or `[FETCH]` entries with parsed data |
| Reload page | Hooks re-install; data is captured again |

## What You CANNOT Test From This Terminal

- Actual DOM rendering (requires a browser)
- Torn PDA-specific behavior (requires the app)
- API responses with real data (requires a Torn account and API key)
- Touch/drag interactions (requires a touchscreen or mouse)
- Cross-script coexistence (requires multiple scripts loaded simultaneously)

These must be tested by the user manually. When making changes, clearly communicate to the user what they should test.

## Regression Testing Approach

Since there are no automated tests, prevent regressions by:

1. **Read the full function before editing** - Understand all branches, not just the one you're changing
2. **Check callers** - grep for the function name to find all call sites
3. **Test the bracket balance** after every edit (see `syntax-validation.md`)
4. **Review the git diff** before committing - look for accidental deletions
5. **Check the debug log output** - make sure `addLog()` calls still make sense
