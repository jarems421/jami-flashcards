# Jami UI Design System

## Product Feel

Jami should feel calm, modern, study-focused, and slightly cosmic. It should look polished but not childish. The product should feel like one coherent learning loop:

**Learn -> Practice -> Tutor -> Flashcard Drafts -> Progress**

The UI should make studying feel steady and focused, not like managing a cluttered productivity suite.

Phase 6 shifts the product metaphor toward a folder-first notebook workspace:

**Folder -> notebook / paper / deck / source -> work naturally -> save -> later AI help / marking / flashcards**

Folders are broad study spaces such as Biology, History, Spanish, or Computer Science. Topics are smaller concepts such as enzymes, essay evidence, verb endings, or algorithms. Decks and sources should still be globally accessible, but they should also feel at home inside relevant folders.

## UI Redesign Standard

This UI phase is not for tiny cosmetic tweaks.

The goal is a full visual redesign of the current MVP surfaces so Jami feels like a polished, refreshing, Figma-quality learning product rather than a functional prototype.

The redesign should:
- rethink layout, spacing, hierarchy, cards, page structure, and visual rhythm;
- create a distinctive Jami identity;
- feel calm, modern, study-focused, and slightly cosmic;
- avoid generic SaaS/dashboard slop;
- avoid cramped forms, plain boxes, and inconsistent Tailwind one-offs;
- make Learn, Practice, Tutor, and Progress feel like one coherent product.

This is a UI-layer rewrite only.

Do not rewrite:
- Firebase logic
- AI logic
- routes
- data models
- tests
- study scheduling
- practice/tutor/mastery behaviour

## Visual Principles

- Use clean layouts with clear hierarchy.
- Prefer spacious cards and panels over dense form dumps.
- Use rounded corners consistently.
- Use soft shadows and restrained depth.
- Use subtle gradients or glass effects only where they clarify hierarchy or reinforce the Jami atmosphere.
- Avoid cluttered dashboards.
- Avoid random colors and one-off palettes.
- Avoid excessive animation.
- Keep text readable and actions obvious.
- Keep mobile, tablet, and desktop layouts stable and usable.

## Core Surfaces

### Learn

Learn is the stable flashcard surface. It should feel familiar, reliable, and focused on the study flow.

- Do not disrupt existing flashcard behavior.
- Keep Daily Review, Focused Review, Simple Study, decks, cards, goals, stars, and offline behavior intact.
- Polish visual hierarchy gradually rather than changing the learning mechanics.

### Practice

Use user-facing spelling **Practice**. Keep old route names only for compatibility.

Practice should become folder-first and notebook-led rather than question-bank-first.

- Avoid making it feel like an admin form.
- Make notebook pages the current working surface and the center of the session.
- Do not force students to enter an expected answer or solution notes before they can work.
- Let expected answers, solution notes, and mark schemes stay optional metadata for imported, AI-generated, or reviewed questions.
- Do not show the old question bank, standalone Add question form, confidence block, old attempt form, or old Practice Tutor panel in the main Practice UI.
- Make "start", "continue", and "review" states clear through folders, notebooks, pages, drafts, and card review.
- Practice sets, paper-style work, AI-created drills, and blank working books should be presented as notebook templates rather than separate main products.

### Folders

Folders are broad study spaces.

- A folder can contain notebooks, decks, sources, and recent work.
- A deck can appear inside a folder and still appear globally in Decks.
- A source can appear inside a folder and still appear globally in Library.
- Cards should inherit folder context through decks rather than carrying folder links directly in V1.
- Folder pages should feel like calm workspaces, not analytics dashboards.
- Folder and notebook browsing should feel like a clean object browser, not a dashboard.
- Folder cards should show only the folder object and folder name. Do not show counts, stats, descriptions, or topic chips on the folder face.
- Inside a folder, use tabs or segmented navigation for Notebooks, Decks, and Sources instead of stacking every asset on one long page.
- Decks and Sources tabs should show only assets already in that folder. Add existing assets through a picker/drawer; use `Add to folder` and `Remove from folder`, not database-style `Link/Unlink` copy.
- Empty folders should clearly explain the next action with short copy only.

### Notebooks

Notebooks are the main working surface for serious problem solving.

- Optimise full notebook creation/editing for desktop and iPad/tablet.
- Phone should stay usable for viewing notebook pages and adding light typed notes.
- Do not squeeze page lists, canvas tools, Tutor, and full working controls onto phone screens.
- On phone-sized screens, show honest copy: "Notebook editing works best on iPad or desktop."
- Do not hard-block phone users unless necessary; let them view pages and optionally continue anyway.
- Keep mobile excellence focused on Today, Learn/flashcards, Progress, decks, and light folder viewing.
- Full pen drawing, page creation, paper-style working, and later AI marking should feel designed for larger screens.

Notebooks are the future main answer surface.

- Use Notebook or Working Page, not Scratchpad, for persistent work.
- The editor should feel immersive: one active page, a compact icon-first toolbar, optional page/AI drawers, and minimal explanatory copy.
- Page colours are notebook defaults and should be white or black only. New pages inherit the notebook default.
- Text, pen, eraser, undo, clear, pages, settings, save, and AI controls should be icon buttons with accessible labels/tooltips, not word-heavy toolbar buttons.
- The page should be long and paper-like. Finger swipes navigate pages on touch devices while stylus/mouse input writes.
- Notebook object cards should show the notebook object, title, and at most one tiny metadata line. Keep custom cover colours/icons, but avoid bulky dashboard metadata.
- Do not imply OCR, handwriting recognition, PDF annotation, or AI screen watching.
- AI will later live as an on-demand drawer/dropdown inside notebooks, papers, and notebook-based question sets.

### Tutor

Tutor is contextual, not a generic chatbot.

- It should feel like a helper beside the work.
- Hint-first behavior should be visually emphasized.
- Full solution should feel deliberate and explicit.
- Tutor messages should be easy to scan.
- "Make flashcard draft" should feel like a study action, not content spam.
- Tutor UI should reinforce support without shame.

### Progress

Progress should feel constructive, not judgemental.

Use language like:
- Weak topics
- Weak cards
- Drafts waiting
- Continue notebook work
- Linked source
- Open folder

Progress MVP should stay focused on weak topics, weak/due cards by topic, notebook/folder activity, source links, and generated drafts. Do not turn it into an advanced analytics dashboard yet, and do not reintroduce legacy attempt analytics.

### Library

Library is a focused source workspace, not a file manager.

- Save useful study sources, pasted notes, manual notes, links, and file references.
- Make the selected source feel central: source list, source preview, source actions.
- Source actions should feed the Jami loop through explicit Tutor help, topics, Today, and Progress.
- Saving or uploading a source must never trigger AI work or draft creation automatically.
- Tutor may read up to five deliberately selected Library sources only after the student submits a request. This may include bounded on-demand document extraction, image understanding, and public-link reading.
- On-demand source processing must not become background scanning, persistent OCR/indexing, automatic draft creation, always-on document understanding, or PDF editing. Keep originals immutable and do not persist extracted source text.

## Component Rules

Prefer reusable shared components over page-specific styling.

Useful component patterns:
- `AppShell`
- `PageHeader`
- `SectionCard`
- `MetricCard`
- `NotebookCard`
- `TutorPanel`
- `TutorMessage`
- `EmptyState`
- `TopicChip`
- `FormSection`
- `ActionButton`

Use the existing `components/ui` layer as the base. Extend it when a pattern is reused across surfaces.

Do not create one-off Tailwind styling unless the design need is genuinely local.

## UI Polish Order

1. App shell / nav
2. Shared UI components
3. Practice
4. Tutor panel
5. Progress
6. Learn

Do not polish randomly. Work screen by screen and verify each pass visually.

## Browser QA

Use Browser Use on localhost for UI work when available.

Check:
- `/dashboard/study`
- `/dashboard/practise`
- `/dashboard/progress`
- `/dashboard/library`

Verify:
- desktop
- tablet
- mobile
- empty states
- loading states
- long text
- narrow screens

## Not In This Phase

Do not use or build:
- Figma
- Figma MCP
- Figma design-to-code
- Anywhere
- Background or persistent OCR
- Automatic or background PDF text extraction and semantic parsing
- Library file storage upload
- PDF editing or mutation (notebook ink overlays on immutable raster pages are allowed)
- full-paper mode
- automatic mark schemes
- browser extension
- always-on screen watching
- iPad or desktop companion
- advanced analytics

## Phase 4 Tutor Context

Tutor should feel present because Jami sends the current practice context only when the student asks.

Use wording like:
- Tutor uses your current question and working when you ask.
- Voice is push-to-talk only.
- Legacy Practice drawings stay local unless you ask Tutor and add a typed note.

Avoid wording like:
- AI is watching you work.
- Tutor can see everything on your screen.
- Handwriting is automatically read.
