---
name: jami-architecture
description: Jami's mandatory architecture and coding conventions. Use automatically whenever implementing, refactoring, reviewing, debugging, or planning changes in the Jami codebase.
---

# Jami Architecture

Follow these rules for every Jami task. `AGENTS.md` holds the product rules and
verification steps; `docs/architecture.md` holds the full boundary map.

## Dependency direction

```text
app (pages, Route Handlers) -> components -> hooks -> services -> lib
```

- `lib/` is pure domain logic: models, parsing, calculations, validation. It
  must not import `services` or `components` (ESLint enforces this).
- `services/` owns Firebase and all other external I/O, and may use `lib`.
- `app/dashboard`, `components` and `hooks` must not import the Firestore or
  Storage clients; they call domain services (ESLint enforces this).
- `workflows/` holds durable Vercel Workflow jobs; keep each step idempotent.
- Only `lib/ai/gemini.ts` imports the provider SDK.
- Server code (`app/api`, `workflows`, `*.server.ts`) logs through
  `createLogger`, never `console`.
- Learning logic lives in `lib/learning/` and its loading in
  `services/learning/`, never in Tutor, routes or components.
- Do not introduce circular dependencies.

## Implementation rules

1. Inspect the existing implementation before creating new code.
2. Reuse existing components (`components/ui`), hooks, utilities, services, and design tokens.
3. Keep business logic out of React components when practical.
4. Do not use `any`, `@ts-ignore`, or unsafe casts to hide errors.
5. Do not add placeholder implementations or TODO-only fixes.
6. Preserve compatibility with existing stored user data.
7. Avoid unrelated refactors.
8. Remove obsolete code introduced or replaced by the change.
9. Preserve desktop, mobile, touch, and iPad behaviour.
10. Never expose Firebase secrets or weaken security rules for convenience.
11. Keep every source file under the 1,200-line gate (`npm run check:sizes`); split before adding to a file near it.
12. If the change makes a doc in `README.md`, `docs/` or `public/llms.txt` wrong, fix it in the same change.

Before completing work, check that the change respects these boundaries.
