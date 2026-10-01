# Diagram cards (image occlusion)

A student adds a picture, such as a heart, a cell, a map or a lecture slide, and
covers its labels. By default the diagram is **one card**: every label covered,
uncovered one at a time to check, then rated once. A student can instead choose
**a card for each label**, each on its own schedule (Anki's "Hide all, guess
one"), and switch either way later.

## How a student uses it

1. **Add a picture.** From the *Diagram* tab of *Add cards* (on a deck page or
   the Cards page): choose a file, take a photo (touch devices), paste a
   screenshot, drop a file, or pick a page from a PDF in the Library. Photos are
   scaled to 2,400px on the long edge before upload. A PDF page opens in the
   crop step.
2. **Crop** (optional, for new pictures). Drag across the diagram to frame it.
   After saving a cropped diagram, *Crop another from it* opens the same page
   or picture again, so one slide with three diagrams becomes three diagrams.
3. **Cover the labels.** Pick a tool, then work on the picture:
   - **Box** or **Oval**: drag to draw. A tap drops a box shaped like a label,
     which is the quickest way on a phone. Tapping an existing box selects it.
   - **Trace an outline**: draw round an irregular part (a lobe, a bone) with a
     finger, pen or mouse. The path is simplified to at most 64 points and
     becomes a polygon, which moves and resizes like a box.
   - **Move**: drag a box to move it. Dragging empty picture pans when zoomed.
   - The selected box has corner handles in every tool.
   - Undo and redo cover boxes, label text, groups and found labels. A drag
     undoes in one step, and so does typing one label.
   - Keyboard: B, O, F and V switch tools. Arrows nudge the selected box
     (hold Shift to move further). Delete removes it. Esc deselects.
     Ctrl/Cmd+Z undoes, and Shift+Ctrl/Cmd+Z or Ctrl+Y redoes. +, - and 0 zoom.
   - **Find the labels for me** (cover mode, when flashcard AI is on) asks the
     AI to box every printed label and fill in its words. See *Finding printed
     labels* below.
4. **The label list** is one row per box: its number, its name, and remove.
   In *name the parts* each row asks for the part's name. In *cover them* a row
   shows a name only when it has one (found by Jami, or from before), so it can
   be corrected; otherwise the picture says it, and nothing is asked.
5. **How do you want to study it?** (two or more labels): *One card* (the
   default) or *A card for each label*. Changing it on a saved diagram replaces
   its cards, and the editor says their review history starts again.
6. **Preview** steps through every card as it will be studied. Then **Save**.

The editor used to offer, per label, other accepted answers, a note, a line to
the part and extra boxes, and per diagram, groups asked together, a question,
"hide all / hide just that one" and line ends. They made a two-minute job feel
like a form and are no longer shown. A diagram saved with any of them keeps
them, and they still work in study.

*Label again* on the deck page reuses a saved diagram's picture for a second,
separate set of labels, such as the same heart for blood flow instead of
chambers. The two diagrams share the stored picture.

Works on phone, iPad and desktop. On a phone the list sits under the picture,
and on a large screen beside it.

## The two kinds of picture

| Setting | When | How a label is drawn | Label text |
| --- | --- | --- | --- |
| **Cover them** (`cover`) | The picture prints its labels | A solid box hides the printed word; revealing the card uncovers it | Optional. Unnamed labels can only be flipped |
| **Name the parts** (`name`) | The picture has no labels | An outline around the part; the name is written beside it on reveal | Required |

**Lines.** In *name the parts*, a label with a line becomes a *label slot*.
The student puts the box in the margin, the way a textbook does, and the line
points at the structure. When studying, the slot shows "?" and the line shows
exactly what is being asked; revealing the card writes the name inside the
slot. With "hide all", the other slots stay blank but keep their lines, so the
card reads like a fill-in-the-labels worksheet. A label without a line keeps
the ring-around-the-part style. In *cover*, a line points from the covered
label to its part. The asked label's line is always drawn on top.

`describeOcclusionMask` in `lib/study/image-occlusion.ts` is the single table of
what each label draws in each state (box style, words inside or beside, line,
and the amber *confused* look). The study card, the walkthrough and the tests
all use it.

A diagram hides every other label while one is asked. Older diagrams may have
been saved with "Hide just that one", which still applies to them. Multiple
choice always hides every other label, because those labels are its options.

## Studying

Every diagram card goes through the ordinary study pipeline (FSRS, Learning
Engine evidence, offline queue). No special path exists.

- **One card for the whole diagram** is a group of every label (the reserved
  group `whole-diagram`, never shown as a group in the editor). The front has
  every label covered and each box can be tapped to uncover it, "Tap a label to
  check it (2 of 13)"; tapping anywhere else turns the card, which shows every
  label, and it is rated once. Flip only. Its strength colours every box on the
  deck page.

- **Flip:** the box is highlighted as the question, then uncovered. The back has
  *Show every label*, which works like Anki's *Toggle masks*.
- **Type the answer:** marked against the label's words and its other accepted
  answers, like any short answer. Available when the label has words.
- **Multiple choice:** the wrong options are the diagram's other labels. This is
  the one place options are borrowed rather than written for the card (see
  `getDiagramDistractorPool`): a diagram's other labels are the same kind of
  thing and are its real confusions. Accepted answers are never used as wrong
  options. The card needs three other named labels whose length is close to the
  answer's, otherwise it is not asked this way.
- **Group cards** are flip only (`diagram-group` in `mode-eligibility.ts`): the
  prompt names how many labels to give, and the back lists them all.
- **Gap fill:** never, since a label is too short to gap.
- Diagram cards are never sent for AI preparation. Everything is deterministic.
- **Zoom:** the study card has a magnifier. The zoom view takes pinch, scroll,
  double-tap and the +/- buttons; a drag never counts as a tap on a box.

**Mix-ups.** When a typed or chosen answer is exactly another label on the same
diagram, the answer is wrong outright, without asking the AI to check it,
however many words it shares with the right one ("right atrium" for the left
atrium). The reveal outlines the label the student named in amber, next to the
one asked, and says which is which. The review event records the other label's
id as `confusedWithLabelId` (see *Data model*).

**Go over it** on the deck page covers every label and lets the student uncover
them one at a time, by tapping or in order. This is practice only and never
changes a schedule. *Show strength* colours each box by how well that label is
known, and *Often mixed up* lists the pairs the student confuses most.

**Strength** (`lib/study/card-strength.ts`) is one of four words, from the card's
own schedule: *strong* (green), *building* (amber), *needs focus* (red) or *not
studied yet* (grey). A card never reviewed is never called weak. The deck page's
diagram thumbnails use the same colours.

## Finding printed labels

On demand only: the student presses *Find the labels for me*. Nothing runs when
a picture is added.

- The picture (JPEG, at most 1,600px) goes to `POST /api/ai/diagram-labels`,
  which asks the `documentVision` model for each printed label's words and box.
  A stored picture is read from Storage by path, and only under the student's
  own `cardImages` folder.
- `parseDetectedLabels` (`lib/study/diagram-label-detection.ts`) drops boxes
  that are too big to be a label, too long to be one, or duplicates, and strips
  list numbers ("1.") from the words.
- `labelsFromDetections` leaves out anything already covered, so asking twice
  never boxes a word twice. Everything found lands as ordinary labels, in one
  undo step, and the student is told to check them.
- Nothing about the picture or the answer is stored. The budget action is
  `diagramLabelDetection` (25 a day, 4 a minute), refunded if the call fails.

## Importing from Anki

An `.apkg` with image occlusion notes (Anki 23.10 and later) imports them as
diagrams alongside the ordinary cards
(`lib/study/import/anki-occlusion.ts`).

- Each cloze number becomes one label; shapes sharing a number become one label
  with several boxes. Rectangles, ellipses and polygons all carry over.
- `oi=1` becomes "Hide all labels". The header becomes the diagram's question,
  and *Back Extra* becomes each label's note.
- Anki never names what is under a box, so labels arrive covered and unnamed.
  They can be flipped straight away, and named later to be typed.
- Both media formats are read: the older JSON index and the newer
  zstd-compressed one. Some older builds wrote pixels rather than fractions;
  any value past 1.5 means the whole note is read as pixels.
- A note whose picture is missing from the package is counted and reported,
  with a hint to export again with *Include media* ticked. At most 200 diagrams
  come in per file.

## Offline

Diagram pictures are cached for offline study, since a diagram card without
its picture is useless.

- A few seconds after a study session loads, `keepCardPicturesForOffline`
  fetches the pictures of the session's soonest cards (at most 120) into the
  `jami-card-images-v1` cache, and drops cached pictures the session no longer
  needs. Each picture's download URL is remembered locally.
- The service worker (`public/sw.js`) tries the network for card pictures
  first, and serves the cached copy when the network fails.

## Data model

`Card.occlusion = { diagram, labelId }` or `{ diagram, groupId }`
(`lib/study/image-occlusion.ts`).

- `diagram.cardStyle` is `"whole"` for one card, or absent for a card per label
  (every diagram saved before the choice). `groupsForCardStyle` and
  `getDiagramTargets` derive the cards from it on every save, so what is stored
  always matches the cards that exist.

- Each card carries a copy of the whole diagram, not a reference to it. Anything
  that already handles cards (offline study, saved sessions, moving decks, the
  answer-check route) then handles diagram cards with no extra read.
- `card.back` is the label's words (possibly empty), or a group's words joined
  with "; ". `card.front` is the diagram's optional question, shared by all its
  labels.
- A shape is a rectangle, an ellipse or a polygon. Positions are fractions of
  the picture; a polygon's points are fractions of its own box, so it moves and
  resizes with the box. A label's line has a tip and an optional bend.
- The picture is a normal card image under `users/{uid}/cardImages/`, so the
  existing Storage rule covers it. Several diagrams can share one picture
  (*Label again*). A picture is deleted only when no card on any diagram still
  uses it (`isPictureUsedElsewhere`).
- **Invariant:** a diagram's labels and groups are exactly those that still have
  a card. `releaseDiagramLabels` (`services/study/image-occlusion.ts`) runs
  after every delete path (single, bulk, deck delete). It removes the deleted
  labels from the remaining cards, drops them from groups, deletes a group card
  left with fewer than two labels, and frees the picture when nothing uses it.
- **Saving** (`saveDiagram`) uploads the picture first, then writes every card
  in one batch. A label or group keeps its card, and so its review history,
  however its box or words change (`planDiagramSave`). If the write fails, the
  upload is removed. If it succeeds, any replaced picture is removed.
- The content hash includes the diagram, so a saved exercise goes stale when a
  neighbouring box or label changes.
- **Mix-up evidence:** a flashcard review event may carry `confusedWithLabelId`,
  an id and nothing else, and only when the answer was wrong. `firestore.rules`
  enforces both (at most 64 characters, only with `correct == false`).
  `loadDiagramConfusionEvents` reads a diagram's mix-ups with the
  `cardId` + `confusedWithLabelId` index in `firestore.indexes.json`, which has
  to be deployed.

Limits: 60 labels, 12 groups and 6 boxes per label per diagram; 64 points per
outline; 120 characters per label, 60 per accepted answer, 80 per group name
and 300 per note.

## Out of scope

- Running label detection, or any other reading of the picture, in the
  background. It runs only when the student asks, and keeps nothing.
- Exporting as text: diagram cards are left out of the deck's TSV/CSV export,
  with a message explaining why.
- Exporting diagrams back to Anki.
