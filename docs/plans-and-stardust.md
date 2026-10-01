# Plans, payments and stardust — design

Status: pricing agreed 28 Sep 2026, **revised 1 Oct 2026** (allowances, Exam
Pass discounts, two new allowances, costs re-measured). Not built. Re-read the
prices in §9 before launch, because model prices drift (the worker's output
price doubled in the fortnight before the first draft).

Jami becomes paid for new accounts. There is a free tier, two paid tiers, a
one-off Exam Pass, and **stardust**: a currency bought with money or earned by
answering real questions, spent in a Store in Account.

## 1. Principles

- **Never lose money on a subscriber.** Every plan's monthly allowances cost
  less than its price even when a student uses all of them and spends all the
  stardust they can earn. Daily limits alone cannot promise that: today's
  `lib/ai/budgets.ts` lets one account spend about £420 a month.
- **Existing accounts never pay.** Every account created before launch has
  lifetime access (§8).
- **Stardust rewards real work and cannot be farmed into free AI.** It is
  earned only from work the server marks, at no more than half of what the
  same thing costs in the Store, under daily and monthly caps.
- **UK only, pounds only, prices final.** Jami is not VAT-registered, so the
  shown price is the whole price.
- **Most buyers are under 18.** No random rewards, no countdown offers, no
  "your streak will break" prompts to buy, a £ price beside every stardust
  price, and a way for a parent to pay.
- **Only the server writes plans, allowances and stardust.** Clients read.

## 2. Plans

Limits follow cost × how often it is used (agreed direction 1 Oct 2026):
generous on what is cheap and used constantly, strict on what is expensive and
rare, a little strict on what is expensive and frequent.

| | Free | Plus | Pro |
|---|---|---|---|
| Price | £0 | **£7.99 / month** | **£14.99 / month** |
| *Cheap and frequent: generous* | | | |
| Tutor questions (0.28p each) | 60 | 500 | 1,000 |
| Tutor diagrams it draws (0.05p) | fair use | fair use | fair use |
| Marked past-paper answers (0.11p; a guided retry counts as one) | 25 | 250 | 600 |
| Revision Sessions (0.3p) | 8 | 60 | 120 |
| Pages the Tutor can search (0.011p a page) | 500 | unlimited (10,000 a month ceiling) | unlimited (20,000 a month ceiling) |
| Diagram cards: "find the labels for me" (0.6p) | 10 | 60 | 150 |
| Video imports (1–5p by length) | 3 | 30 | 60 |
| Everyday AI: "Draft this answer" on a card (≈0.03p), flashcards or practice questions from a file, the Tutor or a chat (≈0.5p a batch), deck study prep, answer checks, planner chats | small monthly caps (50 drafts, 10 batches each) | unlimited | unlimited |
| *Expensive and frequent: a little strict* | | | |
| Jami papers, written and marked (25p) | 1 | 6 | 12 |
| Tutor web searches (1.5p) | 5 | 30 | 60 |
| *Expensive and rare: strict* | | | |
| Generated photos in the Tutor (≈4.5p) | — | 10 | 24 |
| Re-marking a paper (8p) | stardust | stardust | stardust |
| Flashcards, notebooks, folders, uploads, planner, Today | unlimited | unlimited | unlimited |
| Stardust you can earn a month | 40 ✦ | 60 ✦ | 100 ✦ |
| **Jami keeps from a typical student** | — | **£6.12** | **£11.79** |
| Jami keeps at about half use | — | £3.65 | £6.14 |
| Jami keeps from a student maxing every allowance | — | −£1.93 | −£4.68 |

"Unlimited" pages means a monthly ceiling only an exploiter meets: 10,000 on
Plus, 20,000 on Pro (twenty and forty textbooks; at most £1.10 and £2.20). Re-indexing a source the
student already has is not counted again. Free keeps 10 file-to-cards batches
a month; on paid plans they are everyday fair use (about 0.5p a batch).

**Hidden ceilings on everything "unlimited"** (paid plans). Daily limits
alone let one account spend about £25 a month on the "unlimited" features, so
each also has a monthly ceiling set near a genuinely heavy student's use:

| Feature | Daily | Monthly | Cost at the ceiling |
|---|---|---|---|
| AI flashcard batches (up to 24 cards) | 20 | 300 | £1.50 |
| Practice question batches | 10 | 300 | £1.50 |
| "Draft this answer" presses | 150 | 1,500 | 45p (£1.80 if every press retries twice) |
| Typed-answer checks | 150 | 2,000 | 40p |
| Deck study preparation | 60 | 600 | 30p |
| Planner chats | 40 | 300 | 15p |
| Material for a weak topic (Today) | 20 | 120 | 48p |
| Tutor diagrams | 10 | 300 | 15p |
| Photo background restore | 8 | 20 | 10p |

**Full breakdown (1 Oct 2026).** Typical / moderate / maxed students, every
cost included (fair-use features, stardust, hosting, Stripe):

| | Cost: typical | moderate | maxed | Profit: typical | moderate | maxed |
|---|---|---|---|---|---|---|
| Free | £0.22 | £0.77 | £1.26 | — | — | — |
| Plus £7.99 | £1.49 | £3.96 | £9.54 | £6.12 (77%) | £3.65 (46%) | −£1.93 |
| Pro £14.99 | £2.67 | £8.32 | £19.15 | £11.79 (79%) | £6.14 (41%) | −£4.68 |

A maxed student uses every allowance in full every month. Fixed costs (Vercel
Pro £15 and the ICO fee £4.33, about £19 a month in total) are covered by four
typical Plus subscribers.

**Where each card-making path is counted.** One "cards from sources" limit
(today 10 batches a day, up to 24 cards a batch) covers every way of asking
Jami to write flashcards: from a file in Library, and from the Tutor -- out of
the student's sources or out of the chat itself. Practice questions from a
file have their own matching limit. Video imports are separate and counted
monthly (videos up to 90 minutes and 500 MB). Importing existing cards (Anki)
and uploading PDFs to notebooks use no AI and are unlimited.

**Fix while building:** the Tutor's "make me practice questions" is charged
to `practicePaperGeneration` today (`app/api/ai/assistant/study-material`), so
a quick set of questions would spend one of the student's monthly papers. It
must count as `sourcePracticeDrafts` instead.

**The guarantee changed on 1 Oct 2026.** The first draft promised a profit
even if a student maxed every allowance at once. Being generous on the cheap,
constant things makes that impossible without starving them, and nobody uses
1,000 Tutor questions, 600 marked answers and ten papers in one month. The
guarantee is now: a heavy student (60% of everything) is comfortably
profitable on every plan and pass, and the theoretical max-everything student
costs a little more than they pay (about £2.30 a month on either plan). The expensive items -- papers,
web searches, photos -- carry the strict limits, so that is where a loss could
come from, and it cannot.

Uploading a file uses no AI: its text is extracted on the server without a
model. What costs is what is done with it -- indexing it for the Tutor
(pages), making cards from it, or the Tutor reading it inside a question.

A student who uses about half their Plus allowance costs about £2, so most
subscriptions keep well above the floor shown.

"Fair use" means the existing daily limits in `AI_BUDGETS` and nothing else.
They stay in force on every plan as the ceiling on a runaway loop. Free's
everyday AI caps per month: 20 flashcard preparations, 100 answer checks, 10
planner chats, 30 card autocompletes, and 3 sets of cards from sources.

**Allowance period.** Allowances reset monthly on the anniversary of the day
the plan started (Free: the day the account was made), not on the 1st, so a
student who joins on the 28th does not get two months in four days. Unused
allowance does not roll over.

**When an allowance runs out**, the action is refused with a plain message
and two choices: spend stardust for more (§4), or upgrade. Spending stardust
is always a deliberate tap with its price shown — never automatic. Tutor web
searches are the exception: when they run out, the Tutor answers from the
student's sources without searching, and says so once.

**Upgrading** (Plus → Pro) is immediate and prorated by Stripe; the current
period's allowances become Pro's, keeping what was already used. **Downgrading**
and **cancelling** take effect at the end of the paid period. A failed renewal
keeps the plan for 7 days while Stripe retries, then drops to Free.

## 3. Exam Pass

One payment, lasting until **31 July** of the current exam year, at **25% off
Plus or 15% off Pro** against paying monthly for the months left:

```
pass price = ceil(monthly price × min(months left, 10) × (1 − discount)) − 0.01
discount   = 0.25 for Plus, 0.15 for Pro
```

| Bought in | Plus pass | Pro pass |
|---|---|---|
| September or October | £59.99 | £127.99 |
| January | £41.99 | £89.99 |
| March | £29.99 | £63.99 |
| May | £17.99 | £38.99 |

The first draft gave both 30% off. At 1 Oct costs that loses money on a Pro
student who uses everything (£2 a month on a two-month pass), and Pro still
lost at 20% off. Pro's discount is smaller because Pro is already the better
value per allowance.

Months are counted from the purchase month to July inclusive. A pass bought in
August or September runs to the following 31 July and is priced at ten months.
For a heavy student (60% of everything) the passes keep at least £1.19 a month
(Plus) and £2.80 (Pro). A pass is not a subscription: it never
renews and needs no cancelling. Its allowances reset monthly from the purchase
date, exactly like a subscription's.

There is no annual subscription. For students, the exam year is the year.
Revisit after the first exam season.

## 4. Stardust

**100 ✦ is £1** when bought in the smallest pack.

### Earning

Earned only from work the server marks, so it cannot be forged. Flashcard
reviews are recorded from the device, so they earn stars toward goals as today
but never stardust.

| Real work | Earns |
|---|---|
| A past-paper or practice answer marked (not blank) | 1 ✦ |
| A guided retry that scores higher than the first attempt | +1 ✦ |
| A full paper sat, submitted and marked | 10 ✦ |
| A Revision Session finished | 3 ✦ |

At most **15 ✦ a day**, and the monthly caps in §2 (Lifetime: 100 ✦). Each
piece of work earns once: ledger entries are keyed by what earned them (§6).

**The loop rule:** nothing earns more than half of what the same thing costs
in the Store. A marked answer earns 1 ✦ and costs 2 ✦ to buy; a paper earns
10 ✦ and costs 50 ✦. A test must hold this for every earn rule, so a later
change cannot make marking pay for itself.

### The Store (Account → Plan & Store)

| Item | Price | Cost to Jami |
|---|---|---|
| An extra Jami paper, written and marked | 50 ✦ | 23p |
| Mark a paper again | 20 ✦ | 8p |
| 10 extra marked answers | 20 ✦ | 4p |
| 25 extra Tutor questions (with up to 6 web searches) | 30 ✦ | 16p |
| 5 extra Tutor pictures | 20 ✦ | 13p |
| An extra video import | 15 ✦ | 6p |
| Cosmetics: sky themes, constellation styles, pen and accent colours *(phase 4)* | 50–300 ✦ | nothing |

Buying an item adds to the current period's allowance ("extra" credits in §6).
Extras do not expire with the period — a bought paper stays until it is used.

Stardust buys **marking and generation, never access to a past paper**. The
permission records in `lib/practice/exam-question-rights.ts` grant storage,
display and AI marking. Nothing in them covers charging for the questions
themselves.

### Packs

| Pack | Price | Stripe's cut |
|---|---|---|
| 300 ✦ | £2.99 | 8% |
| 1,100 ✦ (10% extra) | £9.99 | 3.5% |
| 2,400 ✦ (20% extra) | £19.99 | 2.5% |

Anyone can buy packs, Free included. Pay-as-you-go suits the student who
wants four papers the week before an exam.

### Rules

- Two pots: **earned** and **purchased**. Spending takes earned first.
- Neither pot expires.
- Stardust has no cash value and cannot be transferred.
- Unused *purchased* stardust is refunded on request within 14 days, as
  goodwill. The statutory right to cancel is waived at checkout (§5).
- A refunded or charged-back pack removes its stardust. If it was already
  spent, the balance goes negative and spending is blocked until it is
  positive again.
- Stars (one per completed goal, `services/study/goals.ts`) stay what they are.
  The Stars page shows the stardust balance, but the two never convert.

## 5. Payments (Stripe)

- **Products:** Plus monthly and Pro monthly (recurring GBP prices); Exam Pass
  (one-off, `price_data` computed server-side from §3); three packs (fixed
  one-off prices).
- **Checkout** in `subscription` mode for plans, `payment` mode for passes and
  packs. `client_reference_id` carries the uid. Every session requires the
  terms box, with the text: *"Start now: I understand I lose my 14-day right to
  cancel once Jami starts."* Without it a student can use a month and still
  claim a refund.
- **UK only:** a billing address is required. A card not issued in GB is
  refused by a Radar rule where the account has custom rules. Otherwise the
  webhook refunds and cancels a purchase whose card country is not GB.
- **Customer Portal** for cancelling, changing card, switching plan and
  invoices. Stripe emails receipts.
- **Ask a parent to pay:** the student makes a link (`/pay/[token]`, signed,
  single-use, expires in 7 days) and sends it. The parent sees only the plan,
  the price and the student's first name, and pays on their own device. The
  purchase lands on the student's account.
- **Webhook** `app/api/billing/webhook/route.ts` (Node runtime, raw body,
  signature checked) handles:
  - `checkout.session.completed`
  - `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`
  - `invoice.paid` and `invoice.payment_failed`
  - `charge.refunded` and `charge.dispute.created`

  Each event is processed once: its id is recorded in `stripeEvents/{eventId}`
  inside the same transaction as its effect.
- **Fees:** 1.5% + 20p per UK card payment, plus 0.7% on subscription payments.

## 6. Data

All under server-only writes. `firestore.rules` gives the owner read access
and no client writes.

| Document | Holds |
|---|---|
| `users/{uid}/billing/plan` | `plan` (`free` \| `plus` \| `pro` \| `lifetime`), `source` (`none` \| `subscription` \| `pass` \| `lifetime`), `status`, `periodStart`, `periodEnd`, `cancelAtPeriodEnd`, `passExpiresAt`, `stripeCustomerId`, `stripeSubscriptionId` |
| `users/{uid}/allowanceUsage/{periodKey}` | `used.{key}` and `extra.{key}` counters per allowance key |
| `users/{uid}/billing/stardust` | `earned`, `purchased`, `earnedToday` + `earnDayKey`, `earnedThisPeriod` + `earnPeriodKey` |
| `users/{uid}/stardustLedger/{entryId}` | Append-only: `delta`, `pot`, `kind` (`earn` \| `purchase` \| `spend` \| `refund` \| `adjust`), `reason`, `refId`, `createdAt`. Earn entries use the id `earn:{reason}:{refId}`, so the same answer can never earn twice |
| `billingCustomers/{stripeCustomerId}` | `uid` |
| `stripeEvents/{eventId}` | processed marker |

Stardust is not learning evidence and never enters the Learning Engine.

## 7. Enforcement in code

- `lib/billing/plans.ts` (pure, tested): plan definitions, allowance keys,
  the map from `AiBudgetAction` to allowance key, the pass price formula, earn
  rules, the Store catalogue, and the loop-rule test.

  | Allowance key | Actions |
  |---|---|
  | `papers` | `practicePaperGeneration`, whose first marking is included |
  | `answers` | `examQuestionMarking` and `examQuestionReview` |
  | `tutor` | `assistant` |
  | `pictures` | `tutorIllustration` |
  | `videos` | `videoCardImport` |
  | `revisionSessions` | a session start |
  | `paperMarkings` | `practicePaperMarking` beyond a paper's included marking |

  `searches` is checked inside the assistant route before research runs.
  Everything else is fair use (Free has per-action monthly caps).
- **One choke point.** `checkAiBudget` in `services/ai/budgets.ts` already
  runs before every metered call (20 callers) and has a refund path. The
  monthly allowance is checked and charged in the same transaction, with a new
  refusal reason `allowance_used`. The grant records both counters, so
  `refundAiBudget` gives back the allowance too when a generation or marking
  fails. No route needs its own billing logic.
- `services/billing/entitlements.server.ts` reads the plan, with the lifetime
  fallback (§8). `services/billing/stardust.server.ts` handles `earn`,
  `spend` (debits the ledger and adds `extra` credits in one transaction) and
  `credit` (packs, from the webhook).
- **Earn hooks** fire only after success:
  - marking completes in `services/practice/exam-marking.server.ts`
  - the paper-marking workflow finishes
  - a Revision Session reaches its end state
- **Flags** in `lib/app/feature-flags.ts`: `enableBilling` (plans, allowances,
  payments) and `enableStardust`. With both off, everyone behaves exactly as
  today, with daily limits only.

## 8. Existing accounts

`BILLING_LAUNCH_AT` (env) is the launch timestamp. Before launch,
`scripts/grant-lifetime-access.mjs` writes `plan: "lifetime"` for every Auth
account created before it (24 accounts on 26 Sep 2026).

The entitlement read also derives lifetime from the account's Auth creation
time when the plan document is missing. A missed write must never paywall an
early user.

Lifetime means today's daily limits with no monthly allowances. It can earn
(capped at 100 ✦ a month) and buy stardust.

## 9. Costs behind the numbers

Per unit, all-in, including OpenRouter's 5.5% top-up fee. $1 = £0.75.
Re-measured 1 Oct 2026.

| Unit | Priced at | Measured / basis |
|---|---|---|
| A Jami paper, written and marked | 25p | 14 Sep run ≈ $0.30; ceilings cap a runaway at £1.12 |
| A marked answer | 0.4p | 0.11p average (11 answers); supervisor tail to 1.2p |
| A Tutor question | 0.5p | 0.28p average over 126 questions, 0.37p on the worst day |
| A Tutor web search | 1.5p | Gemini grounding $14 per 1,000 after 5,000 free a month |
| A Tutor diagram / generated photo | 0.05p / 4.5p | drawn from a spec / 3.1 Flash Image |
| A page indexed for the Tutor | 0.011p | Gemini embeddings $0.20/M, ~750 tokens a page |
| Diagram label detection | 0.6p | one scaled picture, up to sixty labels out |
| A video import | 1–5p | 2.5 Flash-Lite; frames capped at 120k tokens whatever the length, so an hour is mostly audio |
| Cards from a file | 0.5p | worker, source sliced to a fixed length |
| A Revision Session | 0.3p | lesson plus up to five markings |
| Flashcard preparation (a deck) | 0.05p | 0.07p measured over 41 jobs |

Model prices read 1 Oct 2026, per million tokens in / out: worker
`z-ai/glm-5.3-flash` $0.15 / $0.50; supervisor `qwen/qwen3.6-35b-a3b` $0.15 /
$1.00; standby `moonshotai/kimi-k3` $0.69 / $10.00; juror
`moonshotai/kimi-k2.6` $0.43 / $1.83; `minimax/minimax-m3` $0.30 / $1.20;
Gemini 3.5 Flash-Lite $0.30 / $2.50; 2.5 Flash-Lite $0.10 / $0.40; 3.1 Flash
Image $0.50 in, $60 per million image tokens; embeddings $0.20.

Real usage so far is small: $1.69 over 30 days across nine accounts (Sept
2026), the heaviest $0.72. The prices above are deliberately 2–4× the measured
averages for Tutor and marking, so the floors in §2 are floors.

A student making three papers a day and using everything else heavily costs
about £41 a month. That is more than Pro includes. What they use beyond it
comes from stardust at about twice its cost, so heavy use pays for itself.

**Fixed monthly costs:**

- Vercel Pro: $20. The Hobby plan may not be used commercially.
- ICO data protection fee: £52 a year.
- Domain: optional.

That comes to about £20 a month, which four typical Plus subscribers cover.

## 10. Before launch

**Found 1 Oct 2026:** `POST /api/ai/source-index` runs no `checkAiBudget` at
all, so source indexing is unmetered and unlimited. It is cheap (6p for the
largest pack) but must get the `pages` allowance and a daily fair-use limit
before launch, like every other AI route.

**Cost safety — status 28 Sep 2026.** Items 1, 3 and 4 are built. For
item 2:

- Paper research is now shared per course for a week
  (`services/ai/course-research-cache.server.ts`).
- The research model switch was **rejected on 29 Sep**
  (`npm run eval:research-models`, 14 queries each). 2.5 Flash-Lite was
  faster and cited more, but it described AQA's History structure as WJEC's
  from third-party sites alone. A wrong exam format is disqualifying for
  paper design, so research stays on 3.5 Flash-Lite.
- The paper image switch to Flash-Lite Image was **rejected on 29 Sep**
  (`npm run eval:image-models`). Flash-Lite drew onion cells as round
  polygonal cells, and a "fault" whose beds do not move. The paper
  validator passed the worse image in both of the pairs I checked, so its
  pass rate cannot decide this.
- Tutor pictures had used Flash-Lite Image, and labelled diagrams from both
  image models had errors: Flash-Lite's heart mislabelled vessels and
  valves, and 3.1 Flash Image invented a leaf label, "SCORKA". **Built 29
  Sep:** the Tutor now describes diagrams as specs that
  `lib/ai/tutor-diagram.ts` draws: labelled parts, cycles, flows and
  circuits. This covers both its answers and "Show this visually". Only
  photo requests reach an image model, now 3.1 Flash Image, asked for no
  text. Diagrams cost about 0.05p each, against 3.4p to 6.8p for an image.
- Video Flex was **dropped**. It adds up to 15 minutes to an import the
  student is waiting on, and Google bills an abandoned Flex request, so
  falling back to standard can cost more than never using Flex. The saving
  was about 3p a video.
- Prices must also be set in Vercel: `AI_MODEL_PRICES_JSON`, whose value is
  in `.env.example`.

**Cost safety (must ship first):**

1. **Meter the Gemini calls the spend report cannot see.** Web research and
   image generation are never recorded, and video reads record 0 tokens.
   Without this, the allowances cannot be checked against real spend.
2. **Gemini savings.** Research on `gemini-2.5-flash-lite`: 1,500 free searches
   a day instead of 5,000 a month, and cheaper tokens. Revisit past about 2,500
   searches a day, where its $35 per 1,000 overtakes $14. Reuse a course's
   exam-format research across students, since the query already carries no
   personal data. Run video imports on Gemini's Flex tier (half price;
   retry on standard when Flex answers 429 or 503).
3. **A cost ceiling on paper generation**, like marking's $0.50
   (`PRACTICE_PAPER_MARKING_MAX_COST_USD`). Failover to `moonshotai/kimi-k3`
   costs 15× the supervisor's output price, and generation has no cap today.
4. **Re-read every model price** and redo §9.

**Admin and legal:**

- Vercel Pro.
- Stripe account (UK). Stripe requires the account holder to be an adult.
- ICO fee.
- **Exam-board licences:** confirm each agreement allows use inside a *paid*
  product. The register is fail-closed, so a board whose agreement does not
  cover it is switched off until it does.
- **Terms and privacy:** auto-renewal, cancellation, the 14-day waiver,
  stardust terms (no cash value, not transferable, refunds), and parent
  payment.
- **HMRC:** register as self-employed once trading income passes £1,000 a year.
  VAT registration applies at £90,000 turnover.
- **Email:** Jami's own mail goes through Gmail, which caps at roughly 500 a
  day. Move to a transactional provider before growth. Stripe sends receipts
  itself.
- **UK subscription rules (DMCC Act) from Spring 2027:** renewal reminders,
  and leaving as easy as joining. The Portal covers cancelling; reminder emails
  need adding before then.

## 11. Build phases

| Phase | What | Visible to students |
|---|---|---|
| 0 | Cost safety (§10 items 1–4), lifetime script | no |
| 1 | Plans and allowances behind `enableBilling`: `plans.ts`, usage counters, `checkAiBudget` integration, "X left this month" where each allowance is spent, Account → Plan | behind flag |
| 2 | Stripe: products, Checkout (plans, pass, packs), webhook, Portal, parent link, UK-only, waiver box | behind flag |
| 3 | Stardust behind `enableStardust`: ledger, earn hooks, Store, spend → extras, balance on Stars | behind flag |
| 4 | Cosmetics in the Store | after launch |
| 5 | DMCC reminders | before Spring 2027 |

Launch is phases 0–3 with both flags on. The Store and plan screens follow
`docs/ui-design-system.md`. They are a new surface, so they get a full design
pass and a browser check.

## 12. The market (UK, read 1 Oct 2026)

| Product | Price | What it covers |
|---|---|---|
| Quizlet Plus | £3.99 / month, £31.99 / year | flashcards |
| Save My Exams | £12 or £25 / month rolling; £48 or £96 / year | notes and exam questions; AI marking on Premium |
| Seneca | £9.99, £12.99 (exam questions), £19.99 (AI assistant) / month | courses, exam questions, AI feedback |
| StudyFetch | $7.99 or $11.99 / month | AI study sets and tutor |
| ChatGPT | Go ≈ £6, Plus ≈ £20 / month | general AI, not exam-specific |
| Goodnotes | $35.99 / year Pro | notebooks |

Plus at £7.99 sits under Seneca's exam-question tier and Save My Exams'
rolling Essential while also replacing a flashcard app and a notebook app. Pro
at £14.99 undercuts every tier that includes AI marking or a course-aware
tutor. Save My Exams' annual price (£48) is the one to watch: the Plus Exam
Pass bought in September (£59.99, ten months) is the closest answer to it.

## 13. Revisit after the first exam season (August 2027)

- Real per-plan spend against §9. Allowances can grow as costs fall.
- How many students hit each allowance, and which Store items sell.
- Whether earn caps are too tight to feel rewarding.
- Whether an annual plan is worth adding for university students.

Prices read 26 Sep 2026 from: [OpenRouter models API](https://openrouter.ai/api/v1/models),
[Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing),
[Gemini Flex](https://ai.google.dev/gemini-api/docs/flex-inference),
[Vercel](https://vercel.com/pricing), [Firebase](https://firebase.google.com/pricing),
[Stripe UK](https://stripe.com/gb/pricing),
[ICO fee](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee/),
[DMCC timing](https://www.taylorwessing.com/en/insights-and-events/insights/2026/04/subscription-contracts).
