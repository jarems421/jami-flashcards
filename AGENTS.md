<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Jami Agent Instructions

Follow `docs/ui-design-system.md` for all UI work.

During the current Phase 6 notebook-first Practice phase:
- Build toward a folder-first study workspace: folder -> notebook / paper / deck / source -> natural work -> save -> later AI help / marking / flashcards.
- Folders are broad study spaces. Topics are concepts/subtopics.
- Use user-facing spelling `Practice`, while keeping existing routes such as `/dashboard/practise` compatible until a safe alias exists.
- The legacy question-bank Practice workflow has been removed from the product surface. Do not reintroduce question bank, standalone Add question, answer/working attempt forms, confidence blocks, old Practice Tutor panels, or tiny scratchpad side features.
- Notebook file upload infrastructure is in scope for uploaded-file/paper notebooks.
- Do not build Anywhere, OCR, PDF text extraction, semantic PDF reading, full-paper mode, browser extension, always-on screen watching, voice tutor expansion, or iPad companion.
- Client-side PDF page counting, raster page rendering, and notebook ink overlays are in scope. Keep the original PDF immutable and do not imply OCR or automatic understanding.
- Do not build a full GoodNotes clone. Notebook V1 should stay humble and page-based.
- Optimise notebook creation/editing for desktop and iPad/tablet. Phone should support viewing and light typed notes, not serious pen/page editing.
- AI should be planned into notebooks/papers/practice sets, but the Phase 6 focus is workflow structure, not new AI depth.
- Preserve existing functionality, routes, Firebase logic, AI logic, data models, and tests.
- Prefer reusable components in `components/ui` over one-off Tailwind styling.
- Keep the app responsive across mobile, tablet, and desktop.
- Use Browser Use / localhost visual checks when changing UI.

## Fast UI Verification

Optimise for fast UI iteration. Do not run the full Vitest suite after every small visual change.

For each focused UI task:
- Inspect the changed files and classify the change by risk.
- During iteration, run `npm run typecheck` and `npm run lint`.
- Manually verify the affected page at relevant desktop, tablet, and phone widths with Browser Use / localhost.
- Run `npm run build` once the focused task is coherent, rather than after every intermediate edit.
- Run only related tests where practical:
  - Explicit test files: `npx vitest run tests/<relevant-file>.test.ts`
  - Source-related tests: `npx vitest related <changed-source-files> --run`
  - Git-changed tests: `npx vitest run --changed`

Use this risk split:
- Tiny CSS, spacing, colour, copy, button-variant, or local responsive changes:
  - Run typecheck, lint, one build for the completed task, and a browser visual check.
  - Do not run the full test suite unless the change exposes a regression or related tests fail.
- Page-local JSX/layout changes with unchanged behavior:
  - Run typecheck, lint, one build, related tests if they exist, and a browser check of that page.
- Shared `components/ui` primitives, global theme tokens, navigation, or layout-shell changes:
  - Run typecheck, lint, build, related tests, and browser-check 3-5 representative affected pages.
  - Run the full suite before final handoff because these changes have broad reach.
- Logic, state, forms, routing, auth, Firebase/data loading, notebook persistence, or interaction changes:
  - Run related tests immediately.
  - Run the full suite before moving on or handing off.

Run the complete `npm test` suite:
- After finishing a group of related UI changes.
- Before final completion, deploy, commit, or PR handoff.
- Whenever a shared component or behavioral path changed.
- Whenever a related/changed test fails.

Do not skip all verification merely because a change looks visual. Browser verification is required for UI work; if Browser Use is unavailable, state that clearly in the final response.

## UI Polish Expectations

For UI tasks, do not make minor surface-level tweaks only.

The expected standard is a full visual redesign of the relevant UI surface using reusable components and the Jami design system.

Preserve functionality, but feel free to substantially restructure JSX, layout, component composition, spacing, and visual hierarchy when needed.

The result should look like a designed product, not a quick prototype.
