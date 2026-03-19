# Verification Checklist

Run this checklist before every commit. Every item must pass.

---

## 1. Syntax Validation [REQUIRED]

Run the bracket balance check on all modified scripts:

```bash
cd /mnt/c/Repos/Torn_Dark_tools && python3 -c "
import os, sys
scripts = [f for f in os.listdir('.') if f.endswith('.user.js')]
ok = True
for f in sorted(scripts):
    with open(f) as fh:
        s = fh.read()
    pairs = [('(', ')'), ('{', '}'), ('[', ']')]
    for o, c in pairs:
        if s.count(o) != s.count(c):
            print(f'[FAIL] {f}: {o} = {s.count(o)}, {c} = {s.count(c)}')
            ok = False
            break
    else:
        print(f'[PASS] {f}: balanced')
if not ok:
    sys.exit(1)
"
```

[FAIL] action: Fix bracket imbalance before proceeding.

---

## 2. Version Bump [REQUIRED for feature changes]

- [ ] `@version` in the userscript header is bumped appropriately
  - Patch (X.Y.Z+1): bug fixes
  - Minor (X.Y+1.0): new features, non-breaking changes
  - Major (X+1.0.0): breaking changes, major redesigns

---

## 3. Unique Identifiers [CHECK if adding new scripts]

- [ ] `BUBBLE_ID` is unique across all scripts
- [ ] `PANEL_ID` is unique across all scripts
- [ ] `SCRIPT_KEY` is unique across all scripts
- [ ] `zIndexBase` doesn't collide (allocated: 999960, 999970, 999980, 999990)

---

## 4. Security [REQUIRED]

- [ ] No `eval()` calls added
- [ ] No external server requests (only `api.torn.com` and `weav3r.dev` for bazaar data)
- [ ] API key is never logged or sent to external servers
- [ ] `escapeHtml()` used on all user-facing data from API or user input
- [ ] No hardcoded API keys or secrets

---

## 5. Performance [CHECK for rendering changes]

- [ ] Large lists are capped (e.g., `SECTION_MEMBER_CAP`) with "Show all" option
- [ ] No unbounded loops that could freeze PDA
- [ ] localStorage caches have size caps and TTL

---

## 6. State Management [CHECK for toggle/UI changes]

- [ ] Boolean toggles handle `undefined` initial state correctly
- [ ] Dependent states are reset when parent state changes
- [ ] State is persisted to localStorage where appropriate

---

## 7. Documentation [REQUIRED]

- [ ] Script's companion `.md` file updated (if behavior changed)
- [ ] `AGENTS.md` Per-Script Reference updated (if behavior changed)
- [ ] `AGENTS.md` file tree line count updated: `wc -l *.user.js`
- [ ] `urls` file updated (if script was added or renamed)

---

## 8. Git Hygiene [REQUIRED]

- [ ] `git diff` reviewed - no accidental deletions, no leftover debug code
- [ ] Commit message follows project style (see `git log --oneline -5`)
- [ ] LF line endings (not CRLF)

---

## Quick Copy-Paste Verification Block

Run this all at once:

```bash
cd /mnt/c/Repos/Torn_Dark_tools && echo "=== BRACKET BALANCE ===" && python3 -c "
import os
for f in sorted([f for f in os.listdir('.') if f.endswith('.user.js')]):
    with open(f) as fh: s = fh.read()
    for o,c in [('(',')'), ('{','}'), ('[',']')]:
        if s.count(o) != s.count(c):
            print(f'[FAIL] {f}: {o}={s.count(o)} {c}={s.count(c)}'); break
    else: print(f'[PASS] {f}')
" && echo "=== LINE COUNTS ===" && wc -l *.user.js && echo "=== GIT STATUS ===" && git status --short
```
