# Production-clean campaign — before / after

Campaign run 2026-08-01. Baseline is `033a020`; the tip is the eight commits
listed at the end. Baseline figures were measured before any file changed.

## Query fan-out

| Path | Before | After |
| --- | --- | --- |
| Today, warm navigation | Full reload of every section on each remount | No reads inside the 60-second fresh window; stale display to five minutes; in-flight loads deduplicated |
| Today, active lists | Loaded folders, notebooks, topics and sources including archived records, then filtered in memory | Indexed active queries; one folder, the most recent notebook, four pending drafts, and only the sources needed to label them |
| Streak | Read the full activity history | Cursor-paged 32 days at a time, stopping at the first missing study day; an uninterrupted streak of any length stays exact |
| Goals | Loaded history to count completed goals | Active goals plus a one-document existence check; aggregate completed count; history cursor-paged 30 at a time |
| Folder tabs | Loaded every deck and source, filtered locally | `folderIds` membership queries, cursor-paged 30 at a time |
| Practice | Loaded all folders and notebooks | Folders cursor-paged, recent notebooks limited to three, topics only when notebook editing opens |
| Topic deletion | Scanned each linked collection | `topicIds array-contains` membership queries |
| Source-draft dedupe | Unfiltered draft slice | Filtered by source, status and kind, newest-first, capped at 24 |
| Notification digest | One unbounded preference query | Cursor-paged at 100, five users concurrent, aggregate urgent-goal count |
| Constellation / account inventory | Document reads to produce a count | Aggregate counts |

21 composite indexes were added to `firestore.indexes.json` to support the
filtered paths. Every remaining complete-collection read is justified
individually in `docs/data-access-audit.md`; those are architecture exceptions,
not oversights.

## Skipped tests

9 permanent skips → **0**. The Storage rule tests were skipping inside ordinary
Vitest because they need an emulator. Firestore and Storage rules now run only
through `vitest.rules.config.ts` under `npm run test:rules`, so `npm test`
reports no skips at all.

Suite size: 999 tests → **1,132**.

## Source-string assertions

8 test files asserted against production page or component source. All 8 are
gone:

| File | Replaced with |
| --- | --- |
| `goals-layout` | Rendered behaviour (`.tsx`) |
| `study-home-layout` | Rendered behaviour (`.tsx`) |
| `notebook-upload-ui` | Rendered behaviour (`.tsx`) |
| `notebook-navigation` | Adapter-level tests |
| `notebook-ink-viewport-integration` | Adapter-level tests against `lib/workspace/notebook-ink-runtime.ts` |
| `notebook-viewport-component` | Adapter-level tests |
| `notebook-page-background` | Rendered behaviour |
| `app-theme` | Reads only `globals.css` now |

Three static policy scans are retained on purpose, as the plan allows: theme
tokens (`app-theme`, `goals-layout`), forbidden colour patterns
(`ui-color-hygiene`), and the two rule-file suites.

## Modal migrations

`components/ui/Dialog.tsx` is the only file in the repository that writes
`aria-modal`. Nine surfaces sit on it: `ConfirmDialog`, `WorkspaceActionDialog`,
`ObjectActionsSheet`, `NotebookAddPagesDialog`, `NotebookEditorDialog`,
`CardPreviewDialog`, `SourceWorkspace`, `JamiAssistantDrawer` and
`InAppNotice`.

The foundation owns focus trapping, initial focus, restoration, nested
dialogs, reference-counted scroll locking, Escape policy, backdrop policy and
generated ARIA ids. In-app notices dismiss on Escape and ignore backdrop
clicks, so a misclick cannot silently mark a notice as seen.

## Large-page seams

| Page | Before | After |
| --- | --- | --- |
| `app/dashboard/library/page.tsx` | 1,633 | **412** |
| `app/dashboard/cards/page.tsx` | 1,124 | **218** |
| `app/dashboard/folders/[folderId]/page.tsx` | 1,164 | **1,078** |
| `app/dashboard/page.tsx` | 768 | **691** |
| `app/dashboard/study/page.tsx` | 2,119 | 2,146 |
| `app/dashboard/notebooks/[notebookId]/page.tsx` | 2,932 | 2,948 |

Study and the notebook page did not shrink, and that is the honest result.
Their state moved into named, testable hooks (`useStudyWorkspaceState`,
`useNotebookWorkspaceState`), which is what made the behaviour reachable from
tests — but the remaining length is composition and orchestration, the same
conclusion the notebook cleanup plan reached at Phase 8. Reducing them further
is a redesign decision, not a cleanup one.

## Deliberately retained compatibility code

- `/dashboard/practise` redirects permanently to `/dashboard/practice`.
- `services/study/active-compatibility.ts` — Firestore equality filters skip
  documents missing the filtered field, so early records without
  `archived`/`status` need a short-lived cached fallback pass. Removing it means
  a production data migration, which this campaign was not authorized to run.
- Legacy goals without `status` are counted by the digest through a
  deadline-scoped compatibility read.
- Legacy theme class names (`app-theme-purple-pink`, `app-theme-light`) are
  still cleaned up from restored documents.
- AI 429 responses keep their human-readable messages alongside the new
  `daily_limit` / `burst_limit` codes.

## Verification

Gate matrix at the tip: typecheck, lint (0 errors, 0 warnings), size guard,
full Vitest (1,132 passed, 0 skipped), Firestore + Storage rules, production
build, and the Playwright suite including `e2e/production-matrix.spec.ts` at
1440px desktop, 1024×1366 tablet and 390×844 phone.

**Verification caveat.** The campaign arrived as one uncommitted working tree
of 199 paths. It was carved into eight subsystem commits for review, but only
the tip is gate-verified — the intermediate commits were never materialized as
working states and were not independently run. Browser Use was unavailable in
the session, so the required localhost visual coverage was driven through the
emulator-backed Playwright matrix instead.
