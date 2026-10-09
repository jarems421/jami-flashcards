# Jami Ink

Notebook ink is moving from js-draw to Jami's own engine. This is the plan
while the work is live. When it has shipped, what is still true folds into
`docs/architecture.md` and code comments, and the plan is deleted.

## Why

js-draw has been bent to fit Jami through hooks into its private internals:

- the live ink layer redirects its wet-ink renderer (`notebook-live-ink.ts`);
- the ink window clips its canvas (`notebook-ink-window.ts`);
- its display cache is off because it blurs on 2x screens, so every pan and
  zoom repaints the whole page from vectors (`notebook-js-draw-setup.ts`);
- its pen, preview and eraser are patched (`notebook-ink-runtime.ts`,
  `notebook-pen-preview.ts`).

Every performance fix has been another of these. The last one (6601c748) made
writing feel choppier and strokes visibly change at the lift. Fixing that is
deferred: there is no point tuning the engine being replaced.

Most of the hard, Jami-specific work is already our own code:

- One Euro smoothing;
- the Catmull-Rom pen with its pressure taper;
- the chisel highlighter and nib angle;
- the precision eraser and scribble-to-erase;
- the lift-off gate and the predicted tip;
- palm rejection and the Safari pointer quirks;
- zoom and pan.

js-draw holds the strokes, the undo history, the stroke eraser, SVG reading
and writing, and painting. Painting is where the problems are.

## Owner decisions (9 October 2026)

- **Storage.** Jami's own stroke format, with the explicit migration below.
- **New tools.**
  - Lasso: picks up ink, images, graphs and text boxes; move, resize, rotate,
    recolour and thickness.
  - Shape snapping.
  - Ruler.

  Recorded as an exception in `AGENTS.md`.
- **Highlighter.** Always drawn under pen ink.
- **Exam working sheet.** Gets the new engine, and the ruler only.
- **Tuning.** iPad and Apple Pencil first; the owner tests each stage on the
  device.
- **Rollout.** Everyone at once, with `enableJamiInk` as an emergency fallback
  to js-draw.

## Performance gates

Each stage must hold these targets, measured by `e2e/ink-performance.perf.spec.ts`
in Chromium (headless and headed-GPU, CPU slowed 4x) and by the owner on iPad.

| Gate | Target |
| --- | --- |
| Pen to ink | Drawn inside the pointer event that carried the sample; never waits for a frame |
| Work per pen packet | ≤ 2 ms p95 on iPad, ≤ 4 ms in 4x-throttled Chromium |
| During a stroke | No canvas allocation, layout read, React render, tile render or Firestore work |
| Writing frames | None over 25 ms across a 200-sample stroke, fitted and zoomed, thin and thick |
| Lift | Pixel-identical (the lift diff changes 0 pixels), in ≤ 2 ms |
| Pinch | Compositor-only during the gesture; never blank; sharp within 100 ms of settling |
| Zoomed pan | No blank ink inside the prefetch ring; new tiles drawn in ≤ 4 ms slices |
| Page open | First ink ≤ 150 ms after the data arrives, for a 3,000-segment page |
| Erase, undo, redo, lasso | Only affected tiles redrawn, in ≤ 8 ms |
| Memory | ≤ 96 MB of canvas on iPad; no canvas over 4 MP |

Safari holds web pages to 60 frames a second by default, so the floor on
latency is the display pipeline, not the engine.

### Measuring

```
npm run emulators:free
INK_PERF=1 INK_LABEL=js-draw npx firebase emulators:exec --project demo-jami-browser --only auth,firestore,storage "npx playwright test ink-performance"
```

- In PowerShell, set the variables first (`$env:INK_PERF = "1"`).
- `INK_MODE=gpu` runs it headed on the machine's GPU. Headless Chromium draws
  canvases in software, which makes big canvases look costly and hides the cost
  of reallocating one; the original 6601c748 measurement fell into exactly that.
- Run nothing else heavy alongside it.

Each phase prints frame times, pen-down cost, canvas reallocations and page
repaints. The lift diff counts pixels that change between the pen held at the
end of a stroke and the pen lifted.

### js-draw baseline

Recorded on 9 October 2026, headless, CPU 4x, 1180 × 820 at 2x, on a page of 14
rows of handwriting.

| Phase | Frames over 25 ms | Longest task | Page repaints | Notes |
| --- | --- | --- | --- | --- |
| Fitted, 12 short strokes | 14 | 620 ms | 0 | Pen-down handler 2.5 ms on average |
| Fitted, long stroke | 0 | none | 0 | |
| Fitted lift (thickness 50) | n/a | n/a | n/a | 0 pixels changed |
| Pinch in and settle | 7 | 315 ms | 3 | The page canvas was reallocated once |
| Zoomed, 12 short strokes | 4 | 61 ms | 0 | |
| Zoomed, long stroke | 0 | none | 0 | |
| Zoomed, 6 one-finger pans | 24 | 68 ms | 18 | Every pan repaints the whole window about three times, 57–68 ms each |
| Pinch out and settle | 14 | 89 ms | 3 | |

Zoomed panning is the worst of it: whole-window repaints on every pan, because
the display cache is off. The zoomed lift diff found no ink in its clip; that
is a harness fault, fixed in stage 3, where the lift gate is first needed.

## Architecture

### `lib/ink/`: pure, DOM-free, and also used on the server

- **`model.ts`.** An `InkDocument` holds ordered items, each with a stable id
  and a bounding box. Item kinds:
  - `pen` and `highlighter`: centreline samples (x, y, width, time, plus nib
    angle for the highlighter), the style, and the geometry version and pen
    feel in force when drawn;
  - `shape`: a parametric line, ellipse, rectangle, triangle or arrow;
  - `outline`: a filled or stroked path, for imported legacy ink.

  Page coordinates stay 900 × 1240.
- **`geometry/`.** The pen (`notebook-smooth-pen.ts`,
  `notebook-smooth-pen-widths.ts`), highlighter (`notebook-chisel-stroke.ts`,
  `notebook-convex-union.ts`) and straightening, ported to Jami's own path
  type.
  - An incremental builder returns newly frozen segments and the unstable
    tail. Corners and easing look only a bounded window behind the tip.
  - Every geometry version is frozen by golden tests, so a saved stroke never
    changes shape.
- **`format/`.** The `jami-ink` v3 codec: coordinates quantised to 1/16 page
  unit, delta- and varint-encoded.
  - `importJsDrawSvg` turns js-draw's SVG paths into `outline` items.
  - `importLegacyStrokes` handles v1 strokes through today's conversion, so old
    pages look as they do now.
- **`export/svg.ts`.** `inkToSvg` produces the static SVG for previews,
  thumbnails, the server, exam marking and the rollback copy. It must read
  back into js-draw, and a test guards that.
- **`spatial-index.ts`.** A 64-unit grid for hit tests and tile queries.
- **`history.ts`.** Invertible commands (add, erase, transform, restyle,
  clear), feeding the merged text-and-ink history in `notebook-history.ts`.
- **`tools/`.** All pure:
  - the stroke and precision erasers (outline items clipped with
    `polygon-clipping`);
  - scribble-erase;
  - lasso selection;
  - shape recognition;
  - ruler geometry.
- **`render-plan.ts`.** A pure plan of tiles, levels and the centre-out order.

### `lib/ink-dom/`: the browser engine, imperative and outside React

- **`InkSurface`.** Owns the model, input, renderers, scheduler and history,
  behind the handle `NotebookInkEditor` has today: undo, redo, clear, hasInk,
  serialize and snapshot.
- **One rasteriser.** Live and dry ink are drawn by the same routine on the
  same device-pixel grid. That is what makes the lift pixel-identical.
- **Dry tiles.**
  - 256 CSS px tiles at the settled zoom, drawn from a per-item `Path2D` cache
    through `setTransform`, so they are vector-sharp at any zoom.
  - Highlighter tiles, made only where there is highlighter ink, sit under pen
    tiles.
  - Tile canvases are pooled at a fixed size and re-targeted, never resized,
    with an LRU inside the memory budget.
- **Live ink.**
  - Live tiles on the same grid, allocated once per editor and only moved.
  - Frozen segments are drawn once into them. The tail and the predicted tip
    are drawn on a fixed overlay that follows the pen.
  - Stacking order: dry highlighter, then live highlighter, then dry pen, then
    live pen. A highlighter is under pen ink while it is drawn, too.
- **The lift.** The committed item is drawn into its dry tiles and the live
  tiles are cleared in the same task.
- **Scheduler.** Priorities:
  1. live ink, synchronous;
  2. the commit at the lift;
  3. visible tiles, centre-out;
  4. the prefetch ring;
  5. PDF detail, snapshots and serialisation.

  Levels 3 to 5 never run during a stroke or gesture, and only in ≤ 4 ms
  slices.
- **Zoom.** `useNotebookViewportController` keeps moving the page on the
  compositor during a gesture. Old tiles stay on screen, scaled, until their
  replacements land.
- **Input.** Kept as is:
  - `NotebookInkSmoother`, `NotebookLiftOffGate`, the coalesced-sample bounds,
    the predicted tip;
  - `NotebookNibAngleTracker`, `NotebookInkPointerLifecycle`;
  - the palm guards and the pen's eraser end.

## Integration

- **Editor.** `NotebookInkEditor` is rebuilt on `InkSurface` with the same
  props and handle, so the notebook page and `ExamScratchpad` change together.
- **Saving.**
  - `NotebookInkData` becomes `js-draw-svg` (v2) or `jami-ink` (v3, with an
    SVG copy during the rollout window).
  - `isNotebookInkRecordWithinLimits` counts both. The copy is compacted, or
    marked omitted, when it would not fit.
  - Drafts store v3.
- **Readers.** One helper serves the server
  (`notebook-neighbour-pages.server.ts`, `practice-paper-evidence.server.ts`,
  `notebook-page-render.server.ts`), thumbnails, `previewInkSvg` and the
  static page readers.
- **Exam working.** `examWorkingHasInk` reads the model. The marking image is
  drawn by the engine. Exam attempt pages store v3 plus an SVG copy.
- **Swipes.** Swipe and warm snapshots become engine bitmaps.
- **Unchanged.** Toolbar, tool settings, shortcuts, style sync, the text, image
  and graph layers, PDF rendering (now scheduled by the engine) and phone
  viewing.

## New tools

- **Lasso (L).**
  - The loop is drawn with the pen or a mouse; touch still pans.
  - Handles move, resize and rotate the selection. Colour and thickness come
    from the tool popover.
  - Images and graphs gain an optional `rotation`, read as 0 when absent. Text
    boxes move and resize but stay upright.
- **Shapes on hold.** "Straighten on hold" becomes "Shapes on hold". Holding
  still at the end of a stroke snaps it to a recognised shape, stored as a
  `shape` item. While the pen stays down it can adjust the shape.
- **Ruler.**
  - Fingers that start on the ruler move and turn it instead of panning.
  - It has an angle readout with detents, and the pen within 16 px of an edge
    draws along it.
  - It is not saved. On the exam sheet it is the only new tool.

## Migration

Explicit, as `docs/architecture.md` requires:

- Nothing is converted in the background. Old pages (js-draw SVG, inline
  legacy ink, v1 strokes) open through the importers unchanged.
- A page becomes `jami-ink` v3 only when the student edits it and it saves.
- The SVG copy keeps every page readable by a js-draw build until cleanup.
- Readers of the old formats stay for good. Removing one needs an explicit
  migration and a production count check.

## Stages

Each stage lands with `enableJamiInk` off, complete in itself, inside the size
gate.

0. **Housekeeping (done).** This document, the `AGENTS.md` exception, and the
   perf harness with the js-draw baseline.
1. **Model, format and history.** The model, codec, importers, SVG export,
   spatial index and history, with golden fixtures, round-trips and js-draw
   readback tests.
2. **Geometry port.** Golden tests prove the ported outlines equal today's,
   command for command.
3. **Renderer.**
   - Rasteriser, dry and live layers, scheduler, zoom placeholders.
   - A fidelity diff against js-draw.
   - The render gates.
4. **Input and core tools.**
   - Pen, highlighter, both erasers, scribble-erase, straightening, the eraser
     end, undo, redo and clear.
   - `NotebookInkEditor` on `InkSurface`, in notebooks and the exam sheet.
   - The owner's first iPad round.
5. **Saving and every reader.** Format, drafts, limits, the server, thumbnails,
   swipes and exam working.
6. **New tools.** Lasso, shapes on hold and the ruler. The owner's second iPad
   round.
7. **Performance.**
   - A worker renderer, only if the gates need it.
   - PDF detail under the engine scheduler.
   - The memory budget.
   - The owner's third iPad round.
8. **Release and cleanup.**
   - `enableJamiInk` on for everyone.
   - After two weeks without a rollback: stop the SVG copy, and delete
     js-draw, `@js-draw/math`, its CSS, the glue modules and their tests.
   - Update the README, `architecture.md`, `manual-qa.md` and `llms.txt`.

## Verification

- **Unit.** Unit and golden tests for every `lib/ink` module. A full
  `npm test`, typecheck, lint, `check:sizes` and build at each stage.
- **Browser.**
  - The fidelity and lift diffs.
  - The perf harness gates, headless and on the GPU.
  - The notebook smoke, sheets and exam specs, offline draft restore, and the
    fallback flag.
- **The owner on iPad** (the notebook section of `docs/manual-qa.md`):
  - rapid strokes, dots, sharp corners, long strokes;
  - both erasers and tool switching;
  - a palm on the glass;
  - pinching and panning zoomed in;
  - ruled, grid, dot and PDF pages; swipes;
  - the highlighter under ink;
  - lasso, shapes and ruler;
  - exam working and its marking image;
  - old pages;
  - the flag turned off.
- **Separately.** Desktop mouse and a touchscreen pen.
