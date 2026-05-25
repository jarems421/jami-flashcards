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
- Do not build Anywhere, OCR, PDF parsing, PDF annotation, full-paper mode, browser extension, always-on screen watching, voice tutor expansion, or iPad companion.
- Do not build a full GoodNotes clone. Notebook V1 should stay humble and page-based.
- Optimise notebook creation/editing for desktop and iPad/tablet. Phone should support viewing and light typed notes, not serious pen/page editing.
- AI should be planned into notebooks/papers/practice sets, but the Phase 6 focus is workflow structure, not new AI depth.
- Preserve existing functionality, routes, Firebase logic, AI logic, data models, and tests.
- Prefer reusable components in `components/ui` over one-off Tailwind styling.
- Keep the app responsive across mobile, tablet, and desktop.
- Use Browser Use / localhost visual checks when changing UI.
- After meaningful UI changes, run:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run build`

## UI Polish Expectations

For UI tasks, do not make minor surface-level tweaks only.

The expected standard is a full visual redesign of the relevant UI surface using reusable components and the Jami design system.

Preserve functionality, but feel free to substantially restructure JSX, layout, component composition, spacing, and visual hierarchy when needed.

The result should look like a designed product, not a quick prototype.
