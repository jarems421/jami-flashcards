# Jami manual test script

Everything on this list is live on `main`. The unit suite, the build, and an
emulator-backed browser suite all pass, but "the tests pass" and "it looks
right" are different claims, and the items below only have the first.

**What is already covered automatically** (do not redo these by hand):
`npm run test:e2e` drives a signed-in browser through notebook autosave,
drawing, toolbar docking, reload, and back-navigation, plus the study review
loop — at desktop, tablet, and phone widths. What it cannot cover is anything
needing an Apple Pencil, and anything where the failure is "looks wrong"
rather than "throws".

**Verified on iPad as of 2026-07-31:** notebook writing feel after the ink
controller extraction, and undo ordering across ink and text boxes.

Ordered by blast radius, not by feature. The first section can break screens
that have nothing to do with AI, so start there even though it looks boring.

Check at three widths where layout is involved: **desktop ~1440px**,
**tablet ~820px**, **phone ~390px**.

A failure to watch for everywhere: **an equation that makes the whole page
scroll sideways.** Long equations must scroll inside their own box.

---

## 1. Regressions — widest reach, check first

### 1.1 Existing cards still render as they did

**The single most valuable check on this list.** `StudyText` now routes text
through KaTeX, and every card in your account predates that.

Find a card created before today with maths in it — one showing Unicode like
`x²`, `√`, `·` rather than `$…$`.

- ✅ Renders exactly as before: superscripts raised, `a/b` as a stacked fraction
- ❌ Shows literal `x^2`, or a plain slash where a fraction used to be

Check it in **study**, **deck detail**, and the **cards list**.

### 1.2 Form fields everywhere

The `.app-field` focus style changed, and that class is on nearly every input
and textarea in the app.

Click into fields on: add a card, add a source, rename a deck, profile
username, notebook title.

- ✅ On focus the border brightens and the glow sits evenly around it
- ❌ A second outline offset below the field, or no visible focus state at all

### 1.3 Themes do not break readability

Profile → Theme. Try **all six**, and on each, visit dashboard, a deck, study,
and library.

- ✅ Text stays readable, borders visible, buttons legible on every theme
- ❌ Any surface where text and background are near the same shade
- Pay particular attention to **Black**: separation comes from borders rather
  than shadows there, so flat or invisible panel edges are the failure
- And **Pink** next to **Purple** — if they read as the same theme, say so

The picker itself: six swatches, three across on phone, tick on the selected
one, and the tick should be visible on both the White and Black swatches.

---

## 2. Things that write data

### 2.1 Drafting from a source

Library → select a source with real pasted text → **Create from this**.

- ✅ Panel opens even with no drafts yet
- ✅ Pick **Light**, press **Make** on Flashcards → around 3 drafts
- ✅ Pick **Thorough**, make again → around 8, and noticeably more detailed
- ❌ Depth makes no difference to count or detail

Then follow one all the way: edit it, pick a deck, add it → ✅ it appears in
that deck. Repeat for a practice question → ✅ it appears as a notebook page.

### 2.2 Draft auto-save

In a draft, edit the Back field and **wait a second without pressing anything**.

- ✅ "Saving…" then "Saved" appears
- ✅ Close the panel, reopen it, select the same draft — your edit is there
- ❌ Edit is lost, or "Saving…" fires on every keystroke

Then click between two drafts without editing.

- ❌ Anything saves. Selecting a draft is not an edit and must not write

### 2.3 Reject

- ✅ The bin icon rejects one draft and it disappears
- ✅ **Reject all** clears the rest
- ✅ Neither asks for confirmation (nothing is deleted, they are marked rejected)

### 2.4 Card autocomplete

Create a card in a maths deck. Front: *"What is the derivative of x cubed?"*
Press **Draft** on the Back label row.

- ✅ A back is drafted, and the **Preview** below shows it as rendered maths
- ✅ Save it, then confirm it renders on the card face in study, deck detail and
      the cards list
- ❌ Preview shows raw `$…$`, or no Preview appears at all

---

## 3. Behaviour changes

### 3.1 Jami cannot see an unflipped answer

Study session → **Jami** button beside the progress bar.

- ✅ The button is a small pill, not a full-width bar
- ✅ Opening it **before flipping** shows the note explaining Jami cannot see
      the answer
- ✅ Ask "just tell me the answer" → it says it cannot see it and suggests
      flipping
- ❌ It gives the answer away, or invents one and presents it as the card's

Then **flip** the card.

- ✅ The drawer closed on flip
- ✅ Reopening shows different starters, and answers now explain directly

Also worth judging: on a card you have failed several times, does the
explanation offer more scaffolding than on an easy one? That is the memory
profile working, and it is a soft signal — judge across a few cards.

### 3.2 Source-first grounding

Library → a source → **Ask Jami about this**. Ask something the source only
partly covers.

- ✅ Teaches from your source first, then extends beyond it
- ✅ Says plainly when it is going past what the source covers
- ❌ Ignores the source, or refuses to go beyond it at all

### 3.3 Conversation focus

After a conversation about a source, open **Create from this**.

- ✅ A checkbox offers to focus on what you discussed
- ✅ With it on, drafts lean towards that part of the source
- ❌ The checkbox appears when you have never spoken to Jami about that source

---

## 4. Polish

### 4.1 Waiting and streaming

Notebook → **Jami Tutor**. Ask: *"Explain the chain rule and show me a worked
example, step by step."* (forces the longest path)

- ✅ "Jami is thinking" appears, then changes to "Cooking something up" around
      4s, "Still going" around 9s
- ✅ Each message animates in once, no continuous bouncing
- ✅ The waiting bubble disappears when the answer starts
- ❓ **Does the answer appear progressively, or all at once?** Either is worth
      reporting — this is the open streaming question, and "all at once" is a
      real possible answer, not necessarily a bug

### 4.2 Maths and spacing in answers

Same drawer: *"Show me the quadratic formula on its own line, and inline show
me x squared plus y squared."*

- ✅ Real notation, a proper fraction bar and √, not raw `$$…$$`
- ✅ Display maths centred on its own line, inline maths on the text line

Then: *"Give me three separate paragraphs and then a bulleted list of four items."*

- ✅ Normal single spacing
- ❌ A blank line between every paragraph and bullet

Then on **phone width**: *"Show me a really long equation with many terms."*

- ✅ Scrolls inside its own box
- ❌ The whole page scrolls sideways

---

## Reporting back

Useful details: which surface, what you typed, what you expected, what you got,
and the width. **A screenshot of any maths that renders wrongly is worth a lot**
— that is the hardest category to describe in words.
