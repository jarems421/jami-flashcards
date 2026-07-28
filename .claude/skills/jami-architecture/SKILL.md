---
name: jami-architecture
description: Jami's mandatory architecture and coding conventions. Use automatically whenever implementing, refactoring, reviewing, debugging, or planning changes in the Jami codebase.
---

# Jami Architecture

Follow these rules for every Jami task.

## Dependency direction

Maintain this general dependency flow:

app/pages → components → hooks/lib → services

- `lib/` contains pure domain logic and calculations.
- `services/` owns Firebase and external I/O.
- UI components must not directly perform database operations.
- Do not introduce circular dependencies.

## Implementation rules

1. Inspect the existing implementation before creating new code.
2. Reuse existing components, hooks, utilities, services, and design tokens.
3. Keep business logic out of React components when practical.
4. Do not use `any`, `@ts-ignore`, or unsafe casts to hide errors.
5. Do not add placeholder implementations or TODO-only fixes.
6. Preserve compatibility with existing stored user data.
7. Avoid unrelated refactors.
8. Remove obsolete code introduced or replaced by the change.
9. Preserve desktop, mobile, touch, and iPad behaviour.
10. Never expose Firebase secrets or weaken security rules for convenience.

Before completing work, check that the change respects these boundaries.
