# Exam-format library and paper benchmark

Jami keeps exam structure separate from the student material used to choose
subject content. The private exam-format library controls component structure,
the official specification controls assessable coverage, and deliberately
selected folder or temporary sources control taught content and emphasis.

The library covers domestic English-language written GCSE and A-level
components from AQA, Pearson Edexcel, OCR, Eduqas, WJEC and CCEA. Listening,
speaking, practical, coursework, international and Scottish qualifications are
outside this release. University papers continue to use module evidence rather
than this library.

## What a generated paper looks like

A generated paper is typeset in its board's house style
(`lib/practice/paper-house-style.ts`): AQA's boxed question numbers and
"Do not write outside the box" column, Pearson's hatched margins and
"(Total for Question 1 = 6 marks)", OCR's marks at the end of the answer line,
SQA's marks column, the WJEC and CCEA examiner column, each board's cover with
candidate boxes. Every cover still says it is a Jami practice paper; no board's
logo, paper codes or copyright line is reproduced.

The designer writes questions in the kinds the board sets for that course
(`lib/practice/question-conventions.ts`, printed into the format context), and
the same conventions go to the scheme writer and the marker.

## How each kind of question is marked

The hand-written conventions cover a few dozen kinds of question from memory.
Researched rules cover every kind each board sets, subject by subject, read
from the board's own documents (`lib/practice/question-types.ts`,
`services/ai/question-type-research.server.ts`). They're filed in
`examQuestionTypeRules` by board, qualification and subject, which clients can't
read or write. The designer, the scheme writer and the marker all prefer a
researched rule and fall back to the conventions. A question's rule is chosen
by its tariff and then by the command words and cues it uses. Where several
rules share a tariff and the question uses none of their words, no rule is
guessed.

Where the rules come from:

- The Past Paper Practice corpus: real questions with official mark schemes
  under permissions that allow AI use, sampled across every tariff and
  command word.
- The board's own website, one mark scheme per paper plus one examiner report,
  newest public series first:
  - AQA: addressed directly (`AQA-{spec}{paper}-MS-{series}.PDF`, `-CR` where
    third-party material was removed, and `-SMS` specimens for specifications
    with no public series yet, such as the 2024 languages).
  - OCR: listed on the qualification's assessment page. Components that are
    options of one paper are read once.
  - Pearson: listed by the index its pages search. Only public
    `/content/dam/pdf/` files are read. Centre-only `/content/dam/secure/` files
    are never fetched.
  - Anything else: found by search, kept only from the board's own hosts, and
    only when it names the specification code, so an old specification's
    schemes can't stand in for a new one's.

A model writes the rules, and code decides what is kept:

- A rule needs a tariff, an answer shape and an examiner rule.
- A rule that copies twelve words of its source is reworded once, then dropped
  if it still copies.
- One kind described by two sources is merged, keeping both sets of sources.

Every rule names its sources. Research is run by the owner with
`scripts/eval/research-question-types.ts`. Its `--documents` option lists what
each subject would read without calling a model, and `--report` prints what is
saved.

Coverage as of 23 September 2026 (112 subjects, 917 kinds of question):

| Board and level | Subjects with rules |
| --- | --- |
| AQA GCSE | 28 of 28 |
| OCR GCSE | 31 of 31 |
| AQA A-level | 31 of 31 |
| Pearson Edexcel GCSE | 22 of 25 |

Known gaps:

- **Pearson's 2024 languages.** French 1FR1, German 1GN1 and Spanish 1SP1
  have no public mark schemes yet, so they use the hand-written conventions.
  The corpus's French is the old 1FR0 specification and isn't used.
- **AQA's 2024 languages** (8652, 8692, 8662) are read from specimen schemes,
  because no real series is public yet.
- **1-mark questions.** In the sciences, 1-mark questions often fit several
  1-mark kinds without naming any of their words. For those no rule is chosen,
  and the question is marked from its own scheme. In the corpus, researched
  rules match between 76% (AQA Biology) and 100% of questions per subject,
  and a matched rule marks the way the official scheme does (by levels or by
  points) on all but 16 of about 2,400.
- **Written papers only.** Speaking, non-exam assessment and practical
  components aren't covered.

Graphs are stated as data, never drawn by the model: a graph asset is a JSON
chart (`lib/practice/exam-chart.ts`) that code draws as graph paper with
numbered scales, titled axes with units, plotted crosses, computed best-fit
lines, histograms at frequency density, blank grids for "plot" questions and
economics diagrams on unnumbered axes. The booklet and the app draw it with
the same code. A chart that contradicts itself -- a point off its axes, a step
that does not divide the scale, an equilibrium marked off every line -- is
refused before generation finishes.

## Profile lifecycle

- A weekly cron refreshes two board/qualification catalogue slices each day, so
  all twelve slices are revisited within a week.
- Common and benchmark profiles are researched ahead of use; rarer catalogue
  entries are researched on first matching request and cached.
- A profile is immutable by version. New official evidence creates a new
  version and existing papers retain the version with which they were made.
- `verified` requires an official specification and an official paper,
  specimen, or mark scheme plus complete duration, marks and component facts.
- Limited or conflicting evidence produces a compact student confirmation. An
  unverifiable format can only continue as a clearly labelled custom Jami
  paper.
- Owner URL, PDF and manifest imports run in a durable private workflow. Raw
  files remain under `internal/examFormatImports`; clients receive no storage
  paths.

The production gates are independent:

```text
EXAM_FORMAT_LIBRARY_ENABLED=true
PAPER_FORMAT_CONFIRMATION_ENABLED=true
PAPER_GENERATION_BENCHMARK_ENABLED=true
```

`PAPER_QUALITY_REVIEWER_UIDS` is a comma-separated, server-only Firebase UID
allowlist. Access fails closed when it is empty. Benchmark cost projection also
requires the measured `PAPER_BENCHMARK_CASE_COST_ESTIMATE_USD`; the application
does not manufacture a default estimate.

Authenticated reviewers may build or refresh private profiles before the
student-facing library flag is enabled. Cron refresh and ordinary paper
generation continue to honour `EXAM_FORMAT_LIBRARY_ENABLED`.

## Benchmark approval

The owner workspace is `/dashboard/internal/paper-quality`. It freezes twelve
component/profile versions and creates three source conditions three times for
each component, giving 108 production-realistic cases. Each case uses the
production generation, auditing and validated visual path but lives outside
student collections and allowances.

Every paper must receive a review, from a person in the workspace or from the
AI reviewer:

```text
GEMINI_DOCUMENT_MODEL=gemini-3.8-flash node --env-file-if-exists=.env.local \
  scripts/run-ts.mjs scripts/eval/paper-auto-review.ts --run=<runId> --confirm
```

The AI reviewer is Gemini, a different family from the models that write the
papers. It scores the same rubric, signs its reviews `ai:<model>`, and never
replaces a person's review; a person's review replaces it. Totals, missing
schemes, schemes about another question and failed figures are checked by code
before the model is asked, and any blocker from either makes a paper unusable.
Unanswerable questions, incorrect mark schemes, invalid totals, answer leakage,
missing inserts, broken visuals, confirmed copying, privacy failures and
ownership failures are hard blockers.
Owner approval writes an immutable content-free schema-v2 report and baseline
artifact. It does not edit the repository automatically: activating that
baseline as a deployment gate is a separate reviewed repository change.

Only synthetic, licensed or deliberately prepared source packs may enter the
benchmark. Held-out official assessment material must remain unavailable to
generation.
