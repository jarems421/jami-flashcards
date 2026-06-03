# Jami Non-AI Improvement Tracker

Generated from the user-supplied non-AI improvement plan. Status values: `todo`, `done`, `partial`, `blocked`.

## Batch Status

- [done] Phase 1: Audit and tracker
- [partial] Phase 2: Notebook handwriting/editor foundation
- [todo] Phase 3: Notebook cards/grid polish
- [partial] Phase 4: PDF/image notebook import
- [partial] Phase 5: Library/source uploads
- [todo] Phase 6: Goals/reminders/deadlines/stars
- [partial] Phase 7: Learn/decks/cards/review
- [todo] Phase 8: Home/Progress simplification
- [partial] Phase 9: General UI polish
- [partial] Phase 10: Final QA

## Target Tracker

### A. Notebook editor: handwriting, tools, page behaviour

- [partial] 1. Fix iPad stylus writing so Apple Pencil/stylus input works instantly.
- [partial] 2. Fix desktop pen drawing so mouse/trackpad drawing actually appears.
- [partial] 3. Make quick lift-and-write movements register instantly.
- [partial] 4. Make pen strokes smoother and less gritty.
- [partial] 5. Add better stroke smoothing for handwriting.
- [partial] 6. Make highlighter feel like a real highlighter, not just a transparent pen.
- [todo] 7. Make eraser reliably remove only the intended strokes.
- [partial] 8. Make undo work reliably for drawing, text, and page actions.
- [partial] 9. Make redo work reliably.
- [done] 10. Make clear-page only clear the current page.
- [done] 11. Add confirmation before clearing a page.
- [todo] 12. Make pen width options feel useful: thin, medium, thick.
- [todo] 13. Make highlighter width options feel useful.
- [partial] 14. Fix pen/highlighter thickness slider thumb alignment.
- [partial] 15. Centre the slider circle perfectly on the slider line.
- [done] 16. Make the slider circle solid white so the line does not show through it.
- [todo] 17. Add subtle border/shadow to the slider circle if needed.
- [done] 18. Make notebook tools toggle off when clicked again.
- [done] 19. Let Text mode deselect when clicking the Text icon again.
- [done] 20. Let Pen mode deselect when clicking the Pen icon again.
- [done] 21. Let Eraser mode deselect when clicking the Eraser icon again.
- [done] 22. Let Highlighter mode deselect when clicking the Highlighter icon again.
- [todo] 23. Make active notebook tool state much more obvious.
- [partial] 24. Add clear hover states to notebook toolbar icons.
- [done] 25. Add tooltips for notebook toolbar icons.
- [done] 26. Add keyboard shortcuts for notebook tools.
- [done] 27. Show shortcuts in notebook tooltips.
- [todo] 28. Make text boxes easier to add.
- [todo] 29. Make text boxes easier to move.
- [partial] 30. Make text boxes easier to resize.
- [todo] 31. Make text boxes easier to delete.
- [todo] 32. Add clear selected state around active text boxes.
- [todo] 33. Add a small floating toolbar when a text box is selected.
- [todo] 34. Prevent text boxes from being accidentally lost.
- [todo] 35. Add subtle placeholder text on empty pages.
- [partial] 36. Make typed text autosave reliably.
- [partial] 37. Make handwritten strokes autosave reliably.
- [partial] 38. Show notebook save states: unsaved, saving, saved, failed.
- [todo] 39. Add unsaved-changes warning before leaving notebook.
- [todo] 40. Preserve current notebook page after refresh.
- [todo] 41. Make page thumbnails update after edits.
- [todo] 42. Make page thumbnails show typed and drawn content.
- [todo] 43. Make page counter update correctly.
- [todo] 44. Add page should inherit notebook default page colour.
- [todo] 45. Add page should inherit notebook default page style.
- [todo] 46. Delete page should renumber pages cleanly.
- [todo] 47. Prevent accidental deletion of the final notebook page.
- [todo] 48. Add clearer page settings for plain, lined, grid, dotted.
- [todo] 49. Add clearer page settings for white/dark page.
- [todo] 50. Make notebook back button reliable.
- [todo] 51. Make notebook back button more visible.
- [todo] 52. Avoid relying on browser back button.
- [partial] 53. Remove extra glassy frames around the notebook page.
- [todo] 54. Make the page feel more like paper.
- [todo] 55. Make notebook workspace more immersive.
- [todo] 56. Reduce dead space underneath notebook pages.
- [todo] 57. Improve notebook layout in portrait mode.
- [todo] 58. Improve notebook layout in landscape mode.
- [todo] 59. Make notebook toolbar usable on iPad.
- [todo] 60. Make notebook toolbar usable on smaller laptops.
- [todo] 61. Make notebook controls larger for touch.
- [partial] 62. Prevent finger touches from accidentally drawing when stylus is active.
- [partial] 63. Allow finger scrolling/swiping while stylus writes.
- [todo] 64. Prevent accidental page swipes while writing.
- [partial] 65. Add zoom in/out for notebook pages.
- [todo] 66. Add fit-width view for notebook pages.
- [todo] 67. Add pan/drag support when zoomed in.
- [todo] 68. Make notebook page navigation smoother.
- [todo] 69. Make page add/delete actions auto-dismiss notifications.
- [todo] 70. Make notebook settings save clearly and reliably.

### B. Notebook cards and notebook grids

- [todo] 71. Centre notebook icon properly on notebook card.
- [todo] 72. Centre notebook name properly under/inside notebook card.
- [todo] 73. Remove “Open notebook” text under notebook cards.
- [todo] 74. Make the entire notebook card clickable.
- [todo] 75. Make notebook cards more compact.
- [todo] 76. Keep notebook card metadata to one tiny line maximum.
- [todo] 77. Show only useful notebook metadata, like page count or edited date.
- [todo] 78. Remove unnecessary notebook bubbles/chips.
- [todo] 79. Make notebook covers look less AI-generated.
- [todo] 80. Redesign notebook icons to be flatter and cleaner.
- [todo] 81. Make notebook icons consistent with folder icons.
- [todo] 82. Remove weird circular icon backing from notebook cards.
- [todo] 83. Fix notebook card spacing and alignment.
- [todo] 84. Make long notebook names truncate cleanly.
- [todo] 85. Add quick rename action for notebooks.
- [todo] 86. Add safe archive action for notebooks.
- [todo] 87. Add confirmation before deleting/archiving notebooks.
- [todo] 88. Make notebook empty state feel intentional.
- [todo] 89. Add “Create notebook” and “Import PDF” as obvious actions.
- [todo] 90. Make notebook cards visually balanced across desktop/tablet.

### C. PDF notebooks

- [partial] 91. Add “Import PDF as notebook.”
- [partial] 92. Let users upload worksheets as notebooks.
- [partial] 93. Let users upload exam papers as notebooks.
- [partial] 94. Let users upload lecture slides as notebooks.
- [partial] 95. Let users upload past papers as notebooks.
- [todo] 96. Let users upload mark schemes as notebooks.
- [todo] 97. Convert each PDF page into a notebook page.
- [todo] 98. Lock PDF content as the page background.
- [todo] 99. Let users write on top of PDF pages.
- [todo] 100. Let users highlight on top of PDF pages.
- [todo] 101. Let users add text boxes on top of PDF pages.
- [todo] 102. Let users erase annotations without damaging the PDF.
- [todo] 103. Save only annotations, not changes to original PDF.
- [todo] 104. Add blank pages between PDF pages.
- [todo] 105. Add lined/grid/dot pages after PDF pages.
- [todo] 106. Add PDF page thumbnails.
- [todo] 107. Add zoom in/out for PDF notebooks.
- [todo] 108. Add fit-width for PDF notebooks.
- [todo] 109. Add annotated PDF export.
- [todo] 110. Add upload progress for PDF import.
- [todo] 111. Add friendly PDF upload error messages.
- [todo] 112. Validate PDF file type before upload.
- [todo] 113. Validate PDF file size before upload.
- [todo] 114. Show file name after PDF import.
- [todo] 115. Allow renaming imported PDF notebooks.
- [done] 116. Make “Import PDF as notebook” separate from “Upload PDF to Library.”
- [done] 117. Avoid vague wording like “file metadata.”
- [done] 118. Support PDF notebooks inside folders.
- [done] 119. Make PDF notebooks work well on iPad.
- [done] 120. Make PDF annotations autosave reliably.

### D. Image notebooks/uploads

- [partial] 121. Allow image upload as notebook.
- [partial] 122. Support JPEG uploads.
- [todo] 123. Support PNG uploads.
- [todo] 124. Support WebP uploads.
- [todo] 125. Let students annotate uploaded worksheet photos.
- [todo] 126. Let students annotate screenshots.
- [todo] 127. Let students annotate diagrams.
- [todo] 128. Add image upload progress.
- [todo] 129. Add friendly image upload errors.
- [todo] 130. Validate image file type before upload.
- [todo] 131. Validate image file size before upload.

### E. Folders

- [todo] 132. Make folders feel like broad study spaces, not tiny topics.
- [todo] 133. Clean up folder cards.
- [todo] 134. Show only folder object and folder name on folder cards.
- [todo] 135. Remove unnecessary folder counts from main folder cards.
- [todo] 136. Remove unnecessary folder descriptions from main folder cards.
- [todo] 137. Remove unnecessary folder bubbles/chips.
- [todo] 138. Remove weird white circular icon backing from folders.
- [todo] 139. Centre folder icons properly.
- [todo] 140. Centre or consistently align folder names.
- [todo] 141. Make folder cards more compact.
- [todo] 142. Make folder icons look less AI-generated.
- [todo] 143. Redesign folder icons to be flatter and cleaner.
- [todo] 144. Make folder icons consistent in stroke and style.
- [todo] 145. Make folder colours feel intentional.
- [todo] 146. Improve folder empty state when no folders exist.
- [todo] 147. Replace awkward empty create-folder layout with a clean centred card.
- [todo] 148. Add clear empty state: “Create your first study space.”
- [todo] 149. Make Create Folder button obvious.
- [todo] 150. Prevent duplicate folders from double-clicking Create.
- [todo] 151. Disable Create button while folder is saving.
- [todo] 152. Add quick rename action for folders.
- [todo] 153. Add clear edit folder modal.
- [todo] 154. Add safe archive action for folders.
- [todo] 155. Warn that archiving folder does not delete decks/sources.
- [todo] 156. Make folder detail tabs clean: Notebooks, Decks, Sources, Progress.
- [todo] 157. Add obvious folder actions: Create notebook, Import PDF, Add deck, Add source.
- [todo] 158. Make folder detail page feel like one subject/module hub.
- [todo] 159. Preserve selected folder tab after refresh.
- [todo] 160. Add breadcrumb: Folders > Biology.

### F. Decks

- [todo] 161. Improve deck card layout.
- [todo] 162. Make deck cards more compact.
- [todo] 163. Fix awkward deck title wrapping.
- [todo] 164. Make long deck names truncate cleanly.
- [todo] 165. Show full deck name on hover or detail page.
- [todo] 166. Show only useful deck metadata.
- [todo] 167. Show card count on deck cards.
- [todo] 168. Show due count on deck cards.
- [todo] 169. Show folder label only if useful.
- [todo] 170. Add quick Study action on deck cards.
- [todo] 171. Add quick Add Card action on deck cards.
- [todo] 172. Add quick Edit Deck action on deck cards.
- [todo] 173. Add quick View Cards action on deck cards.
- [todo] 174. Make deck colour visually meaningful.
- [todo] 175. Make deck colour carry through to review mode.
- [todo] 176. Prevent duplicate deck creation from double-clicking.
- [todo] 177. Disable deck create button while saving.
- [todo] 178. Add quick rename action for decks.
- [todo] 179. Add confirmation before deleting decks.
- [todo] 180. Clarify delete vs remove from folder for decks.
- [todo] 181. Preserve deck page state after refresh.
- [todo] 182. Add breadcrumb for deck detail pages.

### G. Flashcards and review

- [todo] 183. Make actual flashcard background match selected deck/card colour.
- [todo] 184. Use subtle colour tint/gradient based on selected colour.
- [todo] 185. Keep flashcard text contrast readable on all colours.
- [todo] 186. Make review flashcard larger and more central.
- [todo] 187. Improve flashcard flip animation.
- [todo] 188. Make rating buttons clearer.
- [todo] 189. Use consistent labels: Again, Hard, Good, Easy.
- [todo] 190. Add Space shortcut to flip flashcards.
- [todo] 191. Add 1/2/3/4 shortcuts for rating cards.
- [todo] 192. Show “Card X of Y” clearly.
- [todo] 193. Show session progress clearly.
- [todo] 194. Improve review completion summary.
- [todo] 195. Show reviewed count after session.
- [todo] 196. Show accuracy after session.
- [todo] 197. Show next due cards after session.
- [todo] 198. Show goal progress after session.
- [todo] 199. Make review mode clean on mobile.
- [todo] 200. Make review buttons easier to tap on mobile.
- [todo] 201. Prevent accidental double-rating.
- [todo] 202. Disable rating buttons briefly after click.
- [todo] 203. Keep review flow fast and distraction-free.
- [todo] 204. Make flashcard empty state action-focused.
- [todo] 205. Make “Add first card” obvious when deck is empty.

### H. Card creation and Cards page

- [todo] 206. Make manual card creation faster.
- [todo] 207. Add Ctrl/Cmd + Enter to save card.
- [todo] 208. Keep user in add-another-card mode after saving.
- [todo] 209. Make front/back fields larger.
- [todo] 210. Make deck selection obvious.
- [todo] 211. Make tags optional and less visually overwhelming.
- [todo] 212. Hide advanced card types unless reliable.
- [todo] 213. Add compact list/table view on Cards page.
- [todo] 214. Add grid/list toggle on Cards page.
- [todo] 215. Improve card search.
- [todo] 216. Filter cards by deck.
- [todo] 217. Filter cards by folder.
- [todo] 218. Filter cards by tag.
- [todo] 219. Filter cards by due status.
- [todo] 220. Filter cards by weak status.
- [todo] 221. Filter cards by new status.
- [todo] 222. Make card previews less vertically huge.
- [todo] 223. Add bulk add tag action.
- [todo] 224. Add bulk move deck action.
- [todo] 225. Add bulk delete action.
- [todo] 226. Add confirmation before bulk delete.
- [todo] 227. Make selected card state obvious.
- [todo] 228. Make filter chips easy to clear.
- [todo] 229. Add “Clear all filters.”
- [todo] 230. Improve no-results state for card search.
- [todo] 231. Make long card text truncate cleanly.
- [todo] 232. Add full card preview on click.
- [todo] 233. Prevent duplicate cards from double-clicking Save.
- [todo] 234. Disable Save Card button while saving.

### I. Goals

- [todo] 235. Fix goal creation not saving.
- [todo] 236. Make active goal appear immediately after creation.
- [todo] 237. Persist active goals after refresh.
- [todo] 238. Show clear error if goal creation fails.
- [todo] 239. Do not let goal creation fail silently.
- [todo] 240. Make deadline optional for simple goals.
- [todo] 241. Add simple goal presets.
- [todo] 242. Example preset: Review 10 cards today.
- [todo] 243. Example preset: Review 20 cards this week.
- [todo] 244. Example preset: Hit 80% accuracy.
- [todo] 245. Show target card count on goal card.
- [todo] 246. Show accuracy target on goal card.
- [todo] 247. Show deadline on goal card.
- [todo] 248. Show progress so far on goal card.
- [todo] 249. Show reward preview on goal card.
- [todo] 250. Add goal progress bar.
- [todo] 251. Add goal edit action.
- [todo] 252. Add goal cancel/archive action.
- [todo] 253. Add confirmation before deleting/cancelling goal.
- [todo] 254. Fix goal date/time overlap on narrower screens.
- [todo] 255. Stack date and time fields on narrow screens.
- [todo] 256. Test goal layout on laptop, iPad, tablet, and phone.
- [todo] 257. Disable Create Goal while saving.
- [todo] 258. Prevent duplicate goals from double-clicking.
- [todo] 259. Explain why Create Goal button is disabled.
- [todo] 260. Make goals page empty state clearer.
- [todo] 261. Add “Create your first goal” button on empty goals page.

### J. Deadline bubbles

- [todo] 262. Fix deadline bubble styling.
- [todo] 263. Make deadline bubbles smaller.
- [todo] 264. Make deadline bubbles cleaner.
- [todo] 265. Align deadline bubbles properly.
- [todo] 266. Avoid long deadline text inside tiny pills.
- [todo] 267. Use simple labels like Due today, Due tomorrow, Overdue.
- [todo] 268. Make overdue deadline styling clear.
- [todo] 269. Make urgent deadline styling clear.
- [todo] 270. Ensure deadline bubbles wrap properly on small screens.
- [todo] 271. Prevent deadline bubbles from overlapping other content.
- [todo] 272. Reduce visual dominance of deadline bubbles.

### K. Notifications and reminders

- [todo] 273. Test whether notification reminders actually work.
- [todo] 274. Add clear browser notification permission flow.
- [todo] 275. Show reminder permission status.
- [todo] 276. Show “Reminders off.”
- [todo] 277. Show “Reminders enabled.”
- [todo] 278. Show “Notifications blocked in browser settings.”
- [todo] 279. Show “Next reminder: 7:00 PM.”
- [todo] 280. Make reminder settings persist after refresh.
- [todo] 281. Make reminders persist after logout/login.
- [todo] 282. Handle unsupported mobile browser notifications clearly.
- [todo] 283. Add friendly error if reminders cannot be enabled.
- [todo] 284. Avoid pretending reminders work if browser blocks them.
- [todo] 285. Make reminder time picker responsive.
- [todo] 286. Prevent reminder time fields from overlapping.
- [todo] 287. Make reminder controls easy to tap on mobile.

### L. In-app toast notifications

- [todo] 288. Auto-dismiss all toast notifications after around 3 seconds.
- [todo] 289. Auto-dismiss green success notifications.
- [todo] 290. Auto-dismiss red error notifications.
- [todo] 291. Auto-dismiss settings saved notifications.
- [todo] 292. Auto-dismiss page added notifications.
- [todo] 293. Auto-dismiss notebook saved notifications.
- [todo] 294. Auto-dismiss folder/deck/card created notifications.
- [todo] 295. Add smooth fade/slide away animation.
- [todo] 296. Still allow manual dismiss before auto-dismiss.
- [todo] 297. Prevent multiple toasts from stacking messily.
- [todo] 298. Limit toast width on narrow screens.
- [todo] 299. Keep toast text short and clear.
- [todo] 300. Show longer detail only where absolutely necessary.

### M. Stars

- [todo] 301. Connect Stars clearly to completed goals.
- [todo] 302. Show empty Stars explanation.
- [todo] 303. Add “Complete goals to build your constellation.”
- [todo] 304. Add “Create your first goal” button on Stars page.
- [todo] 305. Show star reward preview before completing goal.
- [todo] 306. Animate star appearing after goal completion.
- [todo] 307. Vary star size based on goal difficulty.
- [todo] 308. Vary star brightness based on goal difficulty.
- [todo] 309. Reward longer streaks with rarer stars.
- [todo] 310. Make Stars page feel less empty for new users.
- [todo] 311. Show recent earned stars.
- [todo] 312. Show which goal earned each star.
- [todo] 313. Make constellation layout cleaner.
- [todo] 314. Avoid making Stars feel disconnected from studying.

### N. Today/Home page

- [todo] 315. Move Today button/action closer to the top-right edge.
- [todo] 316. Align Today header actions neatly.
- [todo] 317. Avoid buttons floating awkwardly near the centre.
- [todo] 318. Make Today page action-first.
- [todo] 319. Show one dominant recommended action.
- [todo] 320. Recommend due reviews when cards are due.
- [todo] 321. Recommend continuing notebook when notebook activity exists.
- [todo] 322. Recommend creating a folder when no folder exists.
- [todo] 323. Recommend creating a deck/notebook when folder exists but is empty.
- [todo] 324. Recommend adding cards when deck is empty.
- [todo] 325. Recommend reviewing when cards exist.
- [todo] 326. Recommend setting a goal after reviews.
- [todo] 327. Recommend claiming/viewing star after goal completion.
- [todo] 328. Reduce Today page clutter.
- [todo] 329. Avoid turning Today into an analytics dashboard.
- [todo] 330. Make Today mobile layout clean.
- [todo] 331. Make Today empty state useful.

### O. Progress page

- [todo] 332. Improve new-user Progress empty state.
- [todo] 333. Explain how to unlock progress insights.
- [todo] 334. Show steps: create deck, add cards, review, set goal.
- [todo] 335. Add disabled preview widgets for future progress stats.
- [todo] 336. Show cards reviewed this week.
- [todo] 337. Show due cards.
- [todo] 338. Show weak cards.
- [todo] 339. Show strongest decks.
- [todo] 340. Show weakest decks.
- [todo] 341. Show goal progress.
- [todo] 342. Show streak.
- [todo] 343. Show recent notebook activity.
- [todo] 344. Show upcoming deadlines.
- [todo] 345. Avoid too many confusing percentages.
- [todo] 346. Avoid unexplained mastery scores.
- [todo] 347. Make every progress insight link to an action.
- [todo] 348. Weak deck should link to review.
- [todo] 349. Due cards should link to Start Review.
- [todo] 350. Empty notebook should link to Continue Notebook.
- [todo] 351. Missed goal should link to Create Easier Goal.
- [todo] 352. No activity should link to Study for 10 minutes.
- [todo] 353. Keep Progress constructive rather than judgmental.
- [todo] 354. Keep Progress narrow and readable.
- [todo] 355. Make Progress mobile layout clean.
- [todo] 356. Preserve Progress section/filter after refresh.

### P. Library and Sources, non-AI only

- [todo] 357. Make Library useful as a study material hub without generation features.
- [todo] 358. Add PDF upload to Library.
- [todo] 359. Add image upload to Library.
- [todo] 360. Add link source type.
- [todo] 361. Add typed note source type.
- [todo] 362. Add pasted text source type.
- [todo] 363. Add uploaded document source type.
- [todo] 364. Let users rename sources.
- [todo] 365. Let users tag sources.
- [todo] 366. Let users move sources to folders.
- [todo] 367. Let users attach sources to multiple folders.
- [todo] 368. Let users remove source from folder without deleting globally.
- [todo] 369. Warn before deleting source globally.
- [todo] 370. Add source archive option.
- [todo] 371. Show source title clearly.
- [todo] 372. Show source type icon.
- [todo] 373. Show linked folder on source card.
- [todo] 374. Show upload/add date on source card.
- [todo] 375. Show small preview where useful.
- [todo] 376. Avoid technical source wording.
- [todo] 377. Replace “source metadata” with “Details” or “File info.”
- [todo] 378. Filter Library by folder.
- [todo] 379. Filter Library by type.
- [todo] 380. Filter Library by subject.
- [todo] 381. Filter Library by recent.
- [todo] 382. Search source titles.
- [todo] 383. Search source notes.
- [todo] 384. Improve source card layout.
- [todo] 385. Reduce source card chips.
- [todo] 386. Remove overwhelming source action panels.
- [todo] 387. Primary source actions should be Open, Move, Rename, Delete/Archive.
- [todo] 388. Add source upload progress.
- [todo] 389. Add friendly source upload errors.
- [todo] 390. Validate source file type.
- [todo] 391. Validate source file size.
- [todo] 392. Let source PDFs open/preview.
- [todo] 393. Let source images open/preview.
- [todo] 394. Show source file size.
- [todo] 395. Show source page count if available.
- [todo] 396. Keep Library layout clean on mobile.
- [todo] 397. Avoid horizontal scroll in Library.
- [todo] 398. Add no-sources empty state.
- [todo] 399. Add “Upload PDF,” “Add note,” and “Add link” buttons.
- [todo] 400. Keep Library separate from notebook annotation flow.

### Q. Sign-in and auth pages

- [partial] 401. Fix sign-in page layout.
- [todo] 402. Put sign-in options underneath the “How Jami works” explanation.
- [todo] 403. Remove awkward bottom-left gap on sign-in page.
- [todo] 404. Make sign-in page fit into one clean screen.
- [todo] 405. Stack sign-in sections cleanly on smaller screens.
- [todo] 406. Make sign-in card align better with explanation card.
- [todo] 407. Reduce random dead space on auth pages.
- [partial] 408. Make Google sign-in button visually clear.
- [partial] 409. Make email sign-in option visually clear.
- [todo] 410. Make auth errors friendly.
- [todo] 411. Avoid technical auth error messages.
- [todo] 412. Keep auth page first impression polished.
- [todo] 413. Check layout after sign-up and login redirects.

### R. General layout and whitespace

- [todo] 414. Do full whitespace audit across app.
- [todo] 415. Fix random empty spaces.
- [todo] 416. Fix awkward gaps.
- [todo] 417. Stretch cards where space should be used.
- [todo] 418. Avoid cards floating in the middle for no reason.
- [todo] 419. Fix dashboard spacing.
- [todo] 420. Fix folder page spacing.
- [todo] 421. Fix notebook grid spacing.
- [todo] 422. Fix deck page spacing.
- [todo] 423. Fix cards page spacing.
- [todo] 424. Fix goals page spacing.
- [todo] 425. Fix progress page spacing.
- [todo] 426. Fix Library page spacing.
- [todo] 427. Fix source page spacing.
- [todo] 428. Fix notebook editor spacing.
- [todo] 429. Make page headers align consistently.
- [todo] 430. Make action buttons align consistently.
- [todo] 431. Reduce oversized dashboard blocks.
- [todo] 432. Make card heights more consistent.
- [todo] 433. Avoid huge vertical gaps under content.
- [todo] 434. Make forms feel intentionally placed.
- [todo] 435. Improve layout on narrower laptop screens.
- [todo] 436. Improve layout on tablets.
- [todo] 437. Improve layout on phones.

### S. Buttons and interactions

- [todo] 438. Make button hierarchy consistent.
- [todo] 439. Use primary style only for main action.
- [todo] 440. Use secondary style for less important actions.
- [todo] 441. Use danger style only for destructive actions.
- [todo] 442. Avoid too many equal-weight buttons.
- [todo] 443. Disable buttons while saving.
- [todo] 444. Show Creating/Saving/Importing state on buttons.
- [todo] 445. Prevent duplicate actions from double-clicking.
- [todo] 446. Make disabled buttons explain what is missing.
- [todo] 447. Make Escape close normal modals.
- [todo] 448. Make outside click close normal modals.
- [todo] 449. Require explicit choice for destructive modals.
- [todo] 450. Make dropdowns close after selecting an option.
- [todo] 451. Make selected dropdown option visibly applied.
- [todo] 452. Improve hover states on buttons.
- [todo] 453. Improve pressed/clicked states on buttons.
- [todo] 454. Improve focus states for keyboard users.
- [todo] 455. Make all clickable cards show pointer cursor.
- [todo] 456. Add subtle hover lift to clickable cards.
- [todo] 457. Add clear click states to cards.
- [todo] 458. Keep button wording consistent.
- [todo] 459. Use Create for forms.
- [todo] 460. Use Save for edits.
- [todo] 461. Use Study for decks.
- [todo] 462. Use Continue for notebooks.
- [todo] 463. Use Open for files/sources.
- [todo] 464. Use Remove from folder when not deleting globally.
- [todo] 465. Use Delete only when actually deleting.

### T. Search, filters, navigation

- [todo] 466. Add better search empty states.
- [todo] 467. Show “No results for…” after searches.
- [todo] 468. Add clear search button.
- [todo] 469. Add create action from no-results state.
- [todo] 470. Add visible active filter chips.
- [todo] 471. Add x button to remove individual filters.
- [todo] 472. Add Clear all filters.
- [todo] 473. Preserve filters after refresh where useful.
- [todo] 474. Preserve selected tab after refresh.
- [todo] 475. Preserve notebook page after refresh.
- [todo] 476. Add breadcrumbs on deeper pages.
- [todo] 477. Use breadcrumbs like Folders > Biology > Notes.
- [todo] 478. Make navigation between folder/deck/notebook clearer.
- [todo] 479. Make sidebar active state clearer.
- [todo] 480. Make sidebar groups less cluttered.
- [todo] 481. Keep mobile navigation simple.
- [todo] 482. Avoid hiding important actions too deeply.

### U. Empty states and onboarding

- [todo] 483. Add simple first-user journey.
- [todo] 484. Step 1: Create folder.
- [todo] 485. Step 2: Add notebook or deck.
- [todo] 486. Step 3: Add cards.
- [todo] 487. Step 4: Review cards.
- [todo] 488. Step 5: Set goal.
- [todo] 489. Step 6: Earn stars.
- [todo] 490. Add action-focused empty states everywhere.
- [todo] 491. Empty folders should say Create your first study space.
- [todo] 492. Empty decks should say Create a deck.
- [todo] 493. Empty cards should say Add your first flashcard.
- [todo] 494. Empty notebooks should say Create notebook or import PDF.
- [todo] 495. Empty Stars should say Complete a goal.
- [todo] 496. Empty Library should say Upload PDF, image, link, or note.
- [todo] 497. Empty Progress should explain how to unlock insights.
- [todo] 498. Avoid lonely empty pages.
- [todo] 499. Avoid over-explaining empty states.
- [todo] 500. Add dismissible onboarding card.
- [todo] 501. Add global quick-create button.
- [todo] 502. Quick-create should offer Folder, Notebook, Deck, Card, Goal, Source, Import PDF.

### V. Mobile and tablet

- [todo] 503. Make iPad a first-class experience.
- [todo] 504. Make Apple Pencil writing reliable.
- [todo] 505. Improve palm rejection where possible.
- [todo] 506. Make notebook toolbar reachable on iPad.
- [todo] 507. Make toolbar usable in portrait.
- [todo] 508. Make toolbar usable in landscape.
- [todo] 509. Increase tap targets.
- [todo] 510. Add safe spacing near iPhone home bar.
- [todo] 511. Add safe spacing near browser toolbar.
- [todo] 512. Avoid tiny dropdowns on mobile.
- [todo] 513. Avoid cramped icon rows on mobile.
- [todo] 514. Make review buttons easy to tap.
- [todo] 515. Make Today readable on mobile.
- [todo] 516. Make Progress readable on mobile.
- [todo] 517. Make Library readable on mobile.
- [todo] 518. Let phone users view notebooks.
- [todo] 519. Let phone users add light typed notes.
- [todo] 520. Show “Notebook editing works best on iPad or desktop.”
- [todo] 521. Add “Continue anyway” for full notebook editing on phone.
- [todo] 522. Avoid horizontal scroll on mobile.
- [todo] 523. Test narrow screens where date/time overlap.
- [todo] 524. Test smaller laptop widths.
- [todo] 525. Test tablet widths.
- [todo] 526. Test phone widths.

### W. Reliability and data safety

- [todo] 527. Add clear save/error states everywhere.
- [todo] 528. Add retry for failed saves.
- [todo] 529. Warn when offline.
- [todo] 530. Show unsaved work clearly.
- [todo] 531. Prevent silent data loss.
- [todo] 532. Add loading skeletons instead of blank screens.
- [todo] 533. Add skeletons for dashboard cards.
- [todo] 534. Add skeletons for folder grids.
- [todo] 535. Add skeletons for notebook grids.
- [todo] 536. Add skeletons for deck pages.
- [todo] 537. Add skeletons for progress.
- [todo] 538. Add skeletons for Library.
- [todo] 539. Fix layout shifts when data loads.
- [todo] 540. Avoid cards jumping after load.
- [todo] 541. Add friendly errors instead of technical messages.
- [todo] 542. Add confirmation for deleting folders.
- [todo] 543. Add confirmation for deleting notebooks.
- [todo] 544. Add confirmation for deleting decks.
- [todo] 545. Add confirmation for deleting cards.
- [todo] 546. Add confirmation for deleting sources.
- [todo] 547. Add confirmation for archiving folders.
- [todo] 548. Add confirmation for clearing notebook pages.
- [todo] 549. Clarify archive vs delete.
- [todo] 550. Clarify remove from folder vs delete globally.
- [todo] 551. Show confirmation after moving items.
- [todo] 552. Auto-dismiss move confirmations after 3 seconds.
- [partial] 553. Keep uploaded files user-scoped.
- [partial] 554. Make refresh not lose user position.
- [partial] 555. Make logout/login preserve saved data correctly.

### X. Visual design polish

- [partial] 556. Remove unnecessary bubbles across the app.
- [done] 557. Reduce decorative labels.
- [done] 558. Remove repeated helper text.
- [done] 559. Remove long descriptions from object cards.
- [done] 560. Remove labels that repeat the page title.
- [todo] 561. Make the app feel calmer and less busy.
- [todo] 562. Improve typography consistency.
- [todo] 563. Improve heading hierarchy.
- [todo] 564. Improve small text contrast.
- [todo] 565. Improve colour contrast in dark mode.
- [todo] 566. Add light mode eventually only if already supported or low-risk; otherwise track it as future work.
- [todo] 567. Check every theme/colour for button text contrast.
- [todo] 568. Make folder/deck/card colours consistent.
- [todo] 569. Avoid random colour use.
- [todo] 570. Make colour mean something.
- [todo] 571. Make status colours consistent.
- [todo] 572. Make danger colours consistent.
- [todo] 573. Make success colours consistent.
- [todo] 574. Make deadline colours consistent.
- [todo] 575. Make visual identity feel less generated.
- [todo] 576. Make UI objects feel native to the app.
- [todo] 577. Polish cards so they feel less prototype-like.
- [todo] 578. Make dashboard cleaner and more focused.
- [todo] 579. Make the app feel more like a student workspace.
- [todo] 580. Remove unfinished/irrelevant actions until ready.

## Verification Notes

- Browser Use requested; Node REPL browser tool is not exposed in this session yet, so browser QA will use local dev server and available alternatives until Browser Use is callable.
