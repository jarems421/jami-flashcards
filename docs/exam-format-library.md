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
