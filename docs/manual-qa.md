# Jami Manual QA Checklist

Use this checklist after changes to the learning-loop MVP. Phase 6.1 removes the legacy question-bank Practice architecture. The active Practice model is now:

**Folder -> Notebook -> Pages -> Working**

Practice sets, papers, AI-created drills, uploaded papers, and blank working books should appear as notebook templates rather than separate main product areas.

## Core Loop Regression

1. Create or open a deck.
2. Add at least one flashcard to the deck.
3. Review or study the card in Learn.
4. Open Practice and confirm the main surface is Continue working plus Folders.
5. Open a notebook and save typed or drawn working.
6. Add or open a saved source.
7. Generate a flashcard draft from the source and approve it into a deck.
8. Generate a practice-question draft from the source and approve it into a notebook page.
9. Check Today for notebook, folder, review, and draft actions.
10. Check Progress for weak cards/topics plus linked folder/notebook/source context.

## Phase 6.1 Notebook-First Practice

1. Open `/dashboard/practise`.
2. Confirm user-facing copy says `Practice`, not `Practise`.
3. Confirm the visible default sections are `Continue working` and `Folders`.
4. Confirm there is no old question bank, topic drill, standalone Add question form, answer field, working field, confidence block, old Tutor attempt panel, or tiny scratchpad side feature.
5. Confirm no user is forced into an unclosable create-question screen.
6. Open a Continue working notebook.
7. Use the icon toolbar to add a text box on the page and save.
8. Draw on the page where the full editor is available.
9. Open the pen dropdown and switch ink colours: black, white, red, green.
10. Switch between Pen and Eraser.
11. Test Undo and Clear; Clear should affect only the current page drawing.
12. Confirm notebook creation offers only white or black default page colour.
13. Add a new page and confirm it inherits the notebook default page colour.
14. Navigate between pages and confirm the bottom-left counter updates.
15. Delete a non-final page and confirm the remaining pages renumber cleanly.
16. Save, reload, and confirm typed/stroke/page state survives where persistence is supported.
17. Confirm the notebook page is the main working surface.

## Phase 7 Notebook Editor V2

1. Open `/dashboard/notebooks/notebook-photosynthesis?agent=1` or any signed-in notebook.
2. Confirm the editor opens as an immersive notebook workspace rather than a dashboard card stack.
3. Confirm the toolbar is icon-first with accessible labels/tooltips for Pages, Text, Pen, Eraser, Undo, Clear, Settings, AI, Add Page, and Save.
4. Confirm the page is long and paper-like, not a short landscape card.
5. Create and move a text box directly on the page.
6. Draw with mouse/stylus and confirm strokes save/reload.
7. On iPad/tablet, draw with stylus and swipe pages with a finger while Pen is active.
8. Confirm finger swipes do not create ink and stylus strokes do not navigate pages.
9. Open the AI icon and confirm it is only a placeholder drawer with no AI call.
10. Confirm the page has no extra glassy frame outside the paper surface.
11. In portrait, confirm the page sits with balanced vertical spacing and does not leave a large dead gap underneath.

## Device Strategy

1. Desktop width: notebook editor should expose full page, pen, eraser, colour, page, and save controls.
2. Tablet/iPad width: notebook editor should remain usable as a full workspace.
3. Phone width: notebook route should show `Notebook editing works best on iPad or desktop.`
4. Phone width: users can view pages and add light typed notes.
5. Phone width: full controls should be deliberately unlocked with `Continue anyway` where implemented.
6. Mobile Learn/flashcards should remain clean and not crowded by notebook controls.
7. Mobile Today and Progress should remain readable and action-first.

## Folders

1. Open `/dashboard/folders`.
2. Confirm folders are broad study spaces, not topics.
3. Create a folder such as Biology, History, Spanish, Computer Science, or Art History.
4. Optionally link existing topics such as Enzyme activity or Cold War causes.
5. Open the folder detail page.
6. Confirm the folder feels like a study space and uses tabs for Notebooks, Decks, and Sources.
7. Confirm there is no separate main `Practice sets` or `Past papers` section.
8. Confirm the notebook template picker offers:
   - Blank notebook
   - Uploaded file / paper notebook
   - AI-created questions notebook
9. Confirm AI-created questions are clearly a placeholder.
10. Open the Decks tab and confirm it shows only decks already in this folder.
11. Use `Add existing deck` to choose a global deck and confirm it appears in the folder.
12. Confirm there is no deck creation form inside the folder Decks tab; new decks are created from global Decks.
13. Use `Remove` on a folder deck and confirm it leaves the folder without deleting the global deck.
14. Open the Sources tab and confirm it shows only sources already in this folder.
15. Use `Add existing source` to choose a saved source and confirm it appears in the folder.
16. Use `Create source` inside the folder and confirm the source also appears globally in Sources.
17. Use `Remove` on a folder source and confirm it leaves the folder without deleting the saved source.
18. Open `Edit folder`, rename it, change colour/icon, and archive it only after confirming the warning says decks and sources are not deleted.
19. Open a notebook and use `Edit notebook` to rename it, change cover colour/icon, and archive it safely.
20. Confirm Cards do not expose folder linking directly; cards inherit folder context through decks.

## Object Browser Polish

1. Confirm folder cards show only a folder object and folder name.
2. Confirm folder cards do not show notebook/deck/source counts, topic counts, descriptions, or stats.
3. Confirm notebook cards show a notebook object, title, and at most one tiny metadata line.
4. Confirm the weird white circular icon backing does not appear on folders or notebooks.
5. Confirm folder/notebook icons sit visually balanced on the object, not low on the cover.
6. Confirm folder and notebook grids feel compact on desktop/tablet and do not become giant dashboard blocks.

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
2. Confirm the route map links to Today, Learn, Practice, Folders, Notebook, Sources, Cards, Decks, Progress, and Account.
3. Open `/llms.txt` and confirm it lists the same notebook-first route map in plain text.
4. Open `/dashboard?agent=1` while signed out.
5. Confirm it does not redirect to auth.
6. Open `/dashboard/practise?agent=1`.
7. Confirm Practice is notebook-first and local-only.
8. Confirm the old question bank, old attempt form, confidence block, and old Practice Tutor flow do not appear.
9. Open `/dashboard/notebooks/notebook-photosynthesis?agent=1`.
10. Type, save, add a page, and confirm local-only page navigation.
11. Open `/dashboard/folders?agent=1` and confirm public folders are balanced across subjects.
12. Open Sources and approve a practice draft into a local notebook page.
13. Confirm all public actions are labelled or behave as local-only simulations.
14. Confirm there are no Firebase permission errors in the browser console.

## Sources Loop

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
12. Confirm the approved draft creates a notebook page, not a `users/{uid}/questions` document.
13. Check Today for source-linked draft actions.
14. Check Progress for linked source recommendations on weak topics.
15. On mobile/tablet widths, confirm Sources uses Sources/Source/Actions navigation without horizontal scroll.

## Today And Progress

1. Open Today and confirm one dominant recommended action.
2. Confirm Today can recommend continuing a recent notebook when notebook activity exists.
3. Confirm Today still prioritises due cards, drafts, weak topics, goals, folders, decks, and sources appropriately.
4. Confirm Today does not depend on legacy questions or attempts.
5. Open Progress and confirm weak topics can point to linked folders, notebooks, cards, and sources.
6. Confirm Progress stays narrow and constructive rather than becoming folder analytics.
7. Confirm Progress does not show old recent mistakes, practice accuracy, support level, retry question, or question-bank Tutor copy.

## Flashcard AI De-Scope

1. Open Cards or a Deck detail page.
2. Confirm normal card creation does not show AI answer autocomplete when `enableFlashcardAi` is false.
3. Confirm `/api/ai/autocomplete-card` returns disabled when the flag is false.
4. Confirm source-generated flashcard drafts still work.
5. Confirm flashcard review remains fast and not AI-centred.

## Authenticated Checks

1. Sign in with a normal account.
2. Confirm the dashboard uses real Firebase-backed data.
3. Confirm existing decks, cards, reviews, goals, folders, notebooks, Sources, and study modes still work.
4. Confirm old cards without topics still display and review normally.
5. Confirm a generated flashcard draft can be saved.
6. Confirm adding a saved draft to a deck creates a real card and marks the draft approved.
7. Confirm adding a practice-question draft creates a notebook page and marks the draft approved.
8. Confirm private write actions obey auth and Firestore rules.
9. Confirm uploaded notebook files obey Storage rules.

## Regression Boundaries

1. `/demo` should still point users into the public dashboard walkthrough.
2. `/dashboard` should remain public-readable when signed out.
3. Public walkthrough components must not call private Firestore services.
4. `/agent` and `/llms.txt` should remain public and must not expose private user data.
5. Sources, folders, notebooks, source Tutor, and generated drafts are allowed.
6. Do not expose OCR, PDF parsing, PDF annotation, file AI, full-paper mode, browser extension, always-on screen watching, advanced voice tutor, or advanced analytics.
