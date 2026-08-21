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

Every paper must receive a human review. Unanswerable questions, incorrect mark
schemes, invalid totals, answer leakage, missing inserts, broken visuals,
confirmed copying, privacy failures and ownership failures are hard blockers.
Owner approval writes an immutable content-free schema-v2 report and baseline
artifact. It does not edit the repository automatically: activating that
baseline as a deployment gate is a separate reviewed repository change.

Only synthetic, licensed or deliberately prepared source packs may enter the
benchmark. Held-out official assessment material must remain unavailable to
generation.
