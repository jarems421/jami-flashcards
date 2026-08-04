# Data layer: one cache, shared by every page

Written 4 August 2026, after auditing what each dashboard page actually reads.

## A correction to the premise

I first said the biggest problem was that `loadUserCards` is unbounded — no
`limit`, plus a second unbounded legacy query — and is called from seven
surfaces. That is all true, and it is **not** the problem worth solving.

`docs/data-access-audit.md` measured the live account on 1 August: **7 cards, 1
deck, 1 source, 1 topic, 17 notebooks, 52 pages**. It set explicit thresholds
before measuring — under 1,000 cards no action, 1,000–5,000 paginate the list
views, over 5,000 build summaries — and recorded why each complete read is
required (FSRS state spans the whole owned set; duplicate warnings and global
search must see every card). Reading 7 documents is not a performance problem,
and rebuilding those reads now would be work against a number that does not
exist yet.

**Volume is not the issue. Repetition is.**

## What the pages actually do

Distinct owned-data loads issued on mount, ignoring the duplicate query inside
`loadUserCards`:

| Page | Loads on mount |
| --- | --- |
| Study | 9 |
| Progress | 8 |
| Library | 6 |
| Cards | 5 |
| Topics | 5 |
| Decks | 3 |
| Today | 12, **cached** |

And they are largely *the same loads*:

| Read | Pages that issue it |
| --- | --- |
| `loadUserCards` | Today, Study, Progress, Cards, Decks, Topics |
| `getDecks` | Today, Study, Progress, Cards, Decks, Library |
| `getActiveTopics` | Today, Study, Progress, Cards, Topics, Library |
| `getActiveNotebooks` | Progress, Topics, Library |
| `getActiveSources` | Progress, Cards, Topics |
| `getGeneratedContentDrafts` | Progress, Topics, Library |
| `getActiveStudyFolders` | Cards, Decks, Library |

Today caches its snapshot and issues no reads on a warm remount. **Nothing else
caches anything.** Switching Today → Decks → Study → Today re-fetches the same
decks three times, the same cards three times, the same topics twice.

The cost is not document count, it is **round trips**. Each of those is a
separate request with its own latency, and on a phone that is the difference
between a tab that paints and a tab that spins. It is the most frequent
interaction in the app and the only one with no cache behind it.

## Most of this already exists

Two partial caches are already in the codebase, each with the right
ingredients, neither covering the reads the pages issue.

**`services/dashboard/cache.ts`** — fresh/stale windows, in-flight
deduplication, revision-based invalidation, degraded-section handling. Keyed by
`userId` alone, so it holds exactly one thing: Today's snapshot.

**`services/study/active-compatibility.ts`** — keyed by
`collection:userId`, 60-second TTL, in-flight deduplication, invalidation that
understands membership-scoped keys. But it caches only the *legacy compatibility
fallback*, not the primary indexed query beside it.

**Invalidation is already solved.** 61 call sites across 12 service files
already call `invalidateDashboardData` after a write. That discipline exists and
is maintained; it simply has one small cache to invalidate.

So this is not new infrastructure. It is one keyed read-through cache, made from
the two that are already here, applied to the reads every page shares.

## The shape

Cache **at the service layer, not the page layer.** `getDecks(uid)` becomes a
read-through: cached value if fresh, in-flight promise if one is running,
otherwise fetch. Every page that calls it benefits without being touched, and no
page learns about caching.

This is what makes the work tractable. The alternative — per-page cache adoption
— means editing seven pages, each with its own loading state, refresh button and
focus handler, and getting each one right.

### Phases

Each is one commit, fully verified, pushed before the next begins.

**1 — One cache primitive.** `services/cache/read-through.ts`. Keyed by
`collection:userId[:params]`. Fresh window, stale window, in-flight dedup,
revision invalidation. Built by generalising `dashboard/cache.ts`; that file
becomes a caller of it rather than a parallel implementation. Pure, unit-tested,
no Firestore.

**2 — Wrap the shared reads.** The seven in the table above, in their existing
services. Signature unchanged; each gains an optional `{ force?: boolean }` the
way `loadDashboardSnapshot` already has one. No page changes in this phase.

**3 — Wire the existing invalidation.** `invalidateDashboardData(userId)` bumps
the keyed entries for that user too. Start **coarse** — any write marks all of
that user's cached reads stale. Fine-grained per-collection invalidation is a
later refinement; coarse is correct, and with stale-while-revalidate the cost of
being coarse is a background refresh, not a spinner.

**4 — Stale-while-revalidate.** Return the stale value immediately and refresh
behind it, so a tab paints from cache and corrects itself. Today already does
this; the pattern is copied, not invented.

**5 — Stop the redundant reloads after writes.** The Decks page calls
`loadAll()` after every mutation (four sites), re-reading decks, folders and
every card to reflect one rename. Library does the same in four places. With
phases 1–3 these become cheap rather than free; they should update locally and
let invalidation handle the rest.

**6 — Evidence.** A dev-only read counter, so the improvement is measured rather
than asserted, and a regression is visible. `scripts/measure-data-shape.mjs`
already establishes the precedent for measuring before claiming.

## The part that can go wrong

**A stale read must never feed a write.** Grading a card computes new FSRS state
from the card's current state; starting a session, resuming one, and any
read-modify-write path must pass `{ force: true }`. This is the one rule that
makes the difference between a cache and a data-loss bug, and it is why phase 2
adds the force flag before phase 4 makes anything stale-first.

**Two devices.** A card graded on a phone will not be reflected on a laptop
until the stale window expires. Today already accepts this with a 60-second
fresh window; the same window applies here, and the focus handler already
refreshes on return.

**Tests that count reads.** Some service tests assert call counts against mocked
Firestore. A cache changes those numbers. They should be updated to assert the
*second* call issues no read — which is the behaviour worth pinning anyway.

## Not in scope, deliberately

**Pagination, aggregation and stored summaries for cards.** Deferred by
`docs/data-access-audit.md` on measured evidence, with a documented trigger:
re-measure with `scripts/measure-data-shape.mjs`, and act at 1,000 cards. Per-row
aggregate counts are explicitly recorded there as forbidden without
authorisation, because one aggregate per visible row is O(rows) fan-out.

The unbounded legacy `uid` query inside `loadUserCards` is worth removing on its
own merits — it doubles every card read for a compatibility case — but that is a
small separate change, not this plan.

## Verification

Per commit: `npm run typecheck`, `npm run lint`, focused tests for the new seam,
`npm test`, `npm run build`. `npm run test:rules` and `npm run test:e2e` before
anything touching a write path.

The behavioural claim to prove: **a warm tab switch issues no reads.** Today
already demonstrates it; the e2e suite is the place to pin it for the rest, by
navigating away and back and asserting the second visit paints without a
loading state.
