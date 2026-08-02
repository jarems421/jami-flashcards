# Jami manual test script

Everything on this list is live on `main`. The unit suite (1,180 tests), the
build, and an emulator-backed browser suite against a production build all
pass, but "the tests pass" and "it works on a real device" are different
claims, and the items below only have the first.

**What is already covered automatically** (do not redo these by hand):
`npm run test:e2e` drives a signed-in browser through notebook autosave,
drawing, toolbar docking, reload, and back-navigation, plus the study review
loop and the security headers — at desktop, tablet, and phone widths. What it
cannot cover is anything needing an Apple Pencil, anything where the failure
is "looks wrong" rather than "throws", and anything only visible in
production logs.

**Verified on iPad as of 2026-07-31:** notebook writing feel after the ink
controller extraction, and undo ordering across ink and text boxes. Both need
re-checking — the ink loading and saving path changed underneath them since.

Ordered by blast radius, not by feature. The first sections can break screens
that have nothing to do with AI, so start there even though they look boring.

Check at three widths where layout is involved: **desktop ~1440px**,
**tablet ~820px**, **phone ~390px**.

A failure to watch for everywhere: **an equation that makes the whole page
scroll sideways.** Long equations must scroll inside their own box.

---

## 0. Do this first: open the browser console and leave it open

A Content-Security-Policy went live in Report-Only mode. Every violation it
reports is free data, and collecting it is the whole point of this pass.

Report-Only messages read like *"would have been blocked"* or *"Refused to …
(report only)"*. **These are not failures.** They are the list of what must be
added to the policy before the rest of it can be enforced. Copy any you see,
along with the page you were on.

An actual red error with no "report only" qualifier **is** a failure — that
means one of the enforced directives bit.

---

## 1. Sign-in and page loading — widest reach

Four directives are enforced rather than merely reported: `frame-ancestors`,
`object-src`, `base-uri` and `form-action`. A mistake in these breaks screens
with nothing to do with any feature, which is why this is first.

### 1.1 Google sign-in

The riskiest interaction with the new headers, because `form-action 'self'` is
enforced and the auth handshake leaves the origin.

- Sign out completely, then sign in with Google
- ✅ Redirects out, comes back signed in, lands on the dashboard
- ❌ Blank page, a console error naming `form-action`, or a redirect loop
- Repeat once on **phone width** — the redirect flow differs from the popup

### 1.2 Hard reload on several pages

Hard reload (Ctrl/Cmd+Shift+R) on: dashboard, a deck, study, library, a
notebook, profile.

- ✅ Every page renders fully, styled, with its data
- ❌ Unstyled text, missing images or icons, or a page that renders empty

### 1.3 The installed app

- ✅ The PWA still installs, or still opens if already installed
- ✅ Profile → the test notification button still delivers
- ❌ The service worker fails to register (the console will say so)

---

## 2. The notebook ink split — highest data-loss risk

Page ink moved out of the page record into its own document. **Pages saved
before that change keep their ink inline and are converted the first time you
save them.** That conversion is the riskiest operation in the app right now,
so test it deliberately rather than incidentally.

### 2.1 An old notebook still opens with its ink

Find a notebook with real drawing on it from **before today**.

- ✅ Every page shows exactly the ink you remember, on the right pages
- ❌ A blank page where you drew, or ink appearing on the wrong page

### 2.2 The conversion moment

In that same old notebook: **add one new stroke to a page that already had
ink**, let it save, then reload.

- ✅ Both the old ink and the new stroke are there after the reload
- ❌ The old ink is gone and only the new stroke survived — **stop and say so
      immediately**, this is the failure the section exists for

Repeat on a second page of the same notebook.

### 2.3 Blank pages stay blank

- ✅ A page you never drew on is still empty after navigating away and back
- ❌ A faint, low-resolution version of a drawing appears on it — that would be
      the thumbnail digest being loaded as if it were ink

### 2.4 Fast page navigation

Move through pages faster than they can load.

- ✅ Pages settle on the right ink; none end up blank
- ❌ Ink from one page briefly painted onto another

### 2.5 A large notebook

```
node scripts/seed-large-notebook.mjs --pages 100 --yes
```

- ✅ Opens in reasonable time rather than fetching all 100 pages
- ✅ Jumping to page 50, then 90, stays responsive
- Delete the notebook afterwards — that removes everything the script created

### 2.6 Apple Pencil, on the iPad

The part no suite can reach.

- ✅ Writing feels immediate, with no lag building over a long page
- ✅ Palm rejection still works
- ✅ Undo steps back through ink and typed text in the order you did them
- ❌ Undo jumps out of order, or removes something you did not do last

---

## 3. The AI pipeline — all three routes changed

Behaviour should be identical; only logging was added. That is exactly the
kind of change that looks safe and is worth ten minutes.

### 3.1 Card autocomplete

Create a card in a maths deck. Front: *"What is the derivative of x cubed?"*
Press **Draft** on the Back label row.

- ✅ A back is drafted, and the **Preview** shows it as rendered maths
- ✅ Save it, then confirm it renders in study, deck detail and the cards list
- ❌ Preview shows raw `$…$`, or no draft returns at all

### 3.2 Source drafting

Library → a source with real pasted text → **Create from this**.

- ✅ **Light** → around 3 drafts; **Thorough** → around 8, noticeably deeper
- ✅ Follow one through: edit it, pick a deck, add it, confirm it lands there
- ✅ Make twice in a row → the second does not repeat the first's ideas
- ✅ Editing a draft shows "Saving…" then "Saved"; merely selecting one does
      not write

### 3.3 Jami tutor

Notebook → **Jami Tutor**. Ask: *"Explain the chain rule and show me a worked
example, step by step."*

- ✅ Waiting messages progress, then the answer arrives
- ✅ Real notation, not raw `$$…$$`; display maths centred on its own line
- ✅ The Used receipt underneath names what it drew on
- ❓ Does the answer stream in progressively or land all at once? Either is
      worth reporting

Then in a study session, **before flipping a card**:

- ✅ Jami says it cannot see the answer and suggests flipping
- ❌ It gives the answer away, or invents one and presents it as the card's

---

## 4. The new logs — only visible in the deploy

Nothing here shows in the UI. After section 3, open the production logs.

- ✅ Each AI action produced JSON lines carrying `event`, `route`,
      `requestId`, `uid` and `durationMs`
- ✅ A successful one has `event: "request.completed"` with token counts
- ✅ **No card text, source text, or anything you typed appears anywhere in
      them** — redaction works from a list of field names, so this is the
      check that actually matters
- ❌ Any student text at all — tell me the field name and I will add it

If a request failed, its lines should all share one `requestId`, so the model
fallback and the failure read as one story.

---

## 5. Regressions from earlier phases

Not re-checked recently, still worth a pass.

### 5.1 Existing cards still render as they did

`StudyText` routes text through KaTeX and older cards predate that. Find a
card with maths written as Unicode (`x²`, `√`, `·`) rather than `$…$`.

- ✅ Renders as before: superscripts raised, `a/b` as a stacked fraction
- ❌ Literal `x^2`, or a plain slash where a fraction used to be

Check in **study**, **deck detail** and the **cards list**.

### 5.2 Form fields

Click into fields on: add a card, add a source, rename a deck, profile
username, notebook title.

- ✅ On focus the border brightens and the glow sits evenly around it
- ❌ A second outline offset below the field, or no visible focus state

### 5.3 Themes

Profile → Theme. Try **all six**, and on each visit dashboard, a deck, study
and library.

- ✅ Text readable, borders visible, buttons legible on every theme
- ❌ Any surface where text and background are near the same shade
- Watch **Black** especially — separation comes from borders, not shadows
- And **Pink** next to **Purple** — if they read as the same theme, say so

### 5.4 Long equations on phone

In a Jami answer and on a card: *"Show me a really long equation with many
terms."*

- ✅ Scrolls inside its own box
- ❌ The whole page scrolls sideways

---

## Reporting back

Useful details: which surface, what you typed, what you expected, what you
got, and the width.

**Two things are worth more than the rest:** a screenshot of any maths that
renders wrongly, and the exact text of any CSP console message. The second is
what turns the rest of the policy from reported into enforced.
