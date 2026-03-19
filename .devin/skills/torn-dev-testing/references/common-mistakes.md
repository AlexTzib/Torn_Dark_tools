# Common Mistakes

Mistakes that have been made repeatedly across sessions. READ THIS before making any changes.

---

## [CRITICAL] Trying to Use Node.js / npm

**What happens:** Agent runs `node -c script.js` or `npm test` and gets `command not found`.
**Why it keeps happening:** Instinct to use Node.js for JavaScript validation.
**The rule:** Node.js, npm, npx, jest, eslint, jshint are NOT INSTALLED. See `environment-and-tools.md`.
**What to do instead:** Use the python3 bracket balance check from `syntax-validation.md`.

---

## [CRITICAL] Writing Unit Tests That Cannot Run

**What happens:** Agent writes Jest/Mocha test files, then can't execute them.
**Why it keeps happening:** Standard software engineering instinct to write tests first.
**The rule:** There is NO test runner. There is NO package.json. There is NO test infrastructure.
**What to do instead:** Test manually in PDA/Tampermonkey. Document what the user should verify.

---

## [CRITICAL] Boolean Toggle on Undefined State

**What happens:** Code like `STATE.collapsed[key] = !STATE.collapsed[key]` doesn't work when the key doesn't exist yet. `!undefined` evaluates to `true`, which may not be the intended default.
**Real example (v3.2.0 fix):** War Bubble section toggles didn't work on first click because `!undefined = true = still collapsed`.
**The rule:** Always check for `undefined` before toggling:
```javascript
const current = (STATE.collapsed[key] !== undefined) ? STATE.collapsed[key] : DEFAULT_VALUE;
STATE.collapsed[key] = !current;
```

---

## [WARN] Not Checking Bracket Balance After Edits

**What happens:** Edit introduces unbalanced brackets; discovered only after multiple more edits, making it hard to trace.
**The rule:** Run the bracket balance check after EVERY significant edit, not just before committing.
**Command:** See `syntax-validation.md`.

---

## [WARN] Rendering Too Many DOM Elements

**What happens:** Script renders 100+ members with 3 buttons each, causing Torn PDA to freeze.
**Real example (v3.2.0 fix):** War Bubble rendered all faction members in expanded sections.
**The rule:** Cap rendered items per section (e.g., `SECTION_MEMBER_CAP = 15`) with a "Show all" toggle. Always consider: what happens with 200+ items?

---

## [WARN] Assuming Torn API Response Structure

**What happens:** Code expects `data.bars.energy` but API returns `data.energy` at top level (V1), or expects `data.strength` but V2 returns `data.battlestats.strength.value`.
**The rule:** Always check `docs/torn-api-patterns.md` and the normalization tables in `AGENTS.md` before accessing API data. V1 and V2 have different nesting.

---

## [WARN] Using `eval()` or Inline onclick

**What happens:** `eval()` is blocked by Torn's Content Security Policy. Inline `onclick="..."` in HTML strings is fragile.
**The rule:**
- Never use `eval()`. PDA provides `PDA_evaluateJavascript()` as a workaround, but avoid needing it.
- Attach event handlers in JavaScript AFTER setting `innerHTML`, using `element.onclick = () => {}` or `addEventListener`.

---

## [WARN] PDA API Key Placeholder in Comparisons

**What happens:** Code compares `key === '###PDA-APIKEY###'` which fails after PDA replaces the string in the entire source.
**The rule:** PDA does a literal string replace on the ENTIRE script source. To detect if PDA injected a key:
```javascript
const PDA_INJECTED_KEY = '###PDA-APIKEY###';
if (PDA_INJECTED_KEY.length >= 16 && !PDA_INJECTED_KEY.includes('#')) {
    // PDA replaced it with a real key
}
```

---

## [WARN] Not Resetting Dependent State

**What happens:** Expanding a section shows all members, collapsing it doesn't reset the "show all" flag, so re-expanding still shows all members.
**Real example (v3.2.0):** Added `if (STATE.collapsed[key]) STATE.showAll[key] = false;` to reset on collapse.
**The rule:** When toggling a parent state (collapse/expand), reset any child states that depend on it.

---

## [INFO] Forgetting to Update Line Counts in AGENTS.md

**What happens:** AGENTS.md says "~1486 lines" but the file is now 1525 lines after edits.
**The rule:** After editing a script, update the line count in AGENTS.md's file tree section. Use `wc -l filename` to get the current count.

---

## [INFO] Not Updating Documentation Files

**What happens:** Script behavior changes but the `.md` doc and AGENTS.md still describe the old behavior.
**The rule:** When changing script functionality, update ALL THREE:
1. The script's companion `.md` file (e.g., `torn-war-bubble.md`)
2. The Per-Script Reference section in `AGENTS.md`
3. The file tree line count in `AGENTS.md`

---

## [CRITICAL] Using Plain fetch() for External APIs in PDA

**What happens:** `fetch('https://weav3r.dev/...')` fails with "Failed to fetch" inside Torn PDA's WebView, even though the server sends `Access-Control-Allow-Origin: *`.
**Why it keeps happening:** CORS headers suggest it should work, and it DOES work in Tampermonkey. But PDA's InAppWebView blocks external requests regardless.
**Real example (v2.4.0 fix):** Bazaar prices from TornW3B were always empty in PDA.
**The rule:** For any HTTP request to a domain OTHER than `api.torn.com`, use this pattern:
```javascript
if (typeof PDA_httpGet === 'function') {
    const r = await PDA_httpGet(url, {});
    return JSON.parse(r.responseText);
}
// Fallback to plain fetch (works in Tampermonkey)
const resp = await fetch(url);
```
`PDA_httpGet` uses Flutter's native HTTP client, completely bypassing the WebView.
**Note:** `PDA_httpGet` has a 2-second dedup per URL. Different URLs are fine.
**Note:** `api.torn.com` requests work with plain `fetch()` in PDA because the WebView is on `torn.com` (same-origin).

---

## [CRITICAL] addEventListener Inside renderPanel() (Event Listener Leak)

**What happens:** `warBody.addEventListener('click', handler)` inside `renderPanel()` adds a NEW listener on every render. After 10 poll cycles, 10 identical handlers fire on each click, causing cascading re-renders and eventual freeze.
**Why it keeps happening:** Natural instinct to put the handler near the HTML it operates on.
**Real example (v3.3.0 fix):** War Bubble accumulated N click listeners after N renders; each section toggle fired N re-renders.
**The rule:** `addEventListener()` must go in `createPanel()` (called once), NEVER in `renderPanel()` (called every poll).
- `element.onclick = fn` is safe inside `renderPanel()` — it overwrites the previous handler.
- `element.addEventListener('click', fn)` is NOT safe — it stacks.
- For dynamically rendered content, use event delegation: attach ONE listener to the stable parent (`#tpda-*-body`) and use `e.target.closest('.class')` to match.

---

## [WARN] tickTimers / setInterval Running When Panel is Hidden

**What happens:** `setInterval(tickTimers, 1000)` runs DOM queries every second even when the panel is collapsed (invisible). Wastes CPU and battery on mobile.
**Real example (v3.3.0 fix):** War Bubble timer tick ran continuously; fixed by starting interval in `expandPanelNearBubble()` and clearing in `collapseToBubble()`.
**The rule:** Any `setInterval` that touches the DOM must:
1. Check `STATE.ui.minimized` at the top of the callback
2. Be started when the panel opens and cleared when it closes
