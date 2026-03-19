# Environment & Tools

## What IS Available

| Tool | Path | Version | Use For |
|---|---|---|---|
| `python3` | `/usr/bin/python3` | 3.12.3 | Syntax validation (bracket balance), scripting, file processing |
| `git` | system | latest | Version control |
| `grep` / `ripgrep` | system | latest | Code search (prefer Devin's built-in grep tool) |
| `cat`, `wc`, `head`, `tail` | system | latest | File inspection |
| `curl` | system | latest | HTTP requests (testing API endpoints) |

## What is NOT Available - DO NOT ATTEMPT

| Tool | Status | Why | What to Use Instead |
|---|---|---|---|
| `node` / `nodejs` | [NOT INSTALLED] | WSL environment has no Node.js | `python3` for syntax validation |
| `npm` / `npx` | [NOT INSTALLED] | No Node.js = no npm | N/A - no package.json exists anyway |
| `jest` / `mocha` / `vitest` | [NOT INSTALLED] | No test runner exists | Manual testing in PDA/Tampermonkey |
| `eslint` / `jshint` | [NOT INSTALLED] | No JS linter installed | `python3` bracket balance check |
| `tsc` / `typescript` | [NOT INSTALLED] | Plain JS project, no TypeScript | N/A |
| `deno` / `bun` | [NOT INSTALLED] | Not in this environment | `python3` |

## Project Has NO Build System

This repo is **plain JavaScript with zero dependencies**:

- NO `package.json`
- NO `tsconfig.json`
- NO `.eslintrc` / `.prettierrc`
- NO `node_modules/`
- NO build step, bundler, or transpiler
- NO test framework or test files

Each `.user.js` file is a self-contained script that runs directly in a browser (Torn PDA WebView or Tampermonkey).

## What "Testing" Means in This Project

Since there is no test runner, "testing" means:

1. **Syntax validation** - Python-based bracket balance check (see `syntax-validation.md`)
2. **Manual testing** - Copy script into Torn PDA or Tampermonkey and verify it works (see `testing-workflow.md`)
3. **Code review** - Read the diff, check the verification checklist (see `verification-checklist.md`)
4. **Debug log inspection** - Every script has a built-in debug log panel; check it for errors

## Common Wrong Instincts

| Wrong Instinct | Why It's Wrong | Do This Instead |
|---|---|---|
| "Let me run `node -c` to check syntax" | `node` is not installed | Use the python3 bracket balance script |
| "Let me install eslint with npm" | `npm` is not installed; no package.json | Use the python3 bracket balance script |
| "Let me write a Jest test" | No test framework exists | Test manually in PDA/Tampermonkey |
| "Let me run `npm test`" | No package.json, no test script | There are no automated tests |
| "Let me check with `deno`" | `deno` is not installed | Use python3 |
| "Let me use `tsc --noEmit`" | Not a TypeScript project | Plain JS, no type checking available |

## If You Need a JS Runtime

If a task genuinely requires executing JavaScript (not just validating syntax), use one of these approaches:

1. **Python3 with basic string/math operations** - Most validation can be done in Python
2. **Suggest the user install Node.js** - But do NOT block on it; find a Python alternative
3. **Defer to manual testing** - Tell the user what to test in PDA/Tampermonkey
