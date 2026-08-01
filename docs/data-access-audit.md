# Data access audit

Audited 2026-08-01 as part of the production-clean campaign. UI modules are
prevented by ESLint from importing Firestore or Storage directly; the reads
below are owned by domain services.

## Bounded and filtered paths

- Today keeps a 60-second in-memory fresh window and a five-minute stale
  display window, deduplicates in-flight loads, and invalidates after domain
  mutations. Warm remounts issue no reads.
- Today uses indexed active queries for folders, notebooks, topics and sources.
  It reads one folder, the most recent notebook, four pending drafts, and only
  the active sources needed to label those drafts (or one source to establish
  existence). On a cold compatibility cache, a short-lived full pass is still
  required to discover early documents missing lifecycle fields; modern
  records use the bounded indexed path and warm navigation repeats no reads.
- Today reads only active goals plus a one-document completed-goal existence
  check. The Goals page also uses an aggregate completed count; its completed,
  failed and cancelled history is cursor-paged 30 records at a time.
- Dashboard activity is cursor-paged 32 days at a time and stops at the first
  missing study day. An uninterrupted streak of any length remains exact.
- Practice cursor-pages folders and limits its recent-notebook query to three.
  Topics are loaded only if the student opens notebook editing.
- Folder tabs query positive `folderIds` membership for decks and sources.
  Notebooks, decks and sources are cursor-paged 30 records at a time.
  The unlinked-object picker performs its compatibility read only after an
  explicit click because Firestore has no `array-does-not-contain` operator.
- Active folder, notebook, source and topic lists keep their indexed
  `archived == false` or `status == active` query as the primary path.
  Firestore equality filters omit documents where that field is absent, so a
  60-second in-memory, in-flight-deduplicated compatibility pass merges only
  records whose lifecycle value is missing or invalid. Domain writes
  invalidate that cache. Folder notebook/source compatibility queries remain
  scoped to exact folder membership rather than scanning the whole collection.
- Topic deletion queries `topicIds array-contains` in each linked collection;
  mastery deletion queries exact `topicId` membership.
- Source-draft duplicate context is filtered by source, draft status and kind,
  ordered newest-first, and capped at 24.
- Notification preferences are cursor-paged at 100 and processed five users
  at a time. Urgent goal counts use an aggregate deadline-range query.
- Count-only constellation and account-inventory reads use aggregate counts.
- Assistant related-source discovery merges bounded folder/topic membership
  queries with deliberately selected source documents; it no longer ranks an
  arbitrary unfiltered collection slice.
- Notebook question conversion reads only the final page number rather than
  every saved page.

The required composite indexes are declared in `firestore.indexes.json`.

## Deliberately retained complete inputs

| Read | Why the complete input remains required |
| --- | --- |
| User cards in Today, Learn, Progress and notification digest | Daily Review queues, overdue risk, FSRS state and carry-over are functions of the complete owned card set. Today deduplicates and caches its copy. |
| Cards management and deck detail | Duplicate-content warnings, bulk selection and global front-text search must see every matching card. The same read is reused rather than adding a second list query. |
| Mastery events | Current mastery totals are reconstructed from the all-time event stream; adding a stored summary model is explicitly outside this campaign. |
| Progress study activity | All-time charts and longest-streak calculations intentionally differ from Today's bounded current-streak loader. |
| Sources Library and its drafts | Search supports arbitrary substrings, including saved source content, and draft review is global. Firestore cannot cursor-page that search without an additive indexed-search representation or external search service, both excluded here. |
| Topics and relationship pickers | Topic hierarchy, legacy name compatibility, multi-object membership counts and pickers require a complete active topic vocabulary. Exact normalized-name checks are bounded; only the documented legacy-name fallback scans it. |
| Goal scope pickers | Creating a goal requires the complete current folder, deck and topic vocabulary so the student can select any existing scope. These reads happen once per Goals workspace load and are not used for history or counts. |
| Topic relationship management | A Topic detail workspace lets the student add as well as remove cards, notebooks, sources and drafts. Firestore cannot query for items whose `topicIds` array does not contain one value, so this explicit management surface loads each owned candidate set once and reuses it for overview counts, search and membership edits. Destructive Topic cleanup uses positive membership queries instead. |
| Deck and Topic overview counts | A separate aggregate per visible row creates O(number of rows) fan-out, while a stored per-row summary is forbidden by this campaign. One owned input scan is retained and shared by all row counts. |
| Notebook pages/files in the editor | Page navigation, thumbnails, immutable PDF backgrounds and save conflict handling operate on the complete open notebook. They never scan another notebook. |
| Constellation rendering and backfill | The visual surface positions every star, and legacy star/constellation records must remain readable until observed migration completes. Creation/count checks themselves are bounded. |
| Destructive cleanup and one-time migration | Deleting an account/deck/notebook/thread and the one-time topic migration must enumerate every owned target to avoid orphaning data. |
| Push subscriptions | A digest/test notification must attempt every registered device; expired entries are removed as they are encountered. |
| Legacy lifecycle compatibility | Early folders, notebooks, sources and topics may lack `archived`/`status`; the model mappers intentionally treat those shapes as active. Firestore cannot query for a missing field, so complete active lists use the short-lived compatibility pass above until a separately authorized data migration is verified. Goal history has the same cached fallback only for finished records missing the newer `createdAt` sort field; modern history remains cursor-paged. No record is rewritten or deleted by a read. |

These are explicit architecture exceptions, not accidental list implementations.
Ordinary folder browsing uses membership-scoped compatibility queries. Today
and complete active-list workspaces retain the documented 60-second cold
compatibility pass because Firestore cannot query for a missing field.
Replacing the Library or Cards global-search reads requires authorization for
an additive search index. Replacing per-deck/per-topic input scans requires
authorization for a stored summary model.

## Storage

Product flows read exact owned object paths. There is no product-facing
`listAll`. Account deletion is the sole prefix inventory, where enumeration is
the destructive operation's correctness requirement.
