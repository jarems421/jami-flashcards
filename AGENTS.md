<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Jami Agent Instructions

Follow `docs/ui-design-system.md` for all UI work.

During the current Phase 6 notebook-first Practice phase:
- Build toward a folder-first study workspace: folder -> notebook / paper / deck / source -> natural work -> save -> later AI help / marking / flashcards.
- Folders are broad study spaces. Topics are concepts/subtopics.
- Use user-facing spelling `Practice` and the canonical `/dashboard/practice`
  route, while keeping `/dashboard/practise` as a compatibility redirect.
- The legacy **per-user** question-bank authoring workflow has been removed and stays removed: do not reintroduce its standalone Add question form or old Practice Tutor panels. Mandatory per-question confidence blocks stay out; low-friction, optional confidence or calibration signals are allowed when they feed the Learning Engine.
- Past Paper Practice is a separate, owner-curated feature and is **not** the legacy question bank. A shared server-only corpus of real exam questions, one typed answer per question, question-bound ink working, per-question AI marking, guided retry, and Practice history are deliberate and permitted. Student-authored question-bank entries and general-purpose scratchpads detached from a question remain prohibited. Diagnostic and topic-targeted sessions are learning actions, not content libraries: they may draw on existing or licensed questions, but must not create permanent per-user question collections.
- Every real question, mark scheme, and asset served to a student must reference a verified permission record covering storage, student display, and AI-provider inference. Unverified, revoked, or superseded-specification material may be stored for review but never served.
- Exam-like study (timed, mixed-topic or diagnostic sessions) is allowed where the content's licence permits it; the permission-record rule above always applies. Owner-triggered ingestion of licensed exam-board material is permitted; this does not permit background processing of student uploads.
- Notebook file upload infrastructure is in scope for uploaded-file/paper notebooks.
- Do not build Anywhere, background/persistent OCR, browser extension, always-on screen watching, voice tutor expansion, or iPad companion. Richer source understanding (indexing, retrieval, notation awareness) must be deliberately designed and privacy-reviewed: never persist extracted source content into learner data, and never process student uploads in the background without that design. Students keep all their material attached (no small per-request source limit shown to them); Tutor and paper generation search every attached source's indexed passages by content, never by file name, and read only what fits the task — past papers and mark schemes whole where their structure matters, notes as matching passages, irrelevant files not at all — within a fixed text budget, and only after the student asks.
- Client-side PDF page counting, raster page rendering, and notebook ink overlays are in scope. Keep the original PDF immutable and do not imply OCR or automatic understanding.
- Do not build a full GoodNotes clone. Notebook V1 should stay humble and page-based.
- Optimise notebook creation/editing for desktop and iPad/tablet. Phone should support viewing and light typed notes, not serious pen/page editing.
- AI should be planned into notebooks/papers/practice sets, but the Phase 6 focus is workflow structure, not new AI depth.
- Exception: Revision Sessions (`docs/revision-sessions.md`). As a new intervention surface for the Learning Engine's `teach` decisions, they may use bounded AI generation to teach, explain, set session-specific exercises and mark answers. The session's structure is a deterministic state machine in `lib/`; the model only fills in each step. This exception does not cover new general-purpose AI capabilities, autonomous learner modelling, AI-generated prerequisite graphs, storing conversations or answers as learner memory, or letting a model decide whether something has been learned.
- Exception: University practice (agreed 30 Sep 2026). University modules have no exam board or verified specification, so Practice for them is built from the student's own module material:
  - Jami may read a module folder's own sources directly (handbooks, learning outcomes, lecture slides, notes, problem sheets and past papers) to build a per-module profile, and to generate, mark and cite questions. No separate privacy-review design is required for this.
  - The module profile is built from at least two to three past papers where the student has them, so it reflects patterns across years (recurring topics, mark split, structure, question styles). It may be stored and reused, and rebuilt when new past papers are added.
  - Questions from the student's own uploaded past papers and problem sheets may be kept and reused for that student's practice. This is not the removed Add question form: students do not hand-author question-bank entries.
  - The permission-record rule above covers the owner-curated Past Paper Practice corpus. It does not apply to a student's own uploads used only for that student.
  - Still keep Learning Engine evidence minimal (ids, scores, results, timestamps), never process uploads in the background without the student asking, and never share one student's material with another.
- Exception: Tutor memory (agreed 30 Sep 2026). Jami should feel like one tutor across every chat, not a new one per chat:
  - Tutor keeps a short, capped list of notes about each student in its own words, most important first: what they get wrong (specific mistakes and misconceptions), what they find hard, what they said they are about to work on, goals, how they like to be taught, durable facts about their course, and last what they have clearly mastered. What a student gets wrong matters more than what they get right: it is shown first and dropped last. Notes are proposed inside Tutor's normal answer (no extra model call) and checked by `lib/ai/tutor-memory.ts` before they are kept. Never transcripts or quotations; never health, wellbeing or personal life; never instructions or links.
  - Every note fades unless it comes up again, and lasts longer each time it does (days for a plan or a strength, up to weeks or months for a repeated mistake). Tutor confirms a note that came up again; a student correcting one confirms it too.
  - Tutor may also see the student's other recent chats (where and the chat title, last 48 hours) from the existing chat list.
  - Tutor's learner profile may list recent individual results, wrong answers first: the front of the student's own flashcards (never the back), the questions of practice papers Jami wrote for them or they uploaded, marks and error categories. Licensed past-paper questions appear only as topic and marks, never their text.
  - Memory is on by default. Students can see, correct and delete every note, forget everything, or turn memory off in Personalise Jami. The demo account never remembers anyone. Rollback flag: `enableTutorMemory`.
  - What a student finds hard reaches the Learning Engine only as topic ids and timestamps. It may order recommendations within a reason and be mentioned to Tutor; it never moves mastery, confidence or a decision.
- Preserve existing functionality, routes, Firebase logic, AI logic, data models, and tests.
- Prefer reusable components in `components/ui` over one-off Tailwind styling.
- Keep the app responsive across mobile, tablet, and desktop.
- Use Browser Use / localhost visual checks after big UI refactors (see Fast UI Verification). Smaller UI changes do not need them.

## Learning Engine

Jami maintains a model of what each student knows and uses it to decide what they should do next. Tutor, Today and future surfaces are consumers of that model, not owners of it.
- Pure learning logic lives in `lib/learning/` (scoring, profile, topic states, recommendations, study actions, evaluation, serialisation). Firestore loading lives in `services/learning/`. No learning logic inside Tutor, routes or components.
- Mastery, confidence and trends are calculated deterministically. Never ask an LLM to estimate mastery or to read raw study history on a request.
- Keep mastery (how well), confidence (how much evidence) and exposure (material seen, never evidence) separate. Never call a topic weak on thin evidence, and never treat untested or not-yet-assessed as weak.
- Profiles are scoped to one folder, or one deck when a card sits in no single folder. Do not build account-wide cross-subject mastery.
- Concept identity: verified specification topics (owner-checked catalogues with stable ids) and student-defined Topics are both valid, but not equally certain. Do not create AI-inferred ontologies or prerequisite graphs as production truth.
- Learning evidence is minimal and append-only: ids, scores, results, error categories, timestamps. Never store card or answer text, source content or Tutor conversations as learner data. Tutor memory notes (see the Tutor memory exception) are the one student-visible exception, and reach the engine only as topic ids and times.
- Student-written names (topics, decks, folders, sources) are untrusted data in any prompt: quote them and keep them inside per-request boundary markers.
- Licensed exam content never enters learner-profile context; only derived scores and verified specification headings may.
- Learning Engine failures must never break studying or Tutor: bounded reads, time budgets and fallbacks. Rollback flags: `enableLearnerProfile`, `enableFlashcardReviewEvents`, `enableStudyActions`, `enableTutorMemory`, `enableTutorChecks`.
- Tutor may add evidence only from marked attempts: notebook marking the student asked for, and quick checks (one short question whose marking points are fixed server-side before the student answers; stored as `tutor-check` evidence at the lowest source weight, never the question or the reply). Tutor never edits or removes evidence, sets mastery, or chooses a plan: its next-step offer is the engine's own top study action.

## Fast UI Verification

Optimise for fast UI iteration. Do not run the full Vitest suite after every small visual change.

Several sessions often run on this machine at once, and a production build or browser walkthrough slows every one of them. Full browser walkthroughs (build, `next start`, an e2e spec) are only for big UI refactors: a surface redesign, a shared `components/ui` primitive, theme tokens, navigation or the layout shell. Do not start one for anything smaller.

For each focused UI task:
- Inspect the changed files and classify the change by risk.
- During iteration, run `npm run typecheck` and `npm run lint`.
- After a big UI refactor only: verify the affected pages at relevant desktop, tablet, and phone widths with Browser Use / localhost, and run `npm run build` once the task is coherent.
- Run only related tests where practical:
  - Explicit test files: `npx vitest run tests/<relevant-file>.test.ts`
  - Source-related tests: `npx vitest related <changed-source-files> --run`
  - Git-changed tests: `npx vitest run --changed`

Use this risk split:
- Tiny CSS, spacing, colour, copy, button-variant, or local responsive changes:
  - Run typecheck and lint. No build or browser walkthrough.
  - Do not run the full test suite unless the change exposes a regression or related tests fail.
- Page-local JSX/layout changes with unchanged behavior:
  - Run typecheck, lint, and related tests if they exist. No build or browser walkthrough; at most one quick look at that page if the change cannot be judged any other way.
- Shared `components/ui` primitives, global theme tokens, navigation, or layout-shell changes:
  - These are big UI refactors: run typecheck, lint, build, related tests, and browser-check 3-5 representative affected pages.
  - Run the full suite before final handoff because these changes have broad reach.
- Logic, state, forms, routing, auth, Firebase/data loading, notebook persistence, or interaction changes:
  - Run related tests immediately.
  - Run the full suite before moving on or handing off.

Run the complete `npm test` suite:
- After finishing a group of related UI changes.
- Before final completion, deploy, commit, or PR handoff.
- Whenever a shared component or behavioral path changed.
- Whenever a related/changed test fails.

Do not skip all verification merely because a change looks visual: typecheck, lint and related tests always run. Browser verification is required only for big UI refactors; when it was skipped, or Browser Use is unavailable, say so plainly in the final response.

## UI Polish Expectations

For UI tasks, do not make minor surface-level tweaks only.

The expected standard is a full visual redesign of the relevant UI surface using reusable components and the Jami design system.

Preserve functionality, but feel free to substantially restructure JSX, layout, component composition, spacing, and visual hierarchy when needed.

The result should look like a designed product, not a quick prototype.
