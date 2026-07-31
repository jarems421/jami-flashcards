# Jami cleanup plan

Continues the notebook decomposition track started in `da3d9c7` → `4fc3ebb`, merged
with a codebase-wide review. Written 2026-07-30.

## Status — Phases 0 to 3 complete

Fourteen gated commits. The notebook page went **4,525 → 3,189 lines**; the
Vitest suite went **704 → 809**; the browser suite went from one notebook spec
to five signed-in flows across notebook and study.

The plan existed to make the dual ink pipeline fixable. That shipped in
`f98c8f5` and was verified on an iPad on 2026-07-31: undo now steps whichever
of ink or text happened most recently, instead of draining all ink first.

| Phase | State |
|---|---|
| 0 — land in-flight work | done |
| 1 — low-coupling extractions | done |
| 2 — the coupled core | done (2.3b deliberately not extracted) |
| ★ ink pipeline fix | **done, iPad-verified** |
| 3 — JSX decomposition | done |
| 4 — offline e2e + component tests | **next** |
| 5 — shared list-workspace primitives | not started; slow and deliberate by request |

**Where the remaining lines are.** The page is now a composition root: seven
controllers, three extracted components, and the orchestration that coordinates
them. The original ~1,100-line target was a bad estimate — it counted the
`NotebookViewport` call and its render props as extractable JSX when they are
composition, and it assumed navigation orchestration would extract, which it
should not.

---

## Working method (unchanged)

Every numbered batch below is **one isolated commit**, fully verified before the next
begins, then pushed to `main`. Later refactors must not be able to hide an earlier
failure.

**Gate matrix per commit:**

- `npm run typecheck`
- `npm run lint`
- focused tests for the new seam (`npx vitest run tests/<file>`)
- `npm test` (full Vitest)
- `npm run test:rules`
- `npm run build`
- `npm run test:e2e` — all three signed-in Chromium flows (desktop / tablet / phone)
- invariant: no test asserts against a page **source string**

**Manual gate:** physical iPad + Apple Pencil smoke — rapid strokes, horizontal
strokes, immediate re-contact, undo, page switching, toolbar docking — required
before Phase 2 (any batch that touches hydration, save, or ink).

**Seam-width rule:** if a controller's options type exceeds ~10 fields, the seam is
in the wrong place. Compare `useNotebookToolbarDocking` (4 options, 1 ref — a real
module) against `useNotebookTextBlockController` (13 options, 2 refs, 8 callbacks —
a slice still wired back through thirteen wires). Batch 2.0 exists to stop the
riskiest extraction from becoming the widest one.

---

## Notebook page today

Seven controllers in `hooks/`: page state, loader, persistence, viewport, page
track, ink, text blocks, plus toolbar docking. Three components in
`components/workspace/`: drawing toolbar, pages drawer, text block layer.

**Total repo size grew, and that is correct.** The text block extraction alone
removed 384 lines from the page and added 1,098 across the hook and its test.
One unreadable file became many readable ones plus the tests that were
previously impossible to write.

---

## Phase 0 — land what is in flight

**Batch 0.1.** Commit and push the four uncommitted files
(`useNotebookTextBlockController.ts`, its test, the page diff, the e2e diff).
Already verified green; it should not sit uncommitted while new work starts.

---

## Phase 1 — low-coupling work (no persistence, no ink)

**Batch 1.2 — memoize the hot input path** — *folded into 1.1, 2.3, and 2.5.*

Lines 2581–3159 declare ~15 handlers as plain functions rather than `useCallback`,
recreated every render and passed into `NotebookViewport` and
`NotebookLivePageLayers`, neither memoized. This cannot be fixed as a standalone
batch: the handlers form a forward-reference chain spanning ~1,500 lines —

```
useNotebookTextBlockController (1345)
  → handleTouchPointerDown/Move/End (1784–1868)
      → handleStopPageSwipe (2895)
          → createBlankPageAtEnd (2659) → saveCurrentPage (2048) → persistence
```

Lines 1347 and 1356–1359 pass inline arrows purely to defer references that are in
the temporal dead zone at the call site — which also means the text block
controller's internal `useCallback`s are currently defeated and its memoization
does nothing. Fixing this in place needs either a ~1,100-line reorder or several
new forward-reference refs, i.e. the exact indirection Batch 2.0 removes.

Memoization is a **consequence** of the extractions, not a precursor. The pinch
handlers become stable in 1.1, the swipe handlers in 2.3, and Batch 2.5 then does
the short dispatcher/`React.memo` pass once it can actually take effect.

**Batch 1.1 — `useNotebookViewportController`** (lines 516–943, ~430 lines)

Pinch-zoom state, live pan transform writes, page-track offset, preview layer
visibility, track animation. Pure geometry, no Firestore coupling. The math is
already seamed via `lib/workspace/notebook-viewport.ts` and
`notebook-pinch-zoom.test.ts`; this extracts the React ownership around it. Retires
~10 refs including `pinchZoomRef`, `pagePanLiveRef`, `pageTrackAnimationFrameRef`.

**Batch 1.3 — study-loop e2e**

Independent of the notebook work and the largest gap in the safety net: the review
loop is the path where a break costs a user their review history, and it has zero
browser coverage. Sign in → due cards → grade → persist → reload → verify
scheduling, reusing the existing emulator seed harness. Also a precondition for
Batch 5.4.

---

## Phase 2 — the coupled core (iPad gate required first)

**Batch 2.0 — `NotebookPageState` + reducer** *(new; gates everything after it)* — **done**

Collapsed eight duplicated state/ref pairs (`selectedPage`, `textBlocks`,
`pageColor`, `pageStyle`, `saveStatus`, `tool`, `contentRevision`,
`hydratedPageId`) into `useNotebookPageState`, backed by a pure reducer in
`lib/workspace/notebook-page-state.ts`. Later controllers take `pageState`
instead of a ref-and-setter pair per field.

The duplication was real: `saveStatusRef.current = x` sat next to `setSaveStatus(x)`
in **seven** places, plus a resync at the ink flush. Writes now go through one
dispatch that moves the ref and the rendered state together.

Two things this surfaced:

- **Deferred rendering is load-bearing.** `markPageUnsaved` deliberately wrote the
  ref *without* re-rendering so a burst of strokes did not schedule a render per
  stroke, then reconciled in `flushInkUiSync`. The store keeps that as an explicit
  `setSaveStatus(status, { deferRender: true })` + `flushPendingRender()` pair
  rather than silently regressing the ink hot path.
- **`SaveStatus` lived in a component.** `lib/` may not import from `components/`
  (enforced by `no-restricted-imports`), so the type moved to
  `lib/workspace/notebook-page-state.ts` as `NotebookSaveStatus`, with
  `NotebookSaveIndicator` re-exporting the old name.

**Batch 2.1 — `useNotebookPersistenceController`** — **done**

Autosave scheduling, draft write/read, `savePageSnapshot`, `saveCurrentPage`, and
the exit flush, extracted as one commit rather than two.

The payoff landed as predicted: `saveCurrentPageRef` and
`persistCurrentPageDraftRef` existed **only** so the debounce timers could reach
functions declared ~700 lines further down. Both now live in the controller's
scope, the timers call them directly, and the indirection is deleted. Splitting
save from draft would have preserved it.

Two duplications collapsed on the way:

- `persistCurrentPageDraft` and `persistCurrentPageDraftSync` were ~40 near
  identical lines differing only in `serializeAsync()` vs `serialize()`. They
  share one `buildDraft` helper now.
- The `inkInteractionActiveRef.current || inkEditorRef.current?.isInteracting()`
  pair appeared six times; it is one injected `isInkInteracting`.

`flushInkUiSync` stayed in the page on purpose — it mixes ink undo/redo depths
with the save-status flush, and those depths belong to 2.4. Persistence takes
`commitUi` / `scheduleUiCommit` callbacks rather than reaching into ink state.

Page: 4,269 → 3,845 lines. Refs: 45 → 37.

**Batch 2.2 — `useNotebookHydrationController`** (lines 1481–1911, ~430 lines)

Notebook/page/file loading, `hydratedPageIdRef`, file URL and image resolution, the
`useLayoutEffect` at 1886. After 2.1, because hydration and save both write
`selectedPageRef` / `textBlocksRef`.

**Batch 2.3 — split.** The navigation surface needed 20+ inputs, which breaks
the seam-width rule, so it was cut in two.

**2.3a — `useNotebookPageTrack`** — **done.** Track transform, swipe preview
layer, frozen ink snapshot, create-page progress. Everything writes to the DOM
directly rather than through React state, because a swipe must stay on the
compositor. Retires seven refs. Page: 3,640 → 3,505.

**2.3b — navigation orchestration — deliberately NOT extracted.**
`runPageTrackNavigation`, `beginPageHandoff`, `createBlankPageAtEnd`, and the
swipe handlers coordinate track, persistence, loader, and ink. That is
orchestration, and orchestration belongs in a composition root. Forcing it into
a hook would build exactly the wire harness the seam-width rule exists to
prevent. Revisit only if it starts causing problems.

**Batch 2.4 — `useNotebookInkController`** — **done.** Ink editor handle, both
undo histories, stylus cooldown, editor UI batching. Page: 3,505 → 3,404.

**Batch 2.5 — memoization pass** *(the deferred Batch 1.2)* — **done.**

Ten pointer-path handlers wrapped, `React.memo` on `NotebookViewport` and
`NotebookLivePageLayers`, inline arrows removed at the controller call sites.
Ordering fell out once each subsystem owned its state, exactly as predicted.

Dependency arrays were filled from the linter's own analysis, not by hand: a
missing entry there is a stale closure at runtime, not a compile error.

---

## ★ Fix the ink pipeline

The actual goal. The dual ink pipeline is the root cause of the writing
inconsistency; by this point every other consumer of that state is isolated and it
can finally be reasoned about on its own. Scoped as its own project, not a batch.

JSX decomposition (Phase 3) deliberately waits until after this — it blocks nothing
and fixes no bug, and doing it first would delay the ink fix by three verified
batches.

---

## Phase 3 — notebook JSX

Hook extraction alone cannot finish the job: **1,083 lines of JSX remain** after
every controller is out. One commit each.

- **3.1 — `NotebookToolbar`** (dock, pen, highlighter, eraser, menus)
- **3.2 — `NotebookPagesDrawer`** (thumbnail list, add-pages dialog)
- **3.3 — `NotebookPageSurface`** (viewport + layers + text block render tree)

---

## Phase 4 — fill the untested middle

101 test files but only 9 are `.tsx`; ~38 components have zero test reference.

- **4.1 — offline replay e2e.** Queue reviews offline, reconnect, assert
  `services/study/offline.ts` drains correctly.
- **4.2 — component tests.** Start with `JamiAssistantDrawer` (904 lines),
  `SourceWorkspace`, `PracticeWorkspace`, `DashboardAccessGate`.

---

## Phase 5 — shared list-workspace primitives

**Not four independent page decompositions.** Six pages hold the same four state
patterns, and the pure logic behind them is already extracted and tested in
`lib/study/card-search.ts`, `card-selection.ts`, `card-browser-navigation.ts`,
`library-navigation.ts`, and `folder-navigation.ts`. The pages are only holding
React state around clean domain code — the same situation as the notebook.

| State pattern | Pages |
|---|---|
| `feedback` | library, folders, cards, study, topics, decks — **all six** |
| `selected*Ids` multi-select | library, folders, cards, study |
| `editing*Id` + `saving*Id` + `deleting*Id` | folders, cards, topics, decks |
| `search` / `searchTerm` | library, cards, topics |

Extract the primitives first; the pages then collapse cheaply. This removes
duplication *across* pages, not just size *within* them.

- **5.1 — `useFeedback`.** Smallest, touches all six pages, proves the pattern.
- **5.2 — `useMultiSelect`.** Wraps the existing `card-selection` logic.
- **5.3 — `useInlineRowEditing`.** The editing/saving/deleting id triplet.
- **5.4 — study page** (2,561 lines, 28 `useState`). The review loop — requires
  Batch 1.3 to exist first.
- **5.5 — library** (1,705 / 39) · **5.6 — folders** (1,212 / 38) ·
  **5.7 — cards** (1,125 / 33)

Sequencing matters: 5.1–5.3 land before any page batch, so each page absorbs the
primitives as it is decomposed rather than being refactored twice.

---

## Phase 6 — cross-cutting

Independent; each a small standalone commit.

**6.1 — Audit the historical `.env`.** Commits `654308a` and `638347e` touched a
`.env` containing `DATABASE_URL`, a Prisma-era leftover from before the Firebase
migration. `.gitignore` is thorough and nothing sensitive is tracked now. Confirm
that value is dead; rotate or rewrite history if it was ever live. **Five minutes,
the only security item in this plan — do it first.**

**6.2 — Lazy-load `recharts`.** [progress/page.tsx:14](../app/dashboard/progress/page.tsx#L14)
imports it statically while js-draw, pdfjs, and katex are all behind `await import()`.

**6.3 — Resolve the three meanings of "practice."** The route is
`/dashboard/practise`, its nav label is **"Folders"**, and `lib/practice/` holds
topics and sources. Compatibility explains the route, not the label mismatch.
`lib/practice/` is imported by 20 files, so it is load-bearing, not dead.

**6.4 — CI file-size guard.** Fail the build on any file over 1,200 lines. Nothing
currently stops the next 4,000-line file from appearing, and this plan spends weeks
removing this one.

---

## Ordering

```
0.1  text-block controller                 done  1a123fd
6.1  audit historical .env                 done  (database already deleted)
1.1  viewport controller                   done  fa67b1e
1.3  study-loop e2e                        done  3738ae4
     ── iPad / Pencil gate ── passed
2.0  NotebookPageState store               done  ef963e2
2.1  persistence controller                done  8c8eee5
2.2  notebook loader                       done  6dc1eab
     emulator port preflight               done  da5d59b
2.3a page track                            done  5453c8f
2.3b navigation orchestration              not extracted, by decision
2.4  ink controller                        done  f98c8f5
★    INK PIPELINE FIXED                    done  f98c8f5, iPad-verified
2.5  memoization pass                      done  777786e
3.1  NotebookDrawingToolbar         done  b8809a0
3.2  NotebookPagesDrawer            done  78c7635
3.3  NotebookTextBlockLayer         done  d7c07e2
4.1  offline replay e2e             ← next
4.2  component tests for untested middle
5.1  useFeedback
5.2  useMultiSelect
5.3  useInlineRowEditing
5.4  study page          (needs 1.3)
5.5  library
5.6  folders
5.7  cards
6.2  lazy recharts
6.3  practice naming
6.4  CI file-size guard
```

## Tracked elsewhere

**Navigation collapse** — eleven top-level destinations, with Decks/Cards/Topics as
three doors into the same flashcard material and Progress/Stars as two views of the
same data. This is the largest user-facing improvement available, but it is a
product decision rather than a refactor and does not belong in this plan.

**Not in scope:** visual polish, until the structural work is done, so it never gets
mixed into a refactor commit.

---

## Phase 5A — shared list-workspace primitives

Measured 2026-07-31, not estimated. Nine dashboard pages hold the same three
patterns; the pure logic for one of them already exists and is tested.

**Split from 5B on purpose.** 5A migrates call sites in place and is mechanical
and unit-testable. 5B decomposes four pages totalling ~6,600 lines and needs a
browser safety net that does not exist yet (see the prerequisite below). 5A is
roughly a quarter of the work and carries most of the duplication value.

### Batch 5.1 — `useFeedback`

**160 `setFeedback` calls across nine pages.** Only three shapes exist:
`setFeedback(null)`, an error object, and a success object. Sixteen of them
repeat `error instanceof Error ? error.message : "fallback"` by hand across four
pages.

```ts
const feedback = useFeedback();
feedback.success("Deck renamed.");
feedback.error("Could not rename this deck.");
feedback.fromError(error, "Could not rename this deck."); // the repeated idiom
feedback.clear();
```

Returns `{ feedback, success, error, fromError, clear }` so the existing
`<FeedbackBanner …/>` render stays as it is.

- **5.1a** — build the hook plus tests, adopt on **`topics`** only (13 calls,
  smallest page with the full pattern). **Stop here for review**: this API
  reaches nine pages, and getting it wrong is expensive to unwind.
- **5.1b** — adopt on decks, goals, cards (52 calls).
- **5.1c** — adopt on library, folders, study, constellation, progress (94 calls).

### Batch 5.2 — `useMultiSelect` *(smaller than first estimated)*

`components/decks/useCardSelection.ts` **already is this hook**, backed by
tested pure logic in `lib/study/card-selection.ts` (toggle, add, shift-range).
It is card-typed and lives under `components/decks`, so only `cards` and
`DeckDetailPageClient` use it. `library`, `folders`, and `study` each roll their
own selection by hand.

Work is generalise-and-move, not build:

- **5.2a** — rename ids from card-specific to generic, move to
  `hooks/useMultiSelect.ts` and the logic to `lib/app/multi-select.ts`, keep the
  two current callers working. Pure refactor, existing tests carry over.
- **5.2b** — adopt in library, folders, study (**69 `selected*Ids` references**),
  which also gives those pages shift-range selection they do not have today.

### Batch 5.3 — `useInlineRowEditing` *(less uniform than first estimated)*

The `editingId` / `savingId` / `deletingId` triplet is genuine, but only
`topics` is clean. `decks` carries three draft fields alongside it
(`editingDeckName`, `editingDeckColor`, `editingDeckFolderId`), `cards` carries
three more, and `folders` only has `deletingNotebookId`.

So the primitive is the triplet plus a generic draft slot:

```ts
const rows = useInlineRowEditing<DeckDraft>();
rows.startEditing(deck.id, { name, color, folderId });
rows.draft            // DeckDraft | null
rows.isSaving(deck.id)
rows.isDeleting(deck.id)
```

- **5.3a** — build against `topics` (the clean case).
- **5.3b** — adopt in decks and cards, which is where the draft slot earns its
  place. **`folders` is deliberately skipped**: one delete-id is not a triplet,
  and forcing it in would be worse than leaving it.

### Prerequisite that blocks 5B, not 5A

`library`, `cards`, `topics`, and `decks` have **no browser coverage at all**;
`folders` appears only incidentally when the notebook smoke navigates back. The
notebook work was safe partly because the browser suite caught a `selectedPage`
that unit tests could not see. 5A changes call sites in place and is covered by
typecheck plus unit tests, so it can proceed. 5B cannot, safely, until those
pages have smokes.

### Estimate

| Batch | Scope | Batches |
|---|---|---|
| 5.1 useFeedback | 160 calls, 9 pages | 3 |
| 5.2 useMultiSelect | generalise + 3 pages | 2 |
| 5.3 useInlineRowEditing | build + 2 pages | 2 |
| 6.2 lazy recharts + 6.4 CI size guard | trivial, bundled | 1 |
| **5A total** | | **8** |

Gate per batch as usual. `useFeedback` and `useMultiSelect` touch pages with no
browser coverage, so typecheck and unit tests are the real net there — worth
being deliberate about the adoption batches rather than sweeping them together.

---

## Phase 7 — component tests

Measured 2026-07-31. Forty of eighty-three components have no test. Line count
is the wrong way to pick between them: `SourceWorkspace` is the longest at 354
lines and holds almost no state, while `ProfilePhotoEditor` is 199 lines with
sixteen state hooks driving a drag-to-crop gesture.

**Sort by behaviour, not size.** What follows is ordered by what breaks if the
component is wrong.

### Batch 7.1 — the ones with consequences

- **`DashboardAccessGate`** (98 lines). Decides whether an unauthenticated
  visitor reaches the dashboard. It holds a `checked` flag separate from
  `user`, and redirects only once both settle — get that wrong and either a
  signed-out visitor sees the dashboard for a frame, or a signed-in one is
  bounced to the landing page mid-load. Smallest file here and the worst
  failure.
- **`TopicMigrationGate`** (39). Blocks the UI during a data migration.
- **`PwaBootstrap`** (20). Registers the service worker; the emulator path
  already has a carve-out, which is exactly the kind of branch that rots.

### Batch 7.2 — gesture and draft state

- **`ProfilePhotoEditor`** (199, 16 state hooks). Drag-to-reposition with
  pointer capture, an upload, and a save. The densest state in the list.
- **`SourceDraftEditor`** (350, 11). Editing an AI draft before it is accepted.
- **`NotebookEditorDialog`** (251, 9) and **`CreateFolderDialog`** (173, 8).
  Creation dialogs, where the risk is submitting twice or on an empty field.

### Batch 7.3 — the workspaces

- **`PracticeWorkspace`** (338, 13). The Folders destination.
- **`JamiAssistantHistory`** (307, 6). Thread list, rename, delete.

### Deliberately not tested

Twenty of the forty hold no state at all: `Skeleton`, `SectionHeader`,
`ProgressBar`, `BrandMark`, `JamiSparklesIcon`, `AppPage`, `CardFaceSummary`,
`ObjectIcon`, `NotebookSaveIndicator`, `CardActionsMenu`, the notebook colour
and thickness pickers, `ConstellationStar`, the source drawers, and
`ProgressCharts`.

A test for these can only assert what they render, which means asserting on
markup and class names. **That is actively harmful right now**: the next work
on this codebase is a visual redesign, so those tests would break on every
styling change and be deleted rather than fixed. Leave them until their
appearance is settled, and prefer a browser smoke over a unit test when the
question is "does this look right".

### Estimate

| Batch | Components | Batches |
|---|---|---|
| 7.1 gates | 3 | 1 |
| 7.2 gestures and drafts | 4 | 2 |
| 7.3 workspaces | 2 | 1 |
| **total** | **9** | **4** |

Nine components, not forty. That takes the untested count from 40 to 31, and
every one of the 31 left is either presentational or already covered
indirectly by a browser flow.
