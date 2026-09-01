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
- A source can appear inside a folder and still appear globally in Sources.
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

### Sources

Sources is a focused reference workspace, not a file manager.

- Save useful study sources, pasted notes, manual notes, links, and file references.
- Make the selected source feel central: source list, source preview, source actions.
- Source actions should feed the Jami loop through explicit Tutor help, topics, Today, and Progress.
- Saving or uploading a source must never trigger AI work or draft creation automatically.
- Tutor may automatically rank relevant passages from up to fifteen sources in the current folder after the student submits a request. Keep the unobtrusive source opt-out on by default, and do not make students select pages for ordinary Tutor use. This may include bounded on-demand document extraction, image understanding, and public-link reading.
- On-demand source processing must not become always-on scanning, persistent OCR,
  automatic draft creation, ambient document understanding, or PDF mutation. Keep
  originals immutable; reuse the existing explicit source indexes, and render only
  the relevant pages when a visual or scanned document needs on-demand inspection.

### Stars and constellations

Stars are Jami's own thing. They drifted because nothing here described them, so
each surface invented its own.

**One star means earned.** Every star a student has earned is the four-point
`NorthernStar` (`components/ui/NorthernStar.tsx`) — in the reward overlay, in
the sky, in the walkthrough trail, in the nav entry, on the signed-out landing
page. Use `northernStarTransform` to place it; never draw another star shape
and never substitute an image. The sky drew a PNG for a long time, so a student
earned one star and found a different one when they went to look at it.

**One mark means Jami is offering to do something.** `JamiTutorIcon` — three
small four-point sparkles — wherever the app offers help: tutor, drafting a
card, generating a paper, reading a source. There is one of these, not one per
surface.

The two must stay apart, and they are close: both are four-point stars. What
separates them is composition, not geometry — an earned star is one tall
faceted star with a 1.37 vertical stretch, the AI mark is three small flat ones.
A six-point star was tried to separate them outright and read as an asterisk at
the sizes a sky is full of. If they ever need pulling further apart, move the AI
mark rather than the star.

**Every star is white.** They came in white, blue and gold, warming as goals
were completed, and the hue sat at the 24 per cent stop of the star's gradient
— so a gold star was gold through its core rather than white-hot with warm
light around it. Size is the only axis a star varies on now, and it grows with
the goal behind it.

**Light has no edge.** A star's own glow is a single `drop-shadow`, which
follows its silhouette and falls off on a Gaussian. Ambient radiance belongs to
the sky, as a wide wash on the container, not to each star. Never draw a shape
behind a star to represent its light: a circle behind a four-point star reads as
a disc, which is exactly what it is.

**The sky has a frame budget.** Up to forty stars are on the constellation page
and up to sixty behind every other page in the app. No star layer may carry
`mix-blend-mode` or `will-change`, animations are `opacity` only where they can
be, and anything that adds an element per star — sparkles — is rationed by size.
An earlier pass put three blended, promoted layers on every star and the page
was visibly laggy.

**One word per level.**

> a **goal** is a target you set → completing it earns a **star** → stars fill a
> named **constellation** → finished constellations are your **sky**

Say "goal", "star", "constellation" and "sky" for those four things and nothing
else. Not "quest star", not "reward star", not "goal reward".

**Stars come from goals.** Completing a goal earns one; finishing the
walkthrough earns one. Nothing else mints a star, and nothing else should start
to without a deliberate decision — a star that arrives easily stops meaning
anything.

**Finishing seals what is in a sky, not how it is arranged.** A finished
constellation takes no new stars — that is what finishing is for, and the next
one starts collecting them. Everything else about it stays editable: its name,
and where each star sits. The arrangement is personalisation, and a finished sky
is the one a student will actually keep looking at, so it is the last thing that
should be frozen. Do not gate rearranging, renaming or any other presentation
choice on `status === "active"`.

**Nothing promises a reward it cannot show.** A goal completed against a full
constellation mints no star, so do not tell a student one is waiting. Read what
exists rather than inferring it from something adjacent.

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
- `/dashboard/practice`
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
- Source file storage upload
- PDF editing or mutation (notebook ink overlays on immutable raster pages are allowed)
- topic-paper or short-paper experiences that duplicate ordinary Practice and Mark my work
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
