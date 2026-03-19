# Verification Tests

## Structural Tests

### Test 1: Skill files exist

```bash
cd /mnt/c/Repos/Torn_Dark_tools/.devin/skills/torn-dev-testing && ls SKILL.md references/environment-and-tools.md references/syntax-validation.md references/testing-workflow.md references/common-mistakes.md references/verification-checklist.md tests/verify.md
```

**Expected:** All 7 files listed without errors.
**Failure action:** Recreate missing files.

### Test 2: SKILL.md has required sections

```bash
grep -c "name:\|description:\|allowed-tools:\|When to use\|Rules\|Core Operations" /mnt/c/Repos/Torn_Dark_tools/.devin/skills/torn-dev-testing/SKILL.md
```

**Expected:** 6 (all sections present).
**Failure action:** Add missing sections to SKILL.md.

---

## Content Tests

### Test 3: Syntax validation script works

```bash
cd /mnt/c/Repos/Torn_Dark_tools && python3 -c "
import os
for f in sorted([f for f in os.listdir('.') if f.endswith('.user.js')]):
    with open(f) as fh: s = fh.read()
    for o,c in [('(',')'), ('{','}'), ('[',']')]:
        if s.count(o) != s.count(c):
            print(f'[FAIL] {f}: {o}={s.count(o)} {c}={s.count(c)}'); break
    else: print(f'[PASS] {f}')
"
```

**Expected:** All scripts show `[PASS]`.
**Failure action:** Fix bracket imbalance in the failing script.

### Test 4: No node/npm/jest references in validation commands

```bash
grep -rn "node -c\|npm test\|npx\|jest\|mocha" /mnt/c/Repos/Torn_Dark_tools/.devin/skills/torn-dev-testing/references/syntax-validation.md | grep -v "NOT\|Do NOT\|not installed\|NOT INSTALLED"
```

**Expected:** No output (only negation references allowed).
**Failure action:** Remove any commands that reference unavailable tools.

### Test 5: Common mistakes file covers critical items

```bash
grep -c "\[CRITICAL\]" /mnt/c/Repos/Torn_Dark_tools/.devin/skills/torn-dev-testing/references/common-mistakes.md
```

**Expected:** At least 3 critical items documented.
**Failure action:** Document additional critical mistakes from session history.

---

## Functional Tests

### Test 6: Quick verification block runs successfully

```bash
cd /mnt/c/Repos/Torn_Dark_tools && python3 -c "
import os
for f in sorted([f for f in os.listdir('.') if f.endswith('.user.js')]):
    with open(f) as fh: s = fh.read()
    for o,c in [('(',')'), ('{','}'), ('[',']')]:
        if s.count(o) != s.count(c):
            print(f'[FAIL] {f}'); break
    else: print(f'[PASS] {f}')
" && wc -l /mnt/c/Repos/Torn_Dark_tools/*.user.js
```

**Expected:** All PASS, line counts printed.
**Failure action:** Fix failing scripts; update AGENTS.md line counts if they don't match.
