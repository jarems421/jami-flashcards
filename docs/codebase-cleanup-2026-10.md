# Codebase cleanup — October 2026

Run 6–7 October 2026. The first pass, on the `codebase-cleanup` branch, is in
main (the first half merged as `225771dd`). A second pass, on
`claude/awesome-wright-9p4vao` from main at `ecc82d18`, is described under
[Second pass](#second-pass--7-october). Baseline is `55d26a26`, the last main
commit before the campaign.

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
- **The demo claim.** The public demo was retired on 15 July 2026
  (`ca28fa91`), and nothing has issued a demo sign-in since. The account it
  used still holds its `demo` claim, though, and a browser signed in before
  then can keep refreshing tokens that carry it. Rules refuse that claim every
  write, but server routes write with the Admin SDK, past the rules. Account
  deletion now refuses it, and so do profile photos, the one Storage write
  without the guard and publicly readable. **`storage.rules` must be deployed**
  (`npm run firebase:rules:deploy`) for the second part to apply.
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
tutorial card covers the notebook's "Ask Jami" button. All 54 pass now; see
the second pass, below.

## Second pass — 7 October

### Screens that sat on the gate

| File | Before | After |
| --- | ---: | ---: |
| `app/dashboard/constellation/page.tsx` | 1,198 | 312 |
| `app/dashboard/folders/[folderId]/page.tsx` | 1,139 | 279 |
| `lib/ai/provider-router.ts` | 658 | 566 |

Both screens got characterization tests first, committed on their own and run
against the old screen as well as the new one.

- **Stars** became hooks for the skies, arranging, the touch lock, drawing
  lines, renaming, and starting and finishing a sky, plus five components.
  The React Compiler lint, analysing it for the first time, moved the
  background choice to `useSyncExternalStore` (it now follows a change made
  in another tab) and gave the rename field its own ref instead of one read
  during render.
- **The folder page**'s decks and sources were two copies of the same five
  operations; they are one shelf hook (`useFolderAssetShelf`) and one section,
  configured per kind. Fixed on the way: the Sources tab showed "No sources in
  this folder yet" under its own loading placeholders.

### Duplication

A clone scan (jscpd, 12 lines or more) put duplication at 0.11%. The copies
worth removing are gone:

- **The AI router** built each provider's request three times. One copy had
  drifted: streaming skipped `resolveProviderAllowlist`, so a model override
  would have been ignored there and an unapproved one not refused. No caller
  sends one today; every path shares the check now. Characterization tests for
  what each provider is sent, diagnostics and streaming came first.
- **Deck and notebook cards** shared 75 lines of press-and-hold for their
  phone actions: `useObjectCardActions`.
- **Source and video card imports** shared resuming, polling and the progress
  panels: `useCardImportJob` and `CardImportProgress`.
- **Thirteen API routes** each defined their own copy of `apiFailure`. Three
  local helpers stay, because they differ: one adds a `Retry-After` header and
  two send no error code. The Tutor route keeps its own too, since it is held
  back (see the end).

### Fixes

- **"Try again" on the error page did nothing.** It called `unstable_retry`,
  which Next does not pass; it is `retry`. There was also no
  `global-error.tsx`, so an error in the root layout fell through to Next's
  bare default page. The new one brings its own document and keeps to system
  colours, since the stylesheet may be what failed.
- **The walkthrough card covered the page.** Its `fixed` position sat on a
  Card, which is `relative` itself, and `relative` comes later in the
  stylesheet, so the card stayed in the page's flow. In a notebook it landed
  on the Ask Jami button its own last mission asks the student to press. It
  floats in the corner now.
- **"2 from From your Tutor chats".** The drafts queue joined each group's
  count to its title, and the title of drafts with no source already starts
  with "From".
- **A card's actions menu opened behind the search bar.** The `slide-up`
  entrance held its last frame (`both`), which left a transform on the card
  grid for good; a transform makes a stacking context, so a menu opened
  upward could not rise above the sticky bar. It now fills `backwards`: the
  same entrance, with nothing held afterwards.
- **The maths symbols palette was cut off.** Near the bottom of the window it
  opens upward, judged against the window alone; inside the Add cards panel,
  which clips its overflow, most of it was hidden. It now measures the room
  inside any clipping ancestor, with a test that fails on the old code.

### Dependencies

Production advisories went from 40 (2 critical, 22 high) to 29 (none
critical; the 13 high all come from workflow's exact pin of `devalue`):

- `next` 16.3.4 → 16.3.8: remote code execution in `next/og`.
- `nodemailer` 7 → 10: thirteen advisories, two of them denial of service in
  the parser that reads the address typed at sign-up. Only `createTransport`
  and `sendMail` are used, which the breaking changes do not touch. It ships
  its own types, so `@types/nodemailer` went.
- `sharp` 0.35.5, and the `@grpc/grpc-js` and `fast-uri` security pins raised
  to their patched releases.

Left as they are: `devalue`, pinned exactly by `@workflow/core` in every
release up to 5.1.0, in functions workflow does not call; `firebase-admin`'s
one `uuid` advisory, on an argument the Google libraries never pass and fixed
only in the next major; and `mammoth`'s and KaTeX's, in a command-line
dependency and in a trust option Jami keeps off.

### Demo mode

The four demo variables left `.env.example` and the README, and the Security
section above now describes the demo claim as it stands.

### Tests

The unit suite stands at 5,862 tests in 553 files, all passing. New in this
pass: characterization tests for Stars, the folder page and what the AI
router sends, and tests for the press-and-hold actions, the card import job,
the error pages, the drafts label and the palette's placement.

### Browser suite

The full suite was run again at the start of this pass: 47 of 54 passed. The
seven failures were specs behind the screens they check, and four real bugs
(the walkthrough card, the drafts label, the actions menu, the palette), all
fixed:

- The Tutor settings drawer is a page now (Personalise Jami); the spec opens
  it from Tutor and checks it at three widths.
- The symbols button is called "Maths symbols"; card search matches the start
  of a front; the drafts row reads "2 from your Tutor chats".
- Study modes: ending a session restored from an earlier spec left the
  builder on that spec's deck, so the walkthrough reopens its own link. Its
  deck's wrong answers were seeded on the cards, a field Learn never reads
  (see the end), so they are now seeded as the prepared study assets Jami
  writes. And it presses "Start now" on the preparing screen, as a student
  would, since the emulator has no AI provider.
- The revision plan seeded "today" from the calendar rather than the study
  day, which then ran 4pm to 4pm London time (4am to 4am since 7 October), so
  before 4pm its session landed on the wrong day; and it looked for "Today's
  plan" with a straight apostrophe.
- The card editor walkthrough measured the grid with the pointer still on a
  card, which lifts 2px on hover by design, and read that as the grid moving.

The last full run passed 53 of 54, in seven minutes; the one left was the
study modes walkthrough, fixed by seeding its prepared questions, and it now
passes run straight after the offline spec whose session used to leak into it.

## The owner's decisions — 8 October

- **The retired demo accounts are closed.** All four were disabled in Firebase
  Authentication and their refresh tokens revoked, so no session from before
  July can call anything.
- **Today no longer reads the legacy `masteryEvents` collection.** Production
  held one event, on a two-card account. Before the read went, the heaviest
  account (thousands of cards on many Topics, last studied in May) was checked:
  its Topics reach the Learning Engine through each card's own review history,
  not through those events, so nothing a student sees on Topics or Progress
  changes. The read, its device copy and the route that summed it are gone.
- **Marking-job checkpoints are cleared** once a mark is finished, in a step of
  its own after finalizing; a job that pauses, fails or is cancelled keeps its
  checkpoint for the retry.
- **A second model checks drawn paper figures** (`reviewPaperFigures`): one
  short paper-check pass a paper, whose faults buy one redraw and never
  refuse a paper. `PRACTICE_PAPER_FIGURE_REVIEW_ENABLED=false` turns it off.
- **Your mix-ups** on the deck page shows the diagram labels a student gives
  for each other, from `loadDiagramConfusionEvents` (see
  `docs/image-occlusion.md`).
- **A card's own study settings** are written by the card editor and the
  single-card creator (other right answers, wrong answers for multiple choice,
  words to blank, ways to ask it), and read through one normaliser on the
  server and in the browser, so both fingerprint a card alike. The deck page
  now edits cards through the same hook as the Cards page.
- **The notebook page and the memory map's engine were split**: 1,197 to 1,073
  and 1,189 to 1,004 lines. The Tutor route and drawer had already been split
  on 7 October.

## Left for the owner

- **The demo checks in the rules and routes** can go now the accounts are
  closed, with the two copies of the token check that read the demo claim in
  their own way (`authenticateAssistantWriter` for Tutor's memory and
  personalisation, and paper generation's `authenticate`).
- **`loadCoverageWithLazyBanks`** stays unwired, for Learning Engine Phase 3.
- **The notebook page is not React Compiler clean.** The compiler is not on in
  the build, but its lint rules are, and today something in the page's
  frame-measuring effects makes it skip the page. Moved out, it reads the
  whole page and reports thirteen hand-memoised callbacks it cannot keep
  stable through the controllers' return objects. Turning the compiler on, or
  moving those effects, means reworking how the controllers hand callbacks to
  one another first.
- About 800 exports are used only inside their own file. They are not dead
  code, and un-exporting them would touch hundreds of files for little gain.
