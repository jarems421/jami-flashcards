# Jami Architecture Boundaries

This document describes the boundaries that should remain stable while Jami adds
new workflows. It is a map for implementation, not a proposal to change routes or
stored data.

## Dependency direction

```text
app routes and pages
        |
        v
feature components --------> components/ui
        |
        +-------------------> pure lib modules
        |
        v
domain services ------------> Firebase and server Route Handlers
```

- `app` owns routing and page-level orchestration. Pages may coordinate state and
  domain operations, but should not contain reusable rendering engines or direct
  Firestore and Storage queries.
- `components` owns reusable presentation and focused interaction surfaces.
  Feature components may call callbacks or hooks supplied by their page, but they
  should not know collection paths.
- `lib` owns models, parsing, calculations, validation, and browser-only utilities.
  New domain modules should remain pure. A few older auth and server-AI adapters
  still perform I/O from `lib`; they are migration candidates, not precedents.
- `services` owns external I/O: Firebase reads and writes, uploads, and calls to
  internal Route Handlers. Services preserve ownership checks and stored shapes.
- `components/ui` remains the shared visual language described by
  [`ui-design-system.md`](ui-design-system.md).

Dependencies should flow downward through this list. A service may use `lib`, but
`lib` must not import a service or a React component.

## Sources

Sources is a reference workspace. Its page should orchestrate selection, loading,
and mutations while focused components render the browser, selected-source view,
drawers, folder picker, tutor, and draft editors.

New AI work must enter through a typed service or server Route Handler. It must not
embed provider calls, Firebase queries, or prompt construction in the page. Source
content is processed only after an explicit user action; no background indexing or
persistent extracted-content store should be introduced.

## Notebook editor

The notebook route is the composition root for the editor. Keep these concerns
separate:

- fixed-page coordinates, zoom, pan, swipe, and toolbar calculations in pure
  `lib/workspace` modules;
- canvas/PDF rendering and focused controls in `components/workspace`;
- loading, autosave, conflict handling, and file operations in domain services;
- route-level state and lifecycle coordination in the notebook page.

The 900 x 1240 coordinate model, immutable uploaded files, existing page records,
and compatibility readers are invariants. Refactors must not rewrite saved ink or
silently migrate user data.

## Compatibility rules

- Preserve `/dashboard/practise` while `/dashboard/practice` remains its alias.
- Treat Firestore collection paths and stored fields as public persistence
  contracts. Remove a compatibility reader only after an explicit migration and
  production count check.
- Keep API routes through a deprecation window when an installed PWA or external
  caller could still use them.
- Prefer small extractions with characterization tests over full page rewrites.
- Do not combine structural cleanup with a visual or behavioral redesign.

## Completion gate

A structural change is ready when:

1. TypeScript and ESLint pass.
2. Pure extracted logic has focused tests.
3. Related workflows pass before the complete suite is run.
4. A production build succeeds.
5. A signed-in desktop and tablet browser smoke check shows no new console errors
   or interaction regression.
6. Any skipped migration, compatibility path, or manual check is recorded in the
   handoff.
