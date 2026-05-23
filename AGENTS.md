<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Jami Agent Instructions

Follow `docs/ui-design-system.md` for all UI work.

During the UI polish phase:
- Do not add new product features.
- Do not build Today, Library, Anywhere, OCR, PDF parsing, full-paper mode, browser extension, voice, or iPad companion.
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
