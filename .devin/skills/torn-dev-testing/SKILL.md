---
name: torn-dev-testing
description: Develop and test Torn City userscripts. Use before writing, modifying, or verifying any .user.js file in this repo.
allowed-tools:
  - read
  - exec
---

# Torn Dark Tools - Development & Testing

## When to use this skill

- Before writing or modifying any `.user.js` script in this repo
- Before running syntax checks or validation on scripts
- When debugging a script that isn't working in Torn PDA or Tampermonkey
- When about to commit changes - run the verification checklist
- When you catch yourself trying to use `node`, `npm`, `jest`, or any tool that isn't available

## Rules

1. **NO `node`, `npm`, `npx`, `jest`, `eslint`, `jshint` exist in this environment.** Do NOT attempt to use them. See `references/environment-and-tools.md`.
2. **Syntax validation uses `python3` ONLY.** The exact commands are in `references/syntax-validation.md`. Do NOT invent your own.
3. **There is NO build step, NO test runner, NO package.json.** These are standalone `.user.js` files. See `references/environment-and-tools.md`.
4. **Before every commit, run the verification checklist** in `references/verification-checklist.md`. No exceptions.
5. **Read `references/common-mistakes.md` before making changes** - it documents every mistake that has been repeated in past sessions.

## Core Operations

| Reference | Purpose |
|---|---|
| `references/environment-and-tools.md` | What tools exist, what does NOT exist, and what to use instead |
| `references/syntax-validation.md` | The ONLY correct way to validate script syntax |
| `references/testing-workflow.md` | How to test scripts in Torn PDA and Tampermonkey |
| `references/common-mistakes.md` | Mistakes that have been repeated across sessions - READ THIS FIRST |
| `references/verification-checklist.md` | Pre-commit checklist - run before every commit |
