# Jami UI Design System

## Product Feel

Jami should feel calm, modern, study-focused, and slightly cosmic. It should look polished but not childish. The product should feel like one coherent learning loop:

**Learn -> Practise -> Tutor -> Flashcard Drafts -> Progress**

The UI should make studying feel steady and focused, not like managing a cluttered productivity suite.

Phase 5 shifts the product metaphor toward a folder-first notebook workspace:

**Folder -> notebook / paper / deck / source -> work naturally -> save -> later AI help / marking / flashcards**

Folders are broad study spaces such as Linear Algebra. Topics are smaller concepts such as eigenvalues or integration by parts. Decks and sources should still be globally accessible, but they should also feel at home inside relevant folders.

## UI Redesign Standard

This UI phase is not for tiny cosmetic tweaks.

The goal is a full visual redesign of the current MVP surfaces so Jami feels like a polished, refreshing, Figma-quality learning product rather than a functional prototype.

The redesign should:
- rethink layout, spacing, hierarchy, cards, page structure, and visual rhythm;
- create a distinctive Jami identity;
- feel calm, modern, study-focused, and slightly cosmic;
- avoid generic SaaS/dashboard slop;
- avoid cramped forms, plain boxes, and inconsistent Tailwind one-offs;
- make Learn, Practise, Tutor, and Progress feel like one coherent product.

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
- Make the current working surface feel like the center of the session.
- Do not force students to enter an expected answer or solution notes before they can work.
- Let expected answers, solution notes, and mark schemes stay optional metadata for imported, AI-generated, or reviewed questions.
- Keep topic chips, attempt state, confidence, mistake labels, and attempt history visually organized.
- Make "start", "continue", "self-mark", and "review" states clear.
- Long-term direction: folders, notebooks, practice sets, and paper-style work should replace endless stacked forms.

### Folders

Folders are broad study spaces.

- A folder can contain notebooks, decks, sources, practice sets, past paper shells, and recent work.
- A deck can appear inside a folder and still appear globally in Decks.
- A source can appear inside a folder and still appear globally in Library.
- Cards should inherit folder context through decks rather than carrying folder links directly in V1.
- Folder pages should feel like calm workspaces, not analytics dashboards.
- Empty folders should clearly explain what will come next: notebooks, decks, sources, and practice work.

### Notebooks

Notebooks are the future main answer surface.

- Use Notebook or Working Page, not Scratchpad, for persistent work.
- V1 should be humble: pages, typed content, a simple drawing canvas, save/reload, and page navigation.
- Do not imply OCR, handwriting recognition, PDF annotation, or AI screen watching.
- AI will later live as an on-demand drawer/dropdown inside notebooks, papers, and practice sets.

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
- Support level
- Independent accuracy
- Hint-to-correct rate
- Recent mistakes
- Weak topics

Progress MVP should stay focused on weak topics, weak/due cards by topic, practice accuracy, recent mistakes, and support level. Do not turn it into an advanced analytics dashboard yet.

### Library

Library is a focused source workspace, not a file manager.

- Save useful study sources, pasted notes, manual notes, links, and file references.
- Make the selected source feel central: source list, source preview, source actions.
- Source actions should feed the Jami loop: Tutor context, flashcard drafts, practice drafts, topics, Today, and Progress.
- Keep AI generation small and draft-only until the student approves it.
- File support in Phase 3 is metadata/reference only. Do not imply OCR, PDF reading, upload storage, or automatic parsing exists.

## Component Rules

Prefer reusable shared components over page-specific styling.

Useful component patterns:
- `AppShell`
- `PageHeader`
- `SectionCard`
- `MetricCard`
- `QuestionCard`
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
3. Practise
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
- OCR
- PDF parsing
- file storage upload
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
- Scratchpad drawings stay local unless you ask Tutor and add a typed note.

Avoid wording like:
- AI is watching you work.
- Tutor can see everything on your screen.
- Handwriting is automatically read.
