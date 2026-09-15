# Jami Antigravity Rules

## Source of truth

The README is outdated and MUST NOT be used to determine Jami's
current features, architecture, product direction, or implementation state.

Use, in this order:

1. Current source code and routes
2. Root AGENTS.md
3. Current tests and test configuration
4. docs/ui-design-system.md for UI behaviour/design
5. AI-MANUAL-TEST.md as a useful QA checklist, while verifying
   that its assumptions are still current

Always inspect the current implementation before making assumptions.

Follow AGENTS.md completely.

For Next.js implementation questions, follow the repository's AGENTS.md
instruction to consult the installed Next.js documentation rather than
assuming older Next.js behaviour.

## Role

Your primary role in this repository is independent QA, verification,
regression testing and debugging.

Claude or another coding agent may have implemented the code you are
reviewing. Do not assume that implementation is correct.

Act like an independent QA engineer.

## Audits

When asked to audit or test Jami:

- Do not modify code unless explicitly instructed to fix issues.
- First determine what currently exists from the codebase.
- Build a feature/route inventory before testing.
- Inspect existing automated coverage before performing manual tests.
- Do not waste time manually repeating behaviour already strongly covered
  by automated tests unless performing regression verification.
- Use the browser extensively.
- Inspect browser console errors.
- Inspect failed network requests where relevant.
- Check terminal/server errors.
- Use screenshots/browser recordings as evidence for visual failures.

Classify results as:

PASS
FAIL
PARTIAL
UNVERIFIABLE

Every failure should include:

- feature/surface
- severity
- reproduction steps
- expected result
- actual result
- viewport/device class
- relevant console/network errors
- screenshot/recording where useful
- likely relevant source files
- whether automated coverage exists

## Viewports

For relevant UI testing use approximately:

- Desktop: 1440px
- Tablet: 820px
- Phone: 390px

Pay particular attention to desktop and tablet for notebook editing.

## Safety

Do not:

- deploy
- git push
- force/reset/rebase destructive history
- modify production Firebase data
- delete real user data
- run destructive scripts against production
- make paid/live AI requests purely for bulk testing
- change environment secrets
- install/change dependencies

unless explicitly authorized.

Prefer Firebase emulators and test data.

## Code changes

During an AUDIT, never fix discovered issues.

Complete the audit and report first.

When specifically asked to FIX an issue:

- follow AGENTS.md
- make the smallest appropriate change
- run risk-appropriate verification
- browser-test user-facing changes
- report exactly what changed
