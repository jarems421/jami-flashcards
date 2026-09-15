---
name: jami-full-audit
description: Performs a comprehensive independent QA audit of the current Jami application using its current source code, automated tests and browser testing. Use for whole-app audits, regression sweeps and identifying broken or partially working Jami features.
---

# Jami Full Audit

Do not modify application code during this audit.

## Phase 1 — Understand current Jami

Read:

- `AGENTS.md`
- `docs/ui-design-system.md`
- `package.json`
- current app routes
- current Playwright tests
- current relevant Vitest tests
- `AI-MANUAL-TEST.md`

Do NOT use `README.md` as a representation of the current application.

Inspect the CURRENT code and build a feature inventory.

For every user-facing area determine:

- main route
- major user flows
- important state/persistence behaviour
- existing automated coverage
- obvious high-risk integrations

## Phase 2 — Automated baseline

Run the appropriate existing verification commands.

For a complete audit, use the repository's full verification path:

```bash
npm run verify:all
```

Record all failures.

Do not modify code to make failures pass.

If the complete suite cannot run, explain exactly why and continue with
whatever verification remains possible.

## Phase 3 — Browser audit

Start the application using the repository's intended local environment (e.g. `npm run dev`).

Systematically test user-facing Jami.

Prioritise complete USER FLOWS rather than isolated pages.

Examples include flows across:

- `folder` → `notebook/source/paper/deck` → `work/study` → `saved state` → `revisit`
- `deck/card creation` → `study` → `rating/review` → `progress/statistics/constellation`
- current Practice flows.

Determine the actual available flows from CURRENT CODE.

Test where relevant across viewports:

- Desktop: ~1440px
- Tablet: ~820px
- Phone: ~390px

Test:

- normal paths
- empty states
- loading states
- invalid inputs
- repeated actions
- quick navigation
- browser back/forward
- refresh and hard refresh
- persistence after navigation
- persistence after reload
- failure states
- long content
- long mathematics
- responsive behaviour
- keyboard/focus behaviour
- console errors
- failed network requests

## Phase 4 — High-risk Jami areas

Give additional attention to:

### Data integrity

- Notebook save/reload behaviour
- Ink/page persistence
- Fast page switching
- Navigation while saves are occurring
- Existing content after migrations
- Deck/card persistence

Any potential data-loss bug is CRITICAL.

### Cross-feature integration

Changes in one Jami system should correctly appear in related systems.

Test relationships between relevant current systems such as:

- folders
- notebooks
- sources/library
- decks/cards
- study
- goals
- progress
- stats
- constellation
- Practice

Only test features confirmed to exist in current code.

### Visual quality

Check against `docs/ui-design-system.md`.

Look for:

- broken layouts
- overlapping content
- bad mobile behaviour
- inconsistent components
- unreadable themes
- incorrect focus styles
- math overflow
- horizontal page scrolling
- loading flicker
- layout shifts
- poor empty/error states

### AI

Where safe and authorized:

- Verify AI feature UX and guardrails.
- Do not make large numbers of paid requests.
- Do not judge correctness from one arbitrary AI output.
- Test the deterministic UI behaviour around the AI feature separately.

### Authentication/security

- Check relevant auth flows and browser console security warnings.
- Do not weaken security configuration to make testing easier.

## Phase 5 — Manual-only boundaries

Explicitly mark something UNVERIFIABLE rather than pretending it was tested
when the environment cannot genuinely reproduce it.

Examples can include:

- Apple Pencil behaviour
- real iPad palm rejection
- production-only logs
- production notifications
- hardware-specific behaviour

## Final artifact

Produce a QA report with:

### Executive summary

Total:
- PASS
- FAIL
- PARTIAL
- UNVERIFIABLE

### Feature matrix

| Feature | Flow tested | Status | Viewport | Automated coverage | Notes |
|---|---|---|---|---|---|

### Bugs (ordered by severity)

- CRITICAL
- HIGH
- MEDIUM
- LOW

Each bug must contain reproduction steps and evidence.

### Gaps & Recommendations

- Untested / unverifiable areas
- Automated coverage gaps
- Recommended new regression tests

Do not fix anything.
