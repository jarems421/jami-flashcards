# Jami Manual QA Checklist

Use this checklist after changes to the learning-loop MVP. Phase 6 makes Practice notebook-first:

**Folder -> Notebook -> Pages -> Working**

Practice sets, papers, AI-created drills, and blank working books should now appear as notebook templates rather than separate main product areas.

## Core Loop Regression

1. Create or open a deck.
2. Add at least one flashcard to the deck.
3. Review or study the card in Learn.
4. Open Practice and confirm the main surface is Continue working plus Folders.
5. Open a notebook and save typed or drawn working.
6. Use the tucked-away Legacy questions flow only as compatibility coverage.
7. Ask Tutor for a hint from the legacy flow and confirm it still works.
8. Ask Tutor to make a flashcard draft and confirm it is a draft, not a real card yet.
9. Add the draft to a chosen deck.
10. Check Progress for weak topics, recent mistakes, support level, drafts, and linked folder/notebook/source context.

## Phase 6 Notebook-First Practice

1. Open `/dashboard/practise`.
2. Confirm user-facing copy says `Practice`, not `Practise`.
3. Confirm the visible default sections are `Continue working` and `Folders`.
4. Confirm the old question bank is not central and is behind a `Legacy questions` disclosure.
5. Confirm no user is forced into an unclosable create-question screen.
6. Open a Continue working notebook.
7. Type content into the notebook page and save.
8. Draw on the page.
9. Switch pen colours: black, white, red, green.
10. Switch between Pen and Eraser.
11. Test Undo and Clear.
12. Change page colour: white, black, grey.
13. Add a new page.
14. Navigate between pages.
15. Save, reload, and confirm typed/stroke/page state survives where persistence is supported.
16. Confirm the notebook page is the main working surface, not a tiny scratchpad underneath a form.
17. Confirm there are no answer/working/confidence fields in the main notebook editor.

## Device Strategy

1. Desktop width: notebook editor should expose full page, pen, eraser, colour, page, and save controls.
2. Tablet/iPad width: notebook editor should remain usable as a full workspace.
3. Phone width: notebook route should show `Notebook editing works best on iPad or desktop.`
4. Phone width: users can view pages and add light typed notes.
5. Phone width: full controls should be deliberately unlocked with `Continue anyway`.
6. Mobile Learn/flashcards should remain clean and not crowded by notebook controls.
7. Mobile Today and Progress should remain readable and action-first.

## Folders

1. Open `/dashboard/folders`.
2. Confirm folders are broad study spaces, not topics.
3. Create a folder such as Biology, History, Spanish, or Computer Science.
4. Optionally link existing topics such as Enzyme activity or Cold War causes.
5. Open the folder detail page.
6. Confirm the folder feels like a study space and shows Notebooks, Decks, Sources, Recent activity, and legacy question records.
7. Confirm there is no separate main `Practice sets` or `Past papers` section.
8. Confirm the notebook template picker offers:
   - Blank notebook
   - Uploaded file / paper notebook
   - AI-created questions notebook
9. Confirm AI-created questions are clearly a placeholder.
10. Link an existing deck to the folder and confirm it still appears globally in Decks.
11. Link an existing source to the folder and confirm it still appears globally in Library.
12. Link an existing question to the folder only as legacy compatibility.
13. Confirm Cards do not expose folder linking directly; cards inherit folder context through decks.

## Uploaded-File Notebook

1. From a folder detail page, choose `Uploaded file / paper notebook`.
2. Upload a PDF, JPEG, PNG, or WebP under 20 MB.
3. Confirm the notebook is created with type `uploaded_file`.
4. Confirm file metadata is saved with a user-scoped storage path.
5. Confirm the notebook editor shows a file chip/card.
6. Confirm copy says: `File saved. Full paper annotation comes later.`
7. Confirm the UI does not claim PDF rendering, OCR, handwriting recognition, image AI, automatic reading, or annotation.
8. Confirm public walkthrough simulates uploaded-file notebooks locally and does not write to Firebase.

## Public Walkthrough And Agent Routes

1. Open `/agent` while signed out.
2. Confirm the route map links to Today, Learn, Practice, Folders, Notebook, Library, Cards, Decks, Progress, and Account.
3. Open `/llms.txt` and confirm it lists the same notebook-first route map in plain text.
4. Open `/dashboard?agent=1` while signed out.
5. Confirm it does not redirect to auth.
6. Open `/dashboard/practise?agent=1`.
7. Confirm Practice is notebook-first and the legacy question flow is collapsed.
8. Open `/dashboard/notebooks/notebook-photosynthesis?agent=1`.
9. Type, draw, erase, change colours, save, add a page, reload, and confirm local-only persistence.
10. Open `/dashboard/folders?agent=1` and confirm public folders are balanced across subjects.
11. Confirm all public actions are labelled or behave as local-only simulations.
12. Confirm there are no Firebase permission errors in the browser console.

## Library Loop

1. Open `/dashboard/library`.
2. Add a pasted source or manual note.
3. Link it to an existing topic and folder where available.
4. Ask Tutor about the selected source.
5. Confirm the reply starts from source context and separates outside context if needed.
6. Generate flashcard drafts from the source and confirm the batch stays small.
7. Confirm each draft is labelled as based on the selected source.
8. Edit one draft and approve/add it to a deck.
9. Confirm the card appears in Learn/Cards with source link preserved.
10. Generate practice question drafts from the source and confirm each has an expected answer.
11. Edit and approve one practice draft.
12. Confirm the approved question remains available to legacy Practice and can later feed notebook work.
13. Check Today for source-linked draft actions.
14. Check Progress for linked source recommendations on weak topics.
15. On mobile/tablet widths, confirm Library uses Sources/Source/Actions navigation without horizontal scroll.

## Legacy Practice/Tutor Regression

1. Open `/dashboard/practise` with at least one practice question.
2. Expand `Legacy questions`.
3. Type an answer and several lines of working without saving the attempt.
4. Click `I'm stuck here` and confirm Tutor uses current question/working without asking you to paste it.
5. Highlight text inside the Working textarea, then click `Ask about selected text`.
6. Confirm the reply focuses on selected text and gives the next step only.
7. Click `Check my working` and confirm Tutor identifies the first uncertain or incorrect step.
8. Open Working tools and draw on the local canvas.
9. Confirm Tutor does not claim it can read handwriting unless a typed note/transcript is supplied.
10. Record or type a short voice transcript fallback and send it to Tutor.
11. Save an attempt and confirm the session summary updates attempts, correct count, Tutor uses, drafts, weakest topic, and next action.

## Today And Progress

1. Open Today and confirm one dominant recommended action.
2. Confirm Today can recommend continuing a recent notebook when notebook activity exists.
3. Confirm Today still prioritises due cards, mistakes, drafts, weak topics, and goals appropriately.
4. Open Progress and confirm weak topics can point to linked folders, notebooks, and sources.
5. Confirm Progress stays narrow and constructive rather than becoming folder analytics.

## Flashcard AI De-Scope

1. Open Cards or a Deck detail page.
2. Confirm normal card creation does not show AI answer autocomplete when `enableFlashcardAi` is false.
3. Confirm `/api/ai/autocomplete-card` returns disabled when the flag is false.
4. Confirm source-generated flashcard drafts and Tutor-generated flashcard drafts still work.
5. Confirm flashcard review remains fast and not AI-centred.

## Authenticated Checks

1. Sign in with a normal account.
2. Confirm the dashboard uses real Firebase-backed data.
3. Confirm existing decks, cards, reviews, goals, folders, notebooks, Library, and study modes still work.
4. Confirm old cards without topics still display and review normally.
5. Confirm a generated flashcard draft can be saved.
6. Confirm adding a saved draft to a deck creates a real card and marks the draft approved.
7. Confirm private write actions obey auth and Firestore rules.
8. Confirm uploaded notebook files obey Storage rules.

## Regression Boundaries

1. `/demo` should still point users into the public dashboard walkthrough.
2. `/dashboard` should remain public-readable when signed out.
3. Public walkthrough components must not call private Firestore services.
4. `/agent` and `/llms.txt` should remain public and must not expose private user data.
5. Library, folders, notebooks, and Phase 4 contextual Tutor tools are allowed.
6. Do not expose OCR, PDF parsing, PDF annotation, file AI, full-paper mode, browser extension, always-on screen watching, advanced voice tutor, or advanced analytics.
