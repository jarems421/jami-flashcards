# Jami AI — manual test script

Everything in this list is something automated tests cannot reach: how it looks,
whether it streams smoothly, and whether maths renders rather than showing raw
`$…$`. The suite passes and the build is clean, but **none of this has been seen
running**.

Run `npm run dev`, sign in, and work down in order. Each check says what to do,
what correct looks like, and what failure looks like.

Check every surface at three widths (`AGENTS.md` requires all three):
**desktop ~1440px**, **tablet ~820px**, **phone ~390px**.

A recurring failure to watch for everywhere: **an equation that makes the whole
page scroll sideways.** Long equations must scroll inside their own box. If the
page itself scrolls horizontally on phone width, that is a bug.

---

## 1. Streaming — Jami Tutor in a notebook

Open any notebook → **Jami Tutor**. Send:

> Explain the chain rule and show me a worked example, step by step.

("step by step" forces DETAILED mode, the slowest path, so streaming is most
visible here.)

- ✅ Text appears progressively, word by word, starting within a second or two
- ✅ **Used: …** appears only once the answer has finished
- ✅ Follow-up chips appear only at the end
- ❌ Nothing for 10+ seconds and then everything at once — streaming is not working
- ❌ Text appears, then visibly changes or reflows at the end — the final
  validated reply disagrees with what was streamed

**Watch the typing indicator.** Three pulsing dots render while loading, and the
streamed answer now appears *above* them. If that reads as cluttered or looks
like two responses, say so — that combination has never been seen and is the
most likely cosmetic problem in this whole session's work.

## 2. Maths rendering

Same drawer. Send:

> Show me the quadratic formula on its own line, and inline show me x squared plus y squared.

- ✅ The quadratic formula renders centred on its own line as real notation —
  a proper fraction bar, a √ sign
- ✅ The inline maths sits on the text line without pushing the line height around
- ❌ Raw `$$\frac{-b \pm \sqrt{b^2-4ac}}{2a}$$` shown as literal text — KaTeX is
  not firing
- ❌ Stray `\frac`, backslashes or `$` visible anywhere in the prose

Then, on **phone width**, send:

> Show me a really long equation with many terms on one line.

- ✅ The equation scrolls left/right inside its own box
- ❌ The whole page scrolls sideways

## 3. Paragraph spacing

Same drawer. Send:

> Give me three separate paragraphs and then a bulleted list of four items.

- ✅ Normal single spacing between paragraphs and between bullets
- ❌ A visible blank line between every paragraph and every bullet — the
  `white-space: pre-wrap` fix has regressed

## 4. Source-first grounding — library

Library → pick a source with real pasted text → **Jami**. Ask something the
source only partly answers, e.g.:

> Explain this topic and how it connects to something the notes do not cover.

- ✅ Jami teaches from your source first, then extends beyond it
- ✅ It says plainly when it is going beyond what the source covers
- ✅ **Used: …** lists the source
- ❌ It ignores the source and answers generically
- ❌ It refuses to go beyond the source at all (that was the old behaviour)

## 5. Drafting — the newly wired flow

**This is brand new and writes records to Firestore. Test it carefully.**

Library → select a source → **Jami** → click **Draft flashcards** on the opening
chips.

- ✅ The chip label changes to "Drafting flashcards…"
- ✅ After a few seconds the drafts review panel opens with drafts listed
- ✅ A success message says how many were drafted, and mentions discarded ones
      if any were filtered out
- ❌ Nothing happens and no error appears
- ❌ The review panel opens empty — the write path and the read path disagree

Then repeat with **Draft practice questions**.

Now follow one draft all the way through:

- Edit a draft, pick a deck, save it as a card → ✅ it appears in that deck
- Save a practice question to a notebook → ✅ it appears as a notebook page

**Known limitation, not a bug:** the drafting chips only show before you send a
message. Once you have asked Jami something they disappear until the drawer is
reopened. Worth deciding whether that is acceptable.

## 6. Card autocomplete — newly enabled

This was switched on this session after being off by default, so it has never
been used in the product.

Create a card in a maths deck. Front:

> What is the derivative of x cubed?

Click **Draft answer with AI**.

- ✅ A back is drafted within a few seconds
- ✅ Any maths in it renders as real notation on the card face
- ❌ The button is missing entirely — the feature flag did not take effect
- ❌ The back shows raw `$…$` or stray backslashes

Then check the same card renders correctly in **all three** places:
study session, deck detail, and the cards list.

## 7. Learn tutor — restored to the study page

Start a study session. An **Ask Jami** button now sits next to the progress bar.

**Before flipping**, open it and click **Gentle clue**.

- ✅ You get a hint that does *not* reveal the answer
- ✅ The chips offered are Gentle clue / Stronger clue / Quiz my thinking
- ❌ It gives the answer away — the phase is not reaching the model

**Flip the card**, reopen, and check the chips changed to Explain simply / Give
an example / What might I mix up?

- ✅ The drawer closed when you flipped (it should not stay open across a flip)
- ✅ After flipping, answers explain directly rather than hinting

On a card you have failed several times, ask for an explanation:

- ✅ The answer offers more scaffolding than on an easy card — this is the FSRS
  memory profile working. Softer signal; judge it across a few cards.

## 8. Regression check — existing cards

**The most important check in this list**, because it is the one risk no
automated test can confirm looks right.

Find a card created *before* today with maths in it — one showing Unicode like
`x²`, `√`, `·` rather than LaTeX.

- ✅ It renders exactly as it did before, superscripts and fractions intact
- ❌ It now shows literal `x^2` or a raw `/` where a stacked fraction used to be

Check it in study, deck detail, and the cards list.

---

## Reporting back

For anything that fails, the useful details are: which surface, what you typed,
what you expected, what you got, and the width. A screenshot of any maths that
renders wrongly is worth a lot — that is the hardest category to describe in
words.
