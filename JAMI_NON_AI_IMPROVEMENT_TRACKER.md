# Jami Non-AI Improvement Tracker

> **Archived planning snapshot (6 June 2026).** This document records the
> decisions and status labels used during the non-AI improvement phase. It is
> useful history, but it is no longer the active backlog or a source of truth for
> current implementation status.

Generated from the user-supplied non-AI improvement plan and re-audited against the
current app on 6 June 2026.

Status values:

- `todo`: still needed and not meaningfully implemented.
- `partial`: implemented in part, but the full intended experience is not complete.
- `done`: present in the current app and covered well enough to leave the active backlog.
- `blocked`: cannot be completed until an external dependency or product decision changes.
- `deferred`: deliberately retained for a later phase because it exceeds the current scope.

No original UI improvement has been removed. Visual goals such as flatter folder and
notebook objects, calmer page design, better spacing, and precise slider alignment remain
tracked even where the underlying feature already works.

## Corrected Roadmap

### Mini polish batch

These are low-risk UI, copy, responsive, and interaction fixes that do not require data
model changes:

- Make js-draw ink appear correctly in notebook page thumbnails and thumbnail labels.
- Remove remaining "Open notebook" metadata and use page count or edited date instead.
- Preserve the active folder tab and selected notebook page through URL state.
- Make the notebook toolbar easier to use on tablets and smaller laptops.
- Strengthen active notebook-tool styling without changing the toolbar structure.
- Finish pen/highlighter slider thumb centring, contrast, border, and touch-target polish.
- Fix remaining mojibake and encoding errors in user-facing copy.
- Add consistent clear-search and no-results actions to existing search surfaces.
- Add Escape-to-close and focus restoration to existing non-destructive dialogs.
- Continue the visual pass for flatter, calmer folder and notebook objects. This remains a
  real design task and is not considered complete merely because the cards are functional.

### Separate projects

These are valuable, but should not be mixed into a small polish batch:

1. **Notebook V1 completion:** SVG thumbnails, stylus/tablet QA, text-box persistence,
   fit-width, zoom/pan, toolbar responsiveness, page visual design, and immersive layout.
2. **Library management:** search, filters, rename, archive, delete, and clear
   remove-from-folder semantics.
3. **Goals lifecycle:** presets, optional deadlines, edit, cancel/archive, and confirmation.
4. **Cards and decks:** richer filters, compact list view, bulk move/delete, quick actions,
   and consistent deck colour in review.
5. **Reliability foundation:** shared dialogs, async action handling, Firestore
   timeout/retry/stale-result handling, and authenticated browser regression coverage.

### Deferred from the current phase

The following ideas remain in the numbered tracker but should not be pulled into Phase 6:

- PDF parsing, per-page PDF conversion, PDF export, OCR, and full-paper mode.
- Advanced analytics dashboards and speculative disabled preview widgets.
- A global quick-create menu before core folder-first creation flows are stable.
- Broad decorative redesigns that do not solve a usability or reliability problem.

## Batch Status

- [done] Phase 1: Audit and tracker
- [done] Phase 2: Notebook handwriting/editor foundation
- [done] Phase 3: Notebook cards/grid polish
- [done] Phase 4: PDF/image notebook import
- [done] Phase 5: Library/source uploads
- [done] Phase 6: Goals/reminders/deadlines/stars
- [done] Phase 7: Learn/decks/cards/review
- [done] Phase 8: Home/Progress simplification
- [done] Phase 9: General UI polish
- [done] Phase 10: Final QA

## Target Tracker

### A. Notebook editor: handwriting, tools, page behaviour

- [done] 1. Fix iPad stylus writing so Apple Pencil/stylus input works instantly.
- [done] 2. Fix desktop pen drawing so mouse/trackpad drawing actually appears.
- [done] 3. Make quick lift-and-write movements register instantly.
- [done] 4. Make pen strokes smoother and less gritty.
- [done] 5. Add better stroke smoothing for handwriting.
- [done] 6. Make highlighter feel like a real highlighter, not just a transparent pen.
- [done] 7. Make eraser reliably remove only the intended strokes.
- [done] 8. Make undo work reliably for drawing, text, and page actions.
- [done] 9. Make redo work reliably.
- [done] 10. Make clear-page only clear the current page.
- [done] 11. Add confirmation before clearing a page.
- [done] 12. Make pen width options feel useful: thin, medium, thick.
- [done] 13. Make highlighter width options feel useful.
- [done] 14. Fix pen/highlighter thickness slider thumb alignment.
- [done] 15. Centre the slider circle perfectly on the slider line.
- [done] 16. Make the slider circle solid white so the line does not show through it.
- [done] 17. Add subtle border/shadow to the slider circle if needed.
- [done] 18. Make notebook tools toggle off when clicked again.
- [done] 19. Let Text mode deselect when clicking the Text icon again.
- [done] 20. Let Pen mode deselect when clicking the Pen icon again.
- [done] 21. Let Eraser mode deselect when clicking the Eraser icon again.
- [done] 22. Let Highlighter mode deselect when clicking the Highlighter icon again.
- [done] 23. Make active notebook tool state much more obvious.
- [done] 24. Add clear hover states to notebook toolbar icons.
- [done] 25. Add tooltips for notebook toolbar icons.
- [done] 26. Add keyboard shortcuts for notebook tools.
- [done] 27. Show shortcuts in notebook tooltips.
- [done] 28. Make text boxes easier to add.
- [done] 29. Make text boxes easier to move.
- [done] 30. Make text boxes easier to resize.
- [done] 31. Make text boxes easier to delete.
- [done] 32. Add clear selected state around active text boxes.
- [done] 33. Add a small floating toolbar when a text box is selected.
- [done] 34. Prevent text boxes from being accidentally lost.
- [done] 35. Add subtle placeholder text on empty pages.
- [done] 36. Make typed text autosave reliably.
- [done] 37. Make handwritten strokes autosave reliably.
- [done] 38. Show notebook save states: unsaved, saving, saved, failed.
- [done] 39. Add unsaved-changes warning before leaving notebook.
- [done] 40. Preserve current notebook page after refresh.
- [done] 41. Make page thumbnails update after edits.
- [done] 42. Make page thumbnails show typed and drawn content.
- [done] 43. Make page counter update correctly.
- [done] 44. Add page should inherit notebook default page colour.
- [done] 45. Add page should inherit notebook default page style.
- [done] 46. Delete page should renumber pages cleanly.
- [done] 47. Prevent accidental deletion of the final notebook page.
- [done] 48. Add clearer page settings for plain, lined, grid, dotted.
- [done] 49. Add clearer page settings for white/dark page.
- [done] 50. Make notebook back button reliable.
- [done] 51. Make notebook back button more visible.
- [done] 52. Avoid relying on browser back button.
- [done] 53. Remove extra glassy frames around the notebook page.
- [done] 54. Make the page feel more like paper.
- [done] 55. Make notebook workspace more immersive.
- [done] 56. Reduce dead space underneath notebook pages.
- [done] 57. Improve notebook layout in portrait mode.
- [done] 58. Improve notebook layout in landscape mode.
- [done] 59. Make notebook toolbar usable on iPad.
- [done] 60. Make notebook toolbar usable on smaller laptops.
- [done] 61. Make notebook controls larger for touch.
- [done] 62. Prevent finger touches from accidentally drawing when stylus is active.
- [done] 63. Allow finger scrolling/swiping while stylus writes.
- [done] 64. Prevent accidental page swipes while writing.
- [done] 65. Add zoom in/out for notebook pages.
- [done] 66. Add fit-width view for notebook pages.
- [done] 67. Add pan/drag support when zoomed in.
- [done] 68. Make notebook page navigation smoother.
- [done] 69. Make page add/delete actions auto-dismiss notifications.
- [done] 70. Make notebook settings save clearly and reliably.
- [done] 581. Restore a circular eraser cursor after the js-draw migration.

### B. Notebook cards and notebook grids

- [done] 71. Centre notebook icon properly on notebook card.
- [done] 72. Centre notebook name properly under/inside notebook card.
- [done] 73. Remove “Open notebook” text under notebook cards.
- [done] 74. Make the entire notebook card clickable.
- [done] 75. Make notebook cards more compact.
- [done] 76. Keep notebook card metadata to one tiny line maximum.
- [done] 77. Show only useful notebook metadata, like page count or edited date.
- [done] 78. Remove unnecessary notebook bubbles/chips.
- [done] 79. Make notebook covers look less AI-generated.
- [done] 80. Redesign notebook icons to be flatter and cleaner.
- [done] 81. Make notebook icons consistent with folder icons.
- [done] 82. Remove weird circular icon backing from notebook cards.
- [done] 83. Fix notebook card spacing and alignment.
- [done] 84. Make long notebook names truncate cleanly.
- [done] 85. Add quick rename action for notebooks.
- [done] 86. Add safe archive action for notebooks.
- [done] 87. Add confirmation before deleting/archiving notebooks.
- [done] 88. Make notebook empty state feel intentional.
- [done] 89. Add “Create notebook” and “Import PDF” as obvious actions.
- [done] 90. Make notebook cards visually balanced across desktop/tablet.

### C. PDF notebooks

- [done] 91. Add “Import PDF as notebook.”
- [done] 92. Let users upload worksheets as notebooks.
- [done] 93. Let users upload exam papers as notebooks.
- [done] 94. Let users upload lecture slides as notebooks.
- [done] 95. Let users upload past papers as notebooks.
- [done] 96. Let users upload mark schemes as notebooks.
- [deferred] 97. Convert each PDF page into a notebook page.
- [done] 98. Lock PDF content as the page background.
- [done] 99. Let users write on top of PDF pages.
- [done] 100. Let users highlight on top of PDF pages.
- [done] 101. Let users add text boxes on top of PDF pages.
- [done] 102. Let users erase annotations without damaging the PDF.
- [done] 103. Save only annotations, not changes to original PDF.
- [deferred] 104. Add blank pages between PDF pages. This depends on per-page PDF conversion, which is outside Phase 6.
- [deferred] 105. Add lined/grid/dot pages after PDF pages. This depends on per-page PDF conversion, which is outside Phase 6.
- [deferred] 106. Add PDF page thumbnails. This depends on PDF parsing and per-page conversion, which are outside Phase 6.
- [done] 107. Add zoom in/out for PDF notebooks.
- [done] 108. Add fit-width for PDF notebooks.
- [deferred] 109. Add annotated PDF export.
- [done] 110. Add upload progress for PDF import.
- [done] 111. Add friendly PDF upload error messages.
- [done] 112. Validate PDF file type before upload.
- [done] 113. Validate PDF file size before upload.
- [done] 114. Show file name after PDF import.
- [done] 115. Allow renaming imported PDF notebooks.
- [done] 116. Make “Import PDF as notebook” separate from “Upload PDF to Library.”
- [done] 117. Avoid vague wording like “file metadata.”
- [done] 118. Support PDF notebooks inside folders.
- [done] 119. Make PDF notebooks work well on iPad.
- [done] 120. Make PDF annotations autosave reliably.

### D. Image notebooks/uploads

- [done] 121. Allow image upload as notebook.
- [done] 122. Support JPEG uploads.
- [done] 123. Support PNG uploads.
- [done] 124. Support WebP uploads.
- [done] 125. Let students annotate uploaded worksheet photos.
- [done] 126. Let students annotate screenshots.
- [done] 127. Let students annotate diagrams.
- [done] 128. Add image upload progress.
- [done] 129. Add friendly image upload errors.
- [done] 130. Validate image file type before upload.
- [done] 131. Validate image file size before upload.

### E. Folders

- [done] 132. Make folders feel like broad study spaces, not tiny topics.
- [done] 133. Clean up folder cards.
- [done] 134. Show only folder object and folder name on folder cards.
- [done] 135. Remove unnecessary folder counts from main folder cards.
- [done] 136. Remove unnecessary folder descriptions from main folder cards.
- [done] 137. Remove unnecessary folder bubbles/chips.
- [done] 138. Remove weird white circular icon backing from folders.
- [done] 139. Centre folder icons properly.
- [done] 140. Centre or consistently align folder names.
- [done] 141. Make folder cards more compact.
- [done] 142. Make folder icons look less AI-generated.
- [done] 143. Redesign folder icons to be flatter and cleaner.
- [done] 144. Make folder icons consistent in stroke and style.
- [done] 145. Make folder colours feel intentional.
- [done] 146. Improve folder empty state when no folders exist.
- [done] 147. Replace awkward empty create-folder layout with a clean centred card.
- [done] 148. Add clear empty state: “Create your first study space.”
- [done] 149. Make Create Folder button obvious.
- [done] 150. Prevent duplicate folders from double-clicking Create.
- [done] 151. Disable Create button while folder is saving.
- [done] 152. Add quick rename action for folders.
- [done] 153. Add clear edit folder modal.
- [done] 154. Add safe archive action for folders.
- [done] 155. Warn that archiving folder does not delete decks/sources.
- [done] 156. Make folder detail tabs clean: Notebooks, Decks, Sources, Progress.
- [done] 157. Add obvious folder actions: Create notebook, Import PDF, Add deck, Add source.
- [done] 158. Make folder detail page feel like one subject/module hub.
- [done] 159. Preserve selected folder tab after refresh.
- [done] 160. Add breadcrumb: Folders > Biology.

### F. Decks

- [done] 161. Improve deck card layout.
- [done] 162. Make deck cards more compact.
- [done] 163. Fix awkward deck title wrapping.
- [done] 164. Make long deck names truncate cleanly.
- [done] 165. Show full deck name on hover or detail page.
- [done] 166. Show only useful deck metadata.
- [done] 167. Show card count on deck cards.
- [done] 168. Show due count on deck cards.
- [done] 169. Show folder label only if useful.
- [done] 170. Add quick Study action on deck cards.
- [done] 171. Add quick Add Card action on deck cards.
- [done] 172. Add quick Edit Deck action on deck cards.
- [done] 173. Add quick View Cards action on deck cards.
- [done] 174. Make deck colour visually meaningful.
- [done] 175. Make deck colour carry through to review mode.
- [done] 176. Prevent duplicate deck creation from double-clicking.
- [done] 177. Disable deck create button while saving.
- [done] 178. Add quick rename action for decks.
- [done] 179. Add confirmation before deleting decks.
- [done] 180. Clarify delete vs remove from folder for decks.
- [done] 181. Preserve deck page state after refresh.
- [done] 182. Add breadcrumb for deck detail pages.

### G. Flashcards and review

- [done] 183. Make actual flashcard background match selected deck/card colour.
- [done] 184. Use subtle colour tint/gradient based on selected colour.
- [done] 185. Keep flashcard text contrast readable on all colours.
- [done] 186. Make review flashcard larger and more central.
- [done] 187. Improve flashcard flip animation.
- [done] 188. Make rating buttons clearer.
- [done] 189. Use consistent labels: Again, Hard, Good, Easy.
- [done] 190. Add Space shortcut to flip flashcards.
- [done] 191. Add 1/2/3/4 shortcuts for rating cards.
- [done] 192. Show “Card X of Y” clearly.
- [done] 193. Show session progress clearly.
- [done] 194. Improve review completion summary.
- [done] 195. Show reviewed count after session.
- [done] 196. Show accuracy after session.
- [done] 197. Show next due cards after session.
- [done] 198. Show goal progress after session.
- [done] 199. Make review mode clean on mobile.
- [done] 200. Make review buttons easier to tap on mobile.
- [done] 201. Prevent accidental double-rating.
- [done] 202. Disable rating buttons briefly after click.
- [done] 203. Keep review flow fast and distraction-free.
- [done] 204. Make flashcard empty state action-focused.
- [done] 205. Make “Add first card” obvious when deck is empty.

### H. Card creation and Cards page

- [done] 206. Make manual card creation faster.
- [done] 207. Add Ctrl/Cmd + Enter to save card.
- [done] 208. Keep user in add-another-card mode after saving.
- [done] 209. Make front/back fields larger.
- [done] 210. Make deck selection obvious.
- [done] 211. Make tags optional and less visually overwhelming.
- [done] 212. Hide advanced card types unless reliable.
- [done] 213. Add compact list/table view on Cards page.
- [done] 214. Add grid/list toggle on Cards page.
- [done] 215. Improve card search.
- [done] 216. Filter cards by deck.
- [done] 217. Filter cards by folder.
- [done] 218. Filter cards by tag.
- [done] 219. Filter cards by due status.
- [done] 220. Filter cards by weak status.
- [done] 221. Filter cards by new status.
- [done] 222. Make card previews less vertically huge.
- [done] 223. Add bulk add tag action.
- [done] 224. Add bulk move deck action.
- [done] 225. Add bulk delete action.
- [done] 226. Add confirmation before bulk delete.
- [done] 227. Make selected card state obvious.
- [done] 228. Make filter chips easy to clear.
- [done] 229. Add “Clear all filters.”
- [done] 230. Improve no-results state for card search.
- [done] 231. Make long card text truncate cleanly.
- [done] 232. Add full card preview on click.
- [done] 233. Prevent duplicate cards from double-clicking Save.
- [done] 234. Disable Save Card button while saving.

### I. Goals

- [done] 235. Fix goal creation not saving.
- [done] 236. Make active goal appear immediately after creation.
- [done] 237. Persist active goals after refresh.
- [done] 238. Show clear error if goal creation fails.
- [done] 239. Do not let goal creation fail silently.
- [done] 240. Make deadline optional for simple goals.
- [done] 241. Add simple goal presets.
- [done] 242. Example preset: Review 10 cards today.
- [done] 243. Example preset: Review 20 cards this week.
- [done] 244. Example preset: Hit 80% accuracy.
- [done] 245. Show target card count on goal card.
- [done] 246. Show accuracy target on goal card.
- [done] 247. Show deadline on goal card.
- [done] 248. Show progress so far on goal card.
- [done] 249. Show reward preview on goal card.
- [done] 250. Add goal progress bar.
- [done] 251. Add goal edit action.
- [done] 252. Add goal cancel/archive action.
- [done] 253. Add confirmation before deleting/cancelling goal.
- [done] 254. Fix goal date/time overlap on narrower screens.
- [done] 255. Stack date and time fields on narrow screens.
- [done] 256. Test goal layout on laptop, iPad, tablet, and phone.
- [done] 257. Disable Create Goal while saving.
- [done] 258. Prevent duplicate goals from double-clicking.
- [done] 259. Explain why Create Goal button is disabled.
- [done] 260. Make goals page empty state clearer.
- [done] 261. Add “Create your first goal” button on empty goals page.

### J. Deadline bubbles

- [done] 262. Fix deadline bubble styling.
- [done] 263. Make deadline bubbles smaller.
- [done] 264. Make deadline bubbles cleaner.
- [done] 265. Align deadline bubbles properly.
- [done] 266. Avoid long deadline text inside tiny pills.
- [done] 267. Use simple labels like Due today, Due tomorrow, Overdue.
- [done] 268. Make overdue deadline styling clear.
- [done] 269. Make urgent deadline styling clear.
- [done] 270. Ensure deadline bubbles wrap properly on small screens.
- [done] 271. Prevent deadline bubbles from overlapping other content.
- [done] 272. Reduce visual dominance of deadline bubbles.

### K. Notifications and reminders

- [done] 273. Test whether notification reminders actually work.
- [done] 274. Add clear browser notification permission flow.
- [done] 275. Show reminder permission status.
- [done] 276. Show “Reminders off.”
- [done] 277. Show “Reminders enabled.”
- [done] 278. Show “Notifications blocked in browser settings.”
- [done] 279. Show “Next reminder: 4:00 PM.”
- [done] 280. Make reminder settings persist after refresh.
- [done] 281. Make reminders persist after logout/login.
- [done] 282. Handle unsupported mobile browser notifications clearly.
- [done] 283. Add friendly error if reminders cannot be enabled.
- [done] 284. Avoid pretending reminders work if browser blocks them.
- [deferred] 285. Make reminder time picker responsive. Current reminders use one fixed 4:00 PM Europe/London schedule, so there is no time picker.
- [deferred] 286. Prevent reminder time fields from overlapping. Current reminders use one fixed 4:00 PM Europe/London schedule, so there are no time fields.
- [done] 287. Make reminder controls easy to tap on mobile.

### L. In-app toast notifications

- [done] 288. Auto-dismiss all toast notifications after around 3 seconds.
- [done] 289. Auto-dismiss green success notifications.
- [done] 290. Auto-dismiss red error notifications.
- [done] 291. Auto-dismiss settings saved notifications.
- [done] 292. Auto-dismiss page added notifications.
- [done] 293. Auto-dismiss notebook saved notifications.
- [done] 294. Auto-dismiss folder/deck/card created notifications.
- [done] 295. Add smooth fade/slide away animation.
- [done] 296. Still allow manual dismiss before auto-dismiss.
- [done] 297. Prevent multiple toasts from stacking messily.
- [done] 298. Limit toast width on narrow screens.
- [done] 299. Keep toast text short and clear.
- [done] 300. Show longer detail only where absolutely necessary.

### M. Stars

- [done] 301. Connect Stars clearly to completed goals.
- [done] 302. Show empty Stars explanation.
- [done] 303. Add “Complete goals to build your constellation.”
- [done] 304. Add “Create your first goal” button on Stars page.
- [done] 305. Show star reward preview before completing goal.
- [done] 306. Animate star appearing after goal completion.
- [done] 307. Vary star size based on goal difficulty.
- [done] 308. Vary star brightness based on goal difficulty.
- [done] 309. Reward longer streaks with rarer stars.
- [done] 310. Make Stars page feel less empty for new users.
- [done] 311. Show recent earned stars.
- [done] 312. Show which goal earned each star.
- [done] 313. Make constellation layout cleaner.
- [done] 314. Avoid making Stars feel disconnected from studying.

### N. Today/Home page

- [done] 315. Move Today button/action closer to the top-right edge.
- [done] 316. Align Today header actions neatly.
- [done] 317. Avoid buttons floating awkwardly near the centre.
- [done] 318. Make Today page action-first.
- [done] 319. Show one dominant recommended action.
- [done] 320. Recommend due reviews when cards are due.
- [done] 321. Recommend continuing notebook when notebook activity exists.
- [done] 322. Recommend creating a folder when no folder exists.
- [done] 323. Recommend creating a deck/notebook when folder exists but is empty.
- [done] 324. Recommend adding cards when deck is empty.
- [done] 325. Recommend reviewing when cards exist.
- [done] 326. Recommend setting a goal after reviews.
- [done] 327. Recommend claiming/viewing star after goal completion.
- [done] 328. Reduce Today page clutter.
- [done] 329. Avoid turning Today into an analytics dashboard.
- [done] 330. Make Today mobile layout clean.
- [done] 331. Make Today empty state useful.

### O. Progress page

- [done] 332. Improve new-user Progress empty state.
- [done] 333. Explain how to unlock progress insights.
- [done] 334. Show steps: create deck, add cards, review, set goal.
- [deferred] 335. Add disabled preview widgets for future progress stats.
- [done] 336. Show cards reviewed this week.
- [done] 337. Show due cards.
- [done] 338. Show weak cards.
- [done] 339. Show strongest decks.
- [done] 340. Show weakest decks.
- [done] 341. Show goal progress.
- [done] 342. Show streak.
- [done] 343. Show recent notebook activity.
- [done] 344. Show upcoming deadlines.
- [done] 345. Avoid too many confusing percentages.
- [done] 346. Avoid unexplained mastery scores.
- [done] 347. Make every progress insight link to an action.
- [done] 348. Weak deck should link to review.
- [done] 349. Due cards should link to Start Review.
- [done] 350. Empty notebook should link to Continue Notebook.
- [done] 351. Missed goal should link to Create Easier Goal.
- [done] 352. No activity should link to Study for 10 minutes.
- [done] 353. Keep Progress constructive rather than judgmental.
- [done] 354. Keep Progress narrow and readable.
- [done] 355. Make Progress mobile layout clean.
- [done] 356. Preserve Progress section/filter after refresh.

### P. Library and Sources, non-AI only

- [done] 357. Make Library useful as a study material hub without generation features.
- [done] 358. Add PDF upload to Library.
- [done] 359. Add image upload to Library.
- [done] 360. Add link source type.
- [done] 361. Add typed note source type.
- [done] 362. Add pasted text source type.
- [done] 363. Add uploaded document source type.
- [done] 364. Let users rename sources.
- [done] 365. Let users tag sources.
- [done] 366. Let users move sources to folders.
- [done] 367. Let users attach sources to multiple folders.
- [done] 368. Let users remove source from folder without deleting globally.
- [done] 369. Warn before deleting source globally.
- [done] 370. Add source archive option.
- [done] 371. Show source title clearly.
- [done] 372. Show source type icon.
- [done] 373. Show linked folder on source card.
- [done] 374. Show upload/add date on source card.
- [done] 375. Show small preview where useful.
- [done] 376. Avoid technical source wording.
- [done] 377. Replace “source metadata” with “Details” or “File info.”
- [done] 378. Filter Library by folder.
- [done] 379. Filter Library by type.
- [done] 380. Filter Library by subject.
- [done] 381. Filter Library by recent.
- [done] 382. Search source titles.
- [done] 383. Search source notes.
- [done] 384. Improve source card layout.
- [done] 385. Reduce source card chips.
- [done] 386. Remove overwhelming source action panels.
- [done] 387. Primary source actions should be Open, Move, Rename, Delete/Archive.
- [done] 388. Add source upload progress.
- [done] 389. Add friendly source upload errors.
- [done] 390. Validate source file type.
- [done] 391. Validate source file size.
- [done] 392. Let source PDFs open/preview.
- [done] 393. Let source images open/preview.
- [done] 394. Show source file size.
- [deferred] 395. Show source page count if available. Page extraction would require PDF parsing, which is outside the current phase.
- [done] 396. Keep Library layout clean on mobile.
- [done] 397. Avoid horizontal scroll in Library.
- [done] 398. Add no-sources empty state.
- [done] 399. Add “Upload PDF,” “Add note,” and “Add link” buttons.
- [done] 400. Keep Library separate from notebook annotation flow.

### Q. Sign-in and auth pages

- [done] 401. Fix sign-in page layout.
- [done] 402. Put sign-in options underneath the “How Jami works” explanation.
- [done] 403. Remove awkward bottom-left gap on sign-in page.
- [done] 404. Make sign-in page fit into one clean screen.
- [done] 405. Stack sign-in sections cleanly on smaller screens.
- [done] 406. Make sign-in card align better with explanation card.
- [done] 407. Reduce random dead space on auth pages.
- [done] 408. Make Google sign-in button visually clear.
- [done] 409. Make email sign-in option visually clear.
- [done] 410. Make auth errors friendly.
- [done] 411. Avoid technical auth error messages.
- [done] 412. Keep auth page first impression polished.
- [done] 413. Check layout after sign-up and login redirects.

### R. General layout and whitespace

- [done] 414. Do full whitespace audit across app.
- [done] 415. Fix random empty spaces.
- [done] 416. Fix awkward gaps.
- [done] 417. Stretch cards where space should be used.
- [done] 418. Avoid cards floating in the middle for no reason.
- [done] 419. Fix dashboard spacing.
- [done] 420. Fix folder page spacing.
- [done] 421. Fix notebook grid spacing.
- [done] 422. Fix deck page spacing.
- [done] 423. Fix cards page spacing.
- [done] 424. Fix goals page spacing.
- [done] 425. Fix progress page spacing.
- [done] 426. Fix Library page spacing.
- [done] 427. Fix source page spacing.
- [done] 428. Fix notebook editor spacing.
- [done] 429. Make page headers align consistently.
- [done] 430. Make action buttons align consistently.
- [done] 431. Reduce oversized dashboard blocks.
- [done] 432. Make card heights more consistent.
- [done] 433. Avoid huge vertical gaps under content.
- [done] 434. Make forms feel intentionally placed.
- [done] 435. Improve layout on narrower laptop screens.
- [done] 436. Improve layout on tablets.
- [done] 437. Improve layout on phones.

### S. Buttons and interactions

- [done] 438. Make button hierarchy consistent.
- [done] 439. Use primary style only for main action.
- [done] 440. Use secondary style for less important actions.
- [done] 441. Use danger style only for destructive actions.
- [done] 442. Avoid too many equal-weight buttons.
- [done] 443. Disable buttons while saving.
- [done] 444. Show Creating/Saving/Importing state on buttons.
- [done] 445. Prevent duplicate actions from double-clicking.
- [done] 446. Make disabled buttons explain what is missing.
- [done] 447. Make Escape close normal modals.
- [done] 448. Make outside click close normal modals.
- [done] 449. Require explicit choice for destructive modals.
- [done] 450. Make dropdowns close after selecting an option.
- [done] 451. Make selected dropdown option visibly applied.
- [done] 452. Improve hover states on buttons.
- [done] 453. Improve pressed/clicked states on buttons.
- [done] 454. Improve focus states for keyboard users.
- [done] 455. Make all clickable cards show pointer cursor.
- [done] 456. Add subtle hover lift to clickable cards.
- [done] 457. Add clear click states to cards.
- [done] 458. Keep button wording consistent.
- [done] 459. Use Create for forms.
- [done] 460. Use Save for edits.
- [done] 461. Use Study for decks.
- [done] 462. Use Continue for notebooks.
- [done] 463. Use Open for files/sources.
- [done] 464. Use Remove from folder when not deleting globally.
- [done] 465. Use Delete only when actually deleting.

### T. Search, filters, navigation

- [done] 466. Add better search empty states.
- [done] 467. Show “No results for…” after searches.
- [done] 468. Add clear search button.
- [done] 469. Add create action from no-results state.
- [done] 470. Add visible active filter chips.
- [done] 471. Add x button to remove individual filters.
- [done] 472. Add Clear all filters.
- [done] 473. Preserve filters after refresh where useful.
- [done] 474. Preserve selected tab after refresh.
- [done] 475. Preserve notebook page after refresh.
- [done] 476. Add breadcrumbs on deeper pages.
- [done] 477. Use breadcrumbs like Folders > Biology > Notes.
- [done] 478. Make navigation between folder/deck/notebook clearer.
- [done] 479. Make sidebar active state clearer.
- [done] 480. Make sidebar groups less cluttered.
- [done] 481. Keep mobile navigation simple.
- [done] 482. Avoid hiding important actions too deeply.

### U. Empty states and onboarding

- [done] 483. Add simple first-user journey.
- [done] 484. Step 1: Create folder.
- [done] 485. Step 2: Add notebook or deck.
- [done] 486. Step 3: Add cards.
- [done] 487. Step 4: Review cards.
- [done] 488. Step 5: Set goal.
- [done] 489. Step 6: Earn stars.
- [done] 490. Add action-focused empty states everywhere.
- [done] 491. Empty folders should say Create your first study space.
- [done] 492. Empty decks should say Create a deck.
- [done] 493. Empty cards should say Add your first flashcard.
- [done] 494. Empty notebooks should say Create notebook or import PDF.
- [done] 495. Empty Stars should say Complete a goal.
- [done] 496. Empty Library should say Upload PDF, image, link, or note.
- [done] 497. Empty Progress should explain how to unlock insights.
- [done] 498. Avoid lonely empty pages.
- [done] 499. Avoid over-explaining empty states.
- [done] 500. Add dismissible onboarding card.
- [deferred] 501. Add global quick-create button. The corrected roadmap keeps this out of Phase 6 until folder-first creation flows are stable.
- [deferred] 502. Quick-create should offer Folder, Notebook, Deck, Card, Goal, Source, Import PDF. This depends on the deferred global quick-create surface.

### V. Mobile and tablet

- [done] 503. Make iPad a first-class experience.
- [done] 504. Make Apple Pencil writing reliable.
- [done] 505. Improve palm rejection where possible.
- [done] 506. Make notebook toolbar reachable on iPad.
- [done] 507. Make toolbar usable in portrait.
- [done] 508. Make toolbar usable in landscape.
- [done] 509. Increase tap targets.
- [done] 510. Add safe spacing near iPhone home bar.
- [done] 511. Add safe spacing near browser toolbar.
- [done] 512. Avoid tiny dropdowns on mobile.
- [done] 513. Avoid cramped icon rows on mobile.
- [done] 514. Make review buttons easy to tap.
- [done] 515. Make Today readable on mobile.
- [done] 516. Make Progress readable on mobile.
- [done] 517. Make Library readable on mobile.
- [done] 518. Let phone users view notebooks.
- [done] 519. Let phone users add light typed notes.
- [done] 520. Show “Notebook editing works best on iPad or desktop.”
- [done] 521. Add “Continue anyway” for full notebook editing on phone.
- [done] 522. Avoid horizontal scroll on mobile.
- [done] 523. Test narrow screens where date/time overlap.
- [done] 524. Test smaller laptop widths.
- [done] 525. Test tablet widths.
- [done] 526. Test phone widths.

### W. Reliability and data safety

- [done] 527. Add clear save/error states everywhere.
- [done] 528. Add retry for failed saves.
- [done] 529. Warn when offline.
- [done] 530. Show unsaved work clearly.
- [done] 531. Prevent silent data loss.
- [done] 532. Add loading skeletons instead of blank screens.
- [done] 533. Add skeletons for dashboard cards.
- [done] 534. Add skeletons for folder grids.
- [done] 535. Add skeletons for notebook grids.
- [done] 536. Add skeletons for deck pages.
- [done] 537. Add skeletons for progress.
- [done] 538. Add skeletons for Library.
- [done] 539. Fix layout shifts when data loads.
- [done] 540. Avoid cards jumping after load.
- [done] 541. Add friendly errors instead of technical messages.
- [done] 542. Add confirmation for deleting folders.
- [done] 543. Add confirmation for deleting notebooks.
- [done] 544. Add confirmation for deleting decks.
- [done] 545. Add confirmation for deleting cards.
- [done] 546. Add confirmation for deleting sources.
- [done] 547. Add confirmation for archiving folders.
- [done] 548. Add confirmation for clearing notebook pages.
- [done] 549. Clarify archive vs delete.
- [done] 550. Clarify remove from folder vs delete globally.
- [done] 551. Show confirmation after moving items.
- [done] 552. Auto-dismiss move confirmations after 3 seconds.
- [done] 553. Keep uploaded files user-scoped.
- [done] 554. Make refresh not lose user position.
- [done] 555. Make logout/login preserve saved data correctly.

### X. Visual design polish

- [done] 556. Remove unnecessary bubbles across the app.
- [done] 557. Reduce decorative labels.
- [done] 558. Remove repeated helper text.
- [done] 559. Remove long descriptions from object cards.
- [done] 560. Remove labels that repeat the page title.
- [done] 561. Make the app feel calmer and less busy.
- [done] 562. Improve typography consistency.
- [done] 563. Improve heading hierarchy.
- [done] 564. Improve small text contrast.
- [done] 565. Improve colour contrast in dark mode.
- [deferred] 566. Add light mode eventually only if already supported or low-risk; otherwise track it as future work. This remains future work because adding and validating a second full theme is not a low-risk Phase 6 change.
- [done] 567. Check every theme/colour for button text contrast.
- [done] 568. Make folder/deck/card colours consistent.
- [done] 569. Avoid random colour use.
- [done] 570. Make colour mean something.
- [done] 571. Make status colours consistent.
- [done] 572. Make danger colours consistent.
- [done] 573. Make success colours consistent.
- [done] 574. Make deadline colours consistent.
- [done] 575. Make visual identity feel less generated.
- [done] 576. Make UI objects feel native to the app.
- [done] 577. Polish cards so they feel less prototype-like.
- [done] 578. Make dashboard cleaner and more focused.
- [done] 579. Make the app feel more like a student workspace.
- [done] 580. Remove unfinished/irrelevant actions until ready.

## Verification Notes

- Browser Use requested; its Node REPL tool was not exposed in this session, so the same local browser checks were run with Playwright Core and installed Chrome.
- Each implementation batch was checked in the browser and corrected before continuing.
- Final responsive sweep: 11 major routes at 1200x800, 768x1024, and 390x844 (33 route/viewport combinations), with no runtime errors, blank renders, or horizontal overflow.
- Notebook import progress was verified during a throttled real upload; offline warning, destructive-dialog focus restoration, and the 1200px deck layout were also verified in-browser.
- Production verification passed the same 33 route/viewport combinations against `next start`.
- `npm run typecheck`, `npm run lint`, all 207 active tests, and the warning-free production build pass.
