# Syntax Validation

## The ONLY Correct Method

There is exactly ONE way to validate `.user.js` syntax in this environment: the Python3 bracket balance check. No other tool is available.

## Command: Check All Scripts

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
print('All scripts balanced.' if ok else 'ERRORS FOUND.')
"
```

## Command: Check Single Script

```bash
cd /mnt/c/Repos/Torn_Dark_tools && python3 -c "
with open('SCRIPT_NAME_HERE.user.js') as f:
    s = f.read()
for o, c in [('(', ')'), ('{', '}'), ('[', ']')]:
    print(f'{o}: {s.count(o)}  {c}: {s.count(c)}  {\"OK\" if s.count(o) == s.count(c) else \"MISMATCH\"}')"
```

Replace `SCRIPT_NAME_HERE` with the actual filename.

## What This Check Does

- Counts every `{`, `}`, `(`, `)`, `[`, `]` in the file
- Reports PASS if each pair balances, FAIL if any pair doesn't
- Does NOT parse JS syntax or handle strings/comments (brackets inside strings count too)
- This is a ROUGH check, not a full parser - but it catches the most common errors (missing closing brace, extra parenthesis, etc.)

## What This Check Does NOT Do

| Not Detected | Example | How to Catch It |
|---|---|---|
| Syntax errors inside expressions | `const x = ;` | Manual code review |
| Missing semicolons | `const x = 1 const y = 2` | Manual code review (but JS is semicolon-optional) |
| Undefined variables | `console.log(nonExistent)` | Manual testing in PDA/Tampermonkey |
| Logic errors | Wrong if-condition | Manual testing |
| Template literal issues | Unescaped backtick in template | Manual code review |
| Bracket inside string | `"text with { brace"` skews count | Very rare in this codebase; ignore unless balance fails suspiciously |

## When Bracket Balance Fails

If the check reports a mismatch:

1. **Check git diff** - Look at what you just changed. The imbalance is almost certainly in your recent edits.
2. **Count brackets in the changed function** - Narrow the search to the function you edited.
3. **Check template literals** - Template literals with `${}` inside HTML strings are the most common source of bracket mismatches.
4. **Look for commented-out code** - Commented `//` or `/* */` blocks with unmatched brackets will skew the count.

## Do NOT Try These Instead

- `node -c filename.js` - `node` is NOT installed
- `npx eslint filename.js` - `npx` is NOT installed
- `jshint filename.js` - `jshint` is NOT installed
- `deno check filename.js` - `deno` is NOT installed
- Writing a temp `.mjs` and importing it - No JS runtime available
