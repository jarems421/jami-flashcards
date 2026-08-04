# Notebook ink: three planned features

Written 3 August 2026, and **all three shipped the same day** — see "As built"
at the end for where the implementation departed from this plan. Covers
scribble-to-erase, the highlighter erase deformation, and notebook swipe
queueing. Each section states the problem as it existed, the chosen approach,
the files it touches, and how it was verified.

Read alongside `docs/ui-design-system.md` and the `stylus-performance` skill.
Nothing here changes the saved stroke format, so existing notebooks keep
opening unchanged.

---

## 1. Highlighter erase deformation

### What actually happens

`lib/workspace/notebook-chisel-stroke.ts` builds a highlighter stroke as **one
path holding many convex footprints**, joined by `MoveTo` commands. That
structure is deliberate and correct for rendering: each footprint is convex so
it cannot fold, they are all wound the same way, and under the nonzero fill rule
overlaps add rather than cancel. That is what fixed the holes.

It is also exactly what the eraser cannot survive.

`Stroke.withRegionErased` (`node_modules/js-draw/.../components/Stroke.mjs`)
does two things to a filled path:

1. It splits the path at the eraser intersections and pairs the pieces —
   `parts[i].union(parts[parts.length - i - 1])` — on the assumption that the
   path is **one closed loop**. With twelve footprints it welds a piece of the
   first footprint to a piece of the twelfth.
2. Every resulting piece goes through `Path.asClosed()`, which **replaces every
   `MoveTo` with a `LineTo`** and then closes the end back to the start.

So the first erase stroke converts a row of separate footprints into a single
polygon whose edges zig-zag between them. Bridges appear between footprints,
the boundary bulges outside the original wash, and self-crossings punch holes.
That is the deformation.

The same structure explains the other symptom — an eraser pass that does
nothing. `withRegionErased` bails out with `failedAssertions` (returning the
component unchanged) when a piece it decided was "inside" is more than twice the
eraser's size, which a welded multi-footprint piece almost always is. Our
`isByteEquivalentReplacement` guard in `notebook-precision-eraser.ts` then
correctly treats that as "no change".

### Approach: hybrid single outline

Keep the footprints as the drawing model. Change what gets **committed**.

- **`preview()` keeps the current footprint path.** It is fast, hole-free, and
  never gets erased.
- **`build()` emits a single simple closed loop**: the polygon union of the
  footprints, as one part with no `MoveTo`. `asClosed()` becomes a no-op, the
  split-and-pair logic sees the one loop it expects, and a highlighter erases
  exactly like a pen stroke does.

The union of the footprints is the same region the footprints already paint
under nonzero winding, so **the shape does not change at commit** — the pen
pipeline's "must not reshape on commit" rule is respected.

New pure module, `lib/workspace/notebook-convex-union.ts`:

```
unionOfConvexPolygons(polygons: Point2[][]): Point2[] | null
```

Because every input is convex, this needs no general boolean-op library:

1. Collect every edge of every polygon, split at all pairwise intersections.
2. Drop any edge whose midpoint lies strictly inside another polygon
   (point-in-convex-polygon is a sign test per edge).
3. Trace the surviving edges into a loop, taking the most clockwise turn at each
   junction, starting from the minimum-x vertex — which is guaranteed to be on
   the outer boundary.
4. Return `null` if the trace fails to close, revisits an edge, or yields fewer
   than three vertices.

A stroke is continuous, so its union is always connected: one outer loop,
possibly enclosing holes. **Holes are filled, not preserved** — a highlighter
drawn as a closed ring will be a filled blob. That is a deliberate, benign
trade; a real highlighter is not a stencil.

Cost is O(k²) in total edge count (roughly 4 per footprint, so ~100 edges → 10k
sign tests) and it runs **once per stroke at commit**, not per pointer sample.
It is off the hot path entirely.

**Fallback tier (the "hybrid"):** if `unionOfConvexPolygons` returns `null`,
`build()` emits the existing footprint path unchanged. Today's behaviour is the
floor, never the ceiling.

### Existing highlights

Highlights already saved carry the multi-subpath geometry and would keep
deforming. Two options considered:

| Option | Verdict |
| --- | --- |
| Split the legacy path's subpaths into separate `Stroke` parts | **Rejected.** Parts fill independently, so every footprint joint would visibly double-darken at highlighter alpha. |
| Heal on contact: rebuild as one outline before erasing | **Chosen.** |

In `NotebookPrecisionEraserGesture.eraseBetween`, when a candidate component is
a filled stroke whose path contains `MoveTo` commands, rebuild it through
`unionOfConvexPolygons` (the subpaths *are* the convex footprints, in order)
and substitute the healed component before calling `withRegionErased`. The heal
is folded into the same undo action as the erase. If the union fails, skip the
heal and erase as today.

### Files

- `lib/workspace/notebook-convex-union.ts` — new, pure.
- `lib/workspace/notebook-chisel-stroke.ts` — `build()` uses the union; keep the
  footprint path for `preview()` and as fallback.
- `lib/workspace/notebook-precision-eraser.ts` — legacy heal-on-contact.
- `tests/notebook-convex-union.test.ts` — new.
- `tests/notebook-chisel-stroke.test.ts` — assert a committed stroke's path has
  no `MoveTo`, and that its area matches the footprint union within tolerance.

### Verification

Unit tests for the union (overlapping run, doubled-back run, single footprint,
degenerate collinear input, failure → `null`). Then browser: highlight a line of
text, precision-erase through its middle, confirm two clean remainders with
straight cut edges and no bridging; erase across a curved highlight; erase a
highlight drawn before this change (heal path). Full suite before handoff —
this touches saved-geometry construction.

---

## 2. Scribble-to-erase

Destructive and new, so detection is conservative by construction and the
gesture is designed to be *impossible* to trigger accidentally on blank paper.

### Behaviour

With the **pen** selected (never the highlighter — highlighting is inherently
back-and-forth), a rapid zig-zag over existing ink deletes the strokes it covers
and does not leave the scribble behind. Over blank paper, or over ink it does
not sufficiently cover, the scribble is simply drawn as ordinary ink.

### Why it can be made safe

The gesture is evaluated on `pointerup`, **before the up event reaches
js-draw**. All the samples are already in our own buffer in
`NotebookInkEditor.forwardInkPointer`. If it is a scribble we dispatch
`GestureCancelEvt` — `cancelEditorGesture()` already does exactly this, and
js-draw's `Pen.onGestureCancel` discards the in-progress builder without
committing — and then dispatch our own `Erase(covered)`.

Consequences that fall out of that ordering, for free:

- The scribble never becomes a component and never enters history.
- **One undo restores everything**, with no stray "scribble reappears" step.
- Nothing is ever erased mid-stroke; the decision is made once, at release.

### Detection

New pure module, `lib/workspace/notebook-scribble-erase.ts`:

```
detectNotebookScribble(samples: readonly PointerSample[]): NotebookScribble | null
```

Screen-space CSS pixels, matching the precision eraser's existing convention, so
the thresholds mean the same thing at every zoom. All of these must hold:

| Signal | Threshold | Why |
| --- | --- | --- |
| Direction reversals along the principal axis | ≥ 4 | `w` and `m` have 3 legs; a two-pass cross-out has 2. Four reversals is already outside handwriting. |
| Leg parallelism | mean deviation from the principal axis < ~25° | A scribble sweeps a band; a word does not. |
| Path length ÷ bounding-box diagonal | ≥ 4 | Confirms retracing rather than progressing. |
| Leg overlap along the major axis | ≥ 60% | Separates a scribble from hatching or shading, which advances. |
| Major extent | ≥ 40 px | A tiny `zz` in handwriting cannot qualify. |
| Mean speed | ≥ ~1.2 px/ms | Scribbles are fast; deliberate shading is not. |

Principal axis by PCA over the samples. Returns the scribble's band (convex hull
of the samples grown by the pen half-width) for the coverage test.

### Coverage: what gets deleted

Whole strokes only, and only strokes the scribble genuinely covers — **≥ 60% of
the candidate's length inside the band**, or full containment within it.
Otherwise scribbling over a word that sits on an underline would take the whole
underline with it. If nothing clears the bar, the gesture is not a scribble at
all: let the stroke commit as ink.

Candidates come from `editor.image.getComponentsIntersecting(band.bbox)`, the
same entry point the precision eraser already uses.

### Surfacing it

An erase you did not ask for, delivered silently, is the failure mode. Reuse the
existing transient pill pattern (`touchInkHintVisible` in the notebook page) to
show `Scribbled out 3 strokes · Undo` for ~2.6s. The toolbar undo button is also
right there and now does the right thing in one press.

A **Scribble to erase** switch goes in the pen settings section of
`NotebookToolSettingsPopover`, persisted to `localStorage` through the same
guarded pattern as `readNotebookToolbarDockPreference`. Default **on**, matching
GoodNotes; the thresholds above are what make that defensible.

### Files

- `lib/workspace/notebook-scribble-erase.ts` — new, pure: detection + coverage.
- `lib/workspace/notebook-scribble-gesture.ts` — new: the js-draw side (candidate
  lookup, `Erase` dispatch), sibling to `notebook-precision-eraser.ts`.
- `components/workspace/NotebookInkEditor.tsx` — bounded per-pointer sample
  buffer (cap ~512, reuse arrays; this is a hot handler), evaluation before the
  `pointerup` forward.
- `components/workspace/NotebookToolSettingsPopover.tsx` +
  `NotebookDrawingToolbar` props — the switch.
- `lib/workspace/notebook-toolbar.ts` — preference read/write.
- `app/dashboard/notebooks/[notebookId]/page.tsx` — preference state, undo pill.
- `tests/notebook-scribble-erase.test.ts` — new.

### Verification

The detector's test table is the deliverable here: recorded sample paths for
`w`, `m`, `z`, a two-pass cross-out, hatching/shading, a slow deliberate
zig-zag, and a genuine scribble — asserting only the last one detects. Then
browser and iPad: scribble over a word (deletes, one undo restores), scribble on
blank paper (stays as ink), scribble partly over a long underline (underline
survives), write `www` quickly (survives), highlighter zig-zag (never triggers).
Full suite — this is an interaction and history path.

---

## 3. Notebook swipe queueing

Small, and it closes a real data-loss window.

### Two problems, one window

`pageNavigationLockedRef` is held from swipe release until the target page's ink
editor reports ready. During that window:

**a. A second flick is silently swallowed.** `handlePagePointerDown` returns
early while locked, so the gesture never starts. Two quick flicks advance one
page. On iPad this reads as the app dropping input.

**b. A fast second swipe can land on a page whose ink is not in memory.**
`beginPageHandoff` sets `selectedPageId` directly — it does **not** hydrate ink
first, unlike `selectPageById`, which does and says why: *"selecting a page
before its ink arrives would mount an empty canvas that autosave could write
over the saved drawing."* Neighbour prefetch (`useNotebookLoader`) covers ±1
from the *current* page, so it has not started for N+2 when the second flick
commits.

The save path's `pageHasUnloadedInk(page)` guard stops the write **while** ink
is missing. But `NotebookInkEditor` reads `initialSvg` once at mount into
`initialSvgRef`, and `inkEditorMountRevision` is only bumped on draft restore —
so when hydration lands, the real ink never reaches the mounted-empty editor,
`pageHasUnloadedInk` goes false, and the next autosave writes the blank canvas
over the student's drawing. That is the overwrite this feature guards against.

### Fixes

**1. Ink-first gate on the swipe path.** In `runPageTrackNavigation`, the ready
promise becomes both checks:

```
Promise.all([prepareCurrentPageForNavigation(), hydratePageInk(targetPage.id)])
```

Both must resolve true or the track returns to source. These already race the
settle animation in parallel, and prefetch makes hydration a no-op in the normal
case, so the common path costs nothing. This brings the swipe path in line with
the rule `selectPageById` already documents.

**2. Remount an editor that mounted empty.** When the selected page's ink
arrives after the editor mounted, bump `inkEditorMountRevision`. Guard it to the
case where there is nothing to lose — the editor has no ink and no history —
because a remount discards js-draw's undo stack for that page. That is exactly
the mounted-empty case, and it closes the same window for the pages drawer,
`createBlankPageAtEnd`, and anything added later.

**3. Queue the flick instead of dropping it.** One slot, replace-on-newer:

- While locked, a horizontal release that clears the existing
  `getNotebookSwipeReleaseDecision` threshold records
  `{ direction, velocityX }`. Flicks only — a stray touch during settle must not
  turn a page.
- No live track offset during the lock: the track is mid-animation, so this is a
  **deferred command, not a deferred drag**. No preview, no offset write.
- Drain one queued intent in `maybeFinishPageHandoff`, immediately after
  `pageNavigationLockedRef.current = false`, via `selectPageByOffset`.
- Clear the slot in `clearPageTrackMotion` and in the blur / visibility-change
  teardown, so a queued intent cannot survive an interrupted gesture.

One slot, not a queue: a flurry of five flicks should land one page ahead of
where the animation is, not five. Chained page turns each still pay the ink-first
gate, so the queue can never outrun hydration.

### Files

- `lib/workspace/notebook-navigation-queue.ts` — new, pure: accept / replace /
  clear rules and the drain decision. Small module rather than growing
  `notebook-inking.ts` (628 lines), per the seam-width rule.
- `app/dashboard/notebooks/[notebookId]/page.tsx` — the gate, the queue ref, the
  drain in `maybeFinishPageHandoff`, clears in the two teardown paths. Page
  navigation orchestration stays in the composition root; do not force it into a
  hook.
- `hooks/useNotebookLoader.ts` or the page — the mount-revision bump.
- `tests/notebook-navigation-queue.test.ts` — new.
- `tests/use-notebook-page-state.test.tsx` — extend for the remount guard.

### Verification

Unit tests for the queue rules. Browser and iPad: flick twice fast (lands two
pages on, both ink correct), flick during a settle then interrupt with a pinch
(queue cleared), swipe to a page whose ink fetch is throttled — confirm the
track returns to source rather than opening a blank page, and that drawing on a
page reached that way never overwrites saved ink. Full suite — persistence and
navigation.

---

## Sequencing

1. **Swipe queueing** first. Smallest, and it closes a data-loss path that the
   other two features' testing will otherwise keep tripping over.
2. **Highlighter union** second. Self-contained, and it makes highlighter
   erasing trustworthy before scribble-to-erase adds a second erase gesture.
3. **Scribble-to-erase** last. Largest surface, and it wants a settled eraser.

---

## As built

Three things came out differently once the code was written.

**The swipe fix gained a fourth part.** Gating the swipe on hydration and
remounting an editor that mounted empty both close the window *after* the fact.
The simpler guarantee is to stop anyone drawing on a page whose ink has not
arrived: `editingEnabled` now also requires `!selectedPageInkUnloaded`. That
makes the remount unconditionally safe — it can only ever run against an editor
with no ink and no history — rather than safe-by-inspection.

**The union needed to split edges at corners, not only at crossings.** Two
footprints frequently share *part* of an edge rather than cutting across it, and
a shared run has no proper intersection to find. Without splitting at the
corners that lie on an edge, the two polygons never get matching breakpoints,
the trace reaches a vertex with nowhere to go, and the whole union is abandoned.
Every multi-polygon case failed until `getVertexSplitParameters` was added.

**A degenerate scribble is refused rather than handled.** A gesture whose
samples are collinear — retracing one line exactly — has no convex hull and so
no band. It returns `null`, which is the right failure for a destructive
gesture: no band means no honest answer about what it covered.

The chisel-stroke tests moved with the structure. The footprint invariants that
used to be asserted against the built stroke are now asserted against the
*preview*, which is where footprints still live, and a new block pins the
committed loop. `tests/notebook-precision-eraser.test.ts` gained a legacy-heal
block whose area assertion was checked to fail with the heal disabled — subpath
counting alone cannot see the deformation, because `asClosed()` welds the
footprints into a single subpath too, just the wrong one.

### Gaps found on review, and how they were closed

A pass over the shipped code turned up five loose ends. Four are closed.

- **A queued flick past the last page did nothing**, where the same gesture on
  an idle track makes a new page. The queued turn now records whether the pull
  was hard enough to create, and `resolveQueuedNotebookPageTurn` decides
  create/turn/none against the page the queue actually lands on.
- **Deleting a page selected its neighbour without waiting for ink** — the same
  data-loss path as the swipe, missed on the first pass. Now hydrates first.
  Closing it surfaced a second bug underneath: `getNotebookPageWithInk` returns
  a *copy of the page as it was before the fetch*, carrying ink, and
  `hydratePageInk` wrote that whole copy back. Since deleting a page renumbers
  the ones after it, hydrating during a delete restored the old numbering.
  Hydration now merges only the ink fields into the page as it currently
  stands, which also hardens the pre-existing neighbour prefetch against the
  same race.
- **Zoom changed how easily a scribble triggered.** The thresholds now split by
  what they measure: size is page-relative (a scribble is about as wide as a
  word, whatever the zoom), speed and tremor are screen-relative (the hand does
  not know what the zoom is). Measuring everything one way makes the gesture
  trivial to trigger at one end of the zoom range and impossible at the other.
- **A page waiting for its ink looked editable.** It now says so.

**Not closed, deliberately: a scribble does not delete text blocks.** It could,
but the two histories are separate — js-draw owns ink undo, the page owns text
undo, reconciled by timestamp — so deleting both would take two presses of undo
to reverse, losing the single-press property the gesture was built around.
Making it atomic means adding pairing to undo ordering that was hard-won. And
the product case is weak: text blocks are objects with their own delete button,
a box may hold a paragraph, and scribbling over typed text is at least as likely
to mean "mark this wrong" as "remove it". Scribbling over a text box leaves ink
on top of it, exactly as scribbling over blank paper does.

**Already correct: a failed ink fetch mid-swipe.** The track returns to source
and the existing message — "could not load this page's drawing. Stay on this
page and try again in a moment" — reads correctly for that outcome.

### Reported broken on device, and why

Both new gestures failed in real use. Neither had anything to do with wiring —
both were calibration, and both were only findable by measuring against inputs
shaped like real ones.

**Quick flicks were still being swallowed.** The queue decided whether to hold a
flick from the state at *pointer-down*. But a settle takes a few hundred
milliseconds and so does a second flick, so the flick usually lands across the
end of the settle: begun while busy, released once idle. It was queued — and
then stranded, because the queue only drains when a handoff completes and there
was no longer a handoff in flight. It now queues only when the track is *still*
settling at release; otherwise the release falls through and turns the page
immediately. `shouldQueueNotebookPageTurn` states the rule and its test says why.

**Scribble-to-erase almost never fired.** The thresholds were tuned against tidy
synthetic fixtures — perfectly parallel legs, constant speed — and real gestures
missed on three of six gates at once. Measured over generated hand-shaped
scribbles:

| Gate | Was | Real scribbles measure | Now |
| --- | --- | --- | --- |
| Reversals | ≥ 4 (five passes) | 3 (four passes) | ≥ 3 |
| Screen speed | ≥ 1.2 px/ms | 0.4–0.9 | ≥ 0.35 |
| Retrace ratio | ≥ 4 | 2.8–4.7 | ≥ 2.5 |

Loosening those let a `w` through, which is the failure that matters. Its legs
are parallel and retrace each other perfectly, and once the principal axis of a
squarish shape comes out vertical, nothing about direction of travel separates
it from a scribble. Proportions do: a scribble-out is a **band** laid over some
writing. A new gate caps the gesture's width across its own direction at half
its length — real scribbles measure 0.12–0.38 against it, while `w`, `m`, `z`,
`big w` and hatching all sit above 0.6.

Speed came out as the weakest signal and is now nearly vestigial. Its original
job was excluding shading, which band aspect and leg overlap reject far more
convincingly (overlap 0.00, aspect 0.63). What is left for it is telling a
strike-out from someone drawing slowly.

Two shapes deliberately still do not fire: a three-pass zig-zag (two reversals,
exactly what `w` and `m` make) and a genuinely slow movement.

### Swipe queueing removed

Dropped at the user's request on 4 August 2026. A flick released while the
previous turn is settling is ignored again, as it was before. `lib/workspace/
notebook-navigation-queue.ts` and its tests are gone.

**The data-loss fixes it was bundled with all stay** — they were never part of
the queue. Swipes and page deletes still wait for ink before opening a page, a
page whose ink has not arrived refuses new strokes and says so, a canvas that
mounted empty is rebuilt, and hydration merges only ink into the current record.

### Scribble-to-erase: where the safety actually lives

Three rounds of real-device feedback said the same thing — it did not fire — and
each round the cause was a rule protecting against a `w`.

The last one was decisive: it failed on whole words, on blocks of several lines,
on scribbling away an earlier scribble, and inconsistently on single letters
(fine on a `j`, useless on a `t` or `f`). Those have one cause each and one
cause in common.

- **Area-covering gestures** were rejected by the band-shape rule. Scribbling
  out a block is roughly as tall as it is wide; the rule demanded a thin band.
- **Single letters** were rejected by a minimum length sized for words. A few
  passes across a `t` span barely more than its stem — which is why it worked
  scribbling *along* a letter and not across one.
- **The axis was being measured from the wrong thing.** The principal component
  of the *points* picks the direction a gesture spreads, and for a square block
  that is the direction it advances rather than the direction its legs run — so
  every leg read as perpendicular to its own axis. It now comes from how the pen
  travelled, which has no such ambiguity.

The common cause is that shape was being asked to do a job it cannot do. At
letter size a scribble and a `w` are the same motion, and every rule that
separated them cost something people do. So the shape gates are now deliberately
permissive — enough to recognise a repeated back-and-forth — and **the safety is
that recognising a scribble deletes nothing on its own**. Ink has to be
decisively covered: half of a stroke for an ordinary gesture, and **80% for a
letter-sized one**, where writing a letter over existing work leaves that work
mostly outside and comes nowhere near.

Removed along the way: the band-aspect rule, its two-tier variant, and the
detector-level claims about `w`, `m` and `z`, which are now tested where they are
actually protected — nothing is deleted when a letter is written on blank paper
or across existing work.

**Known trade: shading and hatching over existing ink can now be taken.** They
are the same motion as an area scribble and nothing reliably separates them. The
pen settings carry a switch for anyone who shades diagrams.

### Verified

`npm run typecheck`, `npm run lint`, `npm test` (1254 tests, 155 files), and
`npm run build` all pass. The Playwright suite passes 20/20 against a production
build on Firebase emulators, including a new test covering the scribble-to-erase
switch and its persistence across a reload.

**Not verified in a browser by hand.** Browser Use was not available in this
session, so the three gestures themselves — a scribble over real handwriting, a
highlighter erased mid-wash, a double flick between pages — have not been felt
on a real device. The e2e suite exercises the surfaces around them, not the
gestures. Apple Pencil feel in particular still needs a person and an iPad.
