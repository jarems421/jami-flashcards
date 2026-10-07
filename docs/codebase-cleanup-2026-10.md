# Codebase cleanup — October 2026

Run 6–7 October 2026 on the `codebase-cleanup` branch. The first half was
merged into main as `225771dd`; the rest follows on the same branch. Baseline
is `55d26a26`, the last main commit before the campaign.

The brief was production-grade structure without changing what the app does:
break up the files nobody could review, remove code that no longer runs, and
fix what turned up on the way. Navigation, features and stored data are
unchanged.

## File sizes

Files over the 1,200-line gate went from **15 to 2**, and the two left are held
back on purpose (see the end).

| File | Before | After |
| --- | ---: | ---: |
| `app/dashboard/notebooks/[notebookId]/page.tsx` | 3,638 | 1,196 |
| `app/dashboard/study/page.tsx` | 2,430 | 686 |
| `components/practice/ExamScratchpad.tsx` | 2,117 | 443 |
| `components/workspace/NotebookInkEditor.tsx` | 1,737 | 315 |
| `components/practice/ExamSessionWorkspace.tsx` | 1,611 | 632 |
| `services/ai/practice-paper-marking.server.ts` | 1,436 | 1,107 |
| `lib/workspace/notebook-smooth-pen.ts` | 1,381 | 1,009 |
| `components/ai/memory-map/engine.ts` | 1,348 | 1,189 |
| `components/practice/PracticePaperCreator.tsx` | 1,322 | 452 |
| `services/practice/practice-paper-pdf.server.ts` | 1,312 | 677 |
| `lib/workspace/notebooks.ts` | 1,308 | 816 |
| `lib/study/image-occlusion.ts` | 1,239 | 927 |
| `lib/practice/practice-papers.ts` | 1,214 | 948 |
| `components/ai/JamiAssistantDrawer.tsx` | 1,823 | 1,823 (held) |
| `app/api/ai/assistant/route.ts` | 1,803 | 1,803 (held) |

`scripts/check-file-sizes.mjs` no longer carries an exception for any of the
files that were split. The two held back are listed at their current sizes, with
the reason: while they sat over the limit unlisted, the gate stopped CI before
its tests and build ran.

## How the screens were split

Every large screen became a composition root: it creates its controllers in
dependency order, routes input between them and lays out what they render.
The same rules applied throughout.

- **State and effects** move into hooks named for one concern
  (`useNotebookPageTurn`, `useStudyQuestionWait`, `useExamSheetDocument`,
  `usePracticePaperJob`, `useNotebookInkPointerInput`, …).
- **Pure rules** move to `lib/` with tests of their own: the study restore
  decision, the exam sheet's maths, what a practice paper request still needs,
  the notebook's save-result merges.
- **Multi-step I/O** moves to `services/`, each step taken back if a later one
  fails: `services/study/practice-paper-builder.ts` holds the paper builder's
  two upload-then-create flows.
- **Screens with no tests got them first.** Characterization tests were
  written against the past-paper session and the paper builder before either
  was touched, and committed separately so the history shows them passing on
  the old code.
- **Hooks never import from component files.** Helpers that were exported
  from components (`defaultPaperMaterial`, `wholeCourseSelection`) moved to
  `lib/`.

A useful side effect: the React Compiler lint silently skips components this
large. Once split, it analysed them and found real faults (refs read or
written during render, effects that set state, a callback that called
itself), which are fixed rather than suppressed.

## Bugs fixed on the way

Study
- Finishing a session a recommendation opened also recorded it as abandoned.
- A refresh during restore cancelled it for good, so a session in progress
  was not resumed and a Daily Review link never started one.
- The reset countdown re-rendered the whole page every 30 seconds.
- Space acted on the Learn home when no card was on screen.

Notebook
- Every save-indicator change re-rendered the ink layer, the paper and the
  PDF page beneath it; the live ink layer's memoisation never held.
- The finger-writing hint could stick on screen.
- Changing page or tool painted one frame with the old selection.

Exam working sheet and past-paper session
- Ink from a sheet being left could be credited to the next question.
- A slow first load could land after the student had moved to another session.

Practice paper builder
- An answer to Jami's question was wiped about once a second while typed:
  the progress poll ran for requests waiting on the student and reset it.
- The poll restarted on every read, so it ran every second instead of every
  2.5.
- Jami's question is derived from the request, so it reappears after
  switching to Upload and back, and goes when the request is cancelled.
- A folder still loading, or that failed to load, could show and send another
  folder's material.
- Supporting files were sent even after they stopped being offered.
- A file still being added when the student switched folders reset the folder
  they switched to once it finished: its material showed as loading and their
  choice of material was lost.

Removed outright: `updateNotebookPage`, a page write that bypassed the
revision check every real save uses.

## Security

- **One token check.** Twenty-two copies of "the caller's uid, or null" were
  spread across 28 routes; all now call `authenticateRequest`
  (`services/auth/authenticate-request.server.ts`). Responses are unchanged.
- **The shared demo account.** Rules refuse it every write, but server routes
  write with the Admin SDK, past the rules. Account deletion now refuses it
  (one visitor could otherwise delete it for everyone), and profile photos,
  the one Storage write without the guard and publicly readable, refuse it
  too. **`storage.rules` must be deployed** (`npm run firebase:rules:deploy`)
  for the second part to apply.
- **Errors shown to students.** Adding a Tutor illustration to a page, and
  Tutor's "could not read this source", passed raw storage and transaction
  errors (bucket names, paths) to the page. Only reasons worded for the student
  are shown now (`SourceReadError`); the rest is logged, and the logger records
  a wrapped error's cause without its message (three levels deep at most, so a
  cyclic chain cannot loop).

Reviewed and sound as they stand: ownership (every id route reads under
`users/{uid}`), the cron secret (constant-time, fails closed), the Stripe
webhook signature, the notebook PDF proxy's path checks, link fetching
(private addresses refused at every redirect), reviewer access (an environment
allowlist), and the response headers (enforced CSP, HSTS, frame denial).

## Dependencies

- Removed: `recharts` (38 transitive packages) and `@types/katex`.
- Declared at their locked versions, because the code imports them directly:
  `@mathjax/mathjax-newcm-font`, `@js-draw/math` and `vite`.

## Tests

5,785 → 5,804 unit tests, plus a rules test for the new Storage guard.

The browser suite had not given a result in CI for weeks: the job ran all 54
specs, which take over half an hour, under a 20-minute limit, so every run was
cancelled. CI now runs the smoke specs (`npm run test:e2e:smoke`, 22 tests,
under five minutes with the build), and all of them pass. Getting there meant:

- Four stale smoke tests brought up to date with the screens they check
  (the Cards upload panel, Progress without its charts, the offline notice,
  Today's recommendation link), and three in the past-paper walkthrough.
- Today's activity read now survives a missing index. It reads newest-first by
  document id, which production serves from a custom index; the emulator cannot
  run that query at all, so Today showed an error in every browser test. Where
  the index is missing it now reads the whole (small) history instead.

The full suite (`npm run test:e2e`) was run once here: 43 of 54 pass. All 11
failures fail identically on the pre-campaign commit, so none comes from this
campaign. They are walkthrough, visual and screenshot specs whose screens have
moved on, and one real overlap: on the release walkthrough the floating
tutorial card covers the notebook's "Ask Jami" button.

## Left for the owner

- **The Tutor route and drawer** (`app/api/ai/assistant/route.ts`,
  `components/ai/JamiAssistantDrawer.tsx`) are the two files still over the
  gate. The unmerged branches `tutor-learning-engine` and
  `tutor-app-knowledge` both edit them; splitting them first would make those
  merges far harder.
- **What the demo account may do through server routes.** These accept it
  today, though the rules refuse it the same writes from the client: paper
  generation, paper marking and re-marking, paper deletion and paper actions,
  video-card jobs (create, approve, edit, delete), source indexing, card
  autocomplete and source drafts, billing checkout and portal. Switching them
  to `authenticateWriteRequest` is a one-line change each, but it changes what
  a demo visitor can try, so it is a product decision.
- **Four functions that look planned rather than abandoned**, kept unwired:
  `reviewDrawnFigure`, `cleanPracticePaperMarkingJobArtifacts` (marking-job
  checkpoints are never deleted), `loadCoverageWithLazyBanks` and
  `loadDiagramConfusionEvents`.
- **Today still reads the legacy `masteryEvents` collection** on every load,
  though nothing writes to it any more; dropping the read is a data decision.
- **The 11 failing walkthrough, visual and screenshot specs** listed in the
  test notes above need their selectors brought up to date by someone who
  knows how those screens are meant to read now; they are review aids rather
  than gates. The tutorial card covering "Ask Jami" is worth a look on its own.
- About 800 exports are used only inside their own file. They are not dead
  code, and un-exporting them would touch hundreds of files for little gain.
