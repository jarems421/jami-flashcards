# Jami cleanup plan

Continues the notebook decomposition track started in `da3d9c7` → `4fc3ebb`, merged
with a codebase-wide review. Written 2026-07-30.

## Status

| Batch | State |
|---|---|
| 0.1 text block controller | done — `1a123fd` |
| 6.1 historical `.env` audit | done — credential was real but the database is already deleted, so it is inert |
| 1.1 viewport controller | done — `fa67b1e` |
| 1.2 memoisation | folded into 1.1, 2.3, and 2.5 (see below) |
| 1.3 study loop e2e | done — `3738ae4` |
| **iPad / Pencil gate** | **blocked — needs a physical device, gates all of Phase 2** |
| 2.0 onward | not started |

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

## Current state

`app/dashboard/notebooks/[notebookId]/page.tsx` — **4,525 lines**, 51 `useState`,
57 `useRef`. Logic runs to line 3442; JSX is lines 3443–4525 (**1,083 lines**).

Extracted so far: `useNotebookToolbarDocking` (519 lines, 10 tests),
`useNotebookTextBlockController` (776 lines, 14 tests).

Remaining notebook clusters, by line range:

| Lines | ~Size | Cluster |
|---|---|---|
| 316–515 | 200 | state + ref declarations |
| 516–943 | 430 | viewport transform: pinch, pan, track offset, preview layer |
| 944–1104 | 160 | assorted sync effects |
| 1105–1480 | 375 | undo stack, ink UI sync, autosave scheduling, draft persistence |
| 1481–1911 | 430 | page hydration + layout effect |
| 1912–2234 | 320 | `savePageSnapshot`, `saveCurrentPage`, exit-save queue |
| 2235–2550 | 315 | page navigation, handoff, track animation |
| 2551–2658 | 110 | exit-save effect, save retry, draft-conflict resolution |
| 2659–2765 | 105 | `createBlankPageAtEnd` |
| 2766–3024 | 260 | page-swipe pointer handlers |
| 3025–3178 | 155 | touch/pointer handlers, delete page |
| 3179–3442 | 265 | add file, undo/redo, tool menus |
| 3443–4525 | 1,083 | JSX |

**Honest targets.** The notebook page lands at **~1,100–1,200 lines**, not under 800:
after every extraction there remain ~200 lines of state declarations, ~265 of
menu/undo handlers, ~200 of composition JSX, and ~75 of new wiring. That is still a
76% cut and it stops being a god component, which is the actual goal.

**Total repo size will grow, not shrink.** The text-block extraction removed 384
lines from the page and added 1,098 across the hook and its test — net **+714**.
Expect ~72k → ~83k lines across source and tests. That is the correct trade: one
unreadable file becomes many readable ones plus the tests that were previously
impossible to write.

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

**Batch 2.1 — `useNotebookPersistenceController`** (lines 1105–1480, 1912–2234,
2551–2658; ~800 lines)

Autosave scheduling, draft write/read, `savePageSnapshot`, `saveCurrentPage`,
exit-save, retry, draft-conflict resolution — **one commit, not two.** The page
currently holds `saveCurrentPageRef` and `persistCurrentPageDraftRef` purely to
break a circular reference between these two, plus `saveOperationRef` to serialise
them. Splitting the extraction preserves that ref indirection, which is the exact
thing making the region unreadable. Extracting together lets the ref hop be deleted.

Highest-risk batch in the plan. Nothing else on the same day.

**Batch 2.2 — `useNotebookHydrationController`** (lines 1481–1911, ~430 lines)

Notebook/page/file loading, `hydratedPageIdRef`, file URL and image resolution, the
`useLayoutEffect` at 1886. After 2.1, because hydration and save both write
`selectedPageRef` / `textBlocksRef`.

**Batch 2.3 — `useNotebookPageNavigationController`** (lines 2235–2550, 2659–3024;
~625 lines)

Page selection, handoff, track navigation, swipe gestures, `createBlankPageAtEnd`.
Retires `maybeFinishPageHandoffRef`, `pageSwipeRef`, `pageSwipeInkSnapshotRef`.

**Batch 2.4 — `useNotebookInkController`**

Ink editor handle, dual undo/redo stacks (`undoStackRef` + `inkUndoDepth`), ink UI
sync, eraser mode.

**Batch 2.5 — memoization pass** *(the deferred Batch 1.2)*

With pinch, swipe, persistence, and ink all behind stable controller interfaces,
the remaining `handlePagePointer*` dispatchers become memoizable and the inline
arrows at 1347, 1356–1359, 4128, and 4131 can be removed. Add `React.memo` to
`NotebookViewport` and `NotebookLivePageLayers` — pointless before this batch,
since changing handler props would defeat it every render. Confirm on the iPad.

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
0.1  land in-flight text-block controller        ← now
6.1  audit historical .env                       ← now, 5 min
1.1  viewport controller          (absorbs pinch memoization)
1.3  study-loop e2e
     ── physical iPad / Pencil gate ──
2.0  NotebookPageState + reducer                 ← gates everything after
2.1  persistence controller
2.2  hydration controller
2.3  page navigation controller   (absorbs swipe memoization)
2.4  ink controller
2.5  memoization pass             (the deferred 1.2)
★    FIX THE INK PIPELINE                        ← the actual goal
3.1  NotebookToolbar
3.2  NotebookPagesDrawer
3.3  NotebookPageSurface
4.1  offline replay e2e
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
