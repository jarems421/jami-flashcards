# Parser priority

Ordered by what each source lets us **measure that we currently cannot**, then by
effort. Effort estimates assume the existing Qualifications Scotland parser
(`lib/evaluation/sources/qualifications-scotland.ts`) as the starting point.

Nothing here is ingested yet.

---

## 1. SQA Modern Studies and Psychology assignments — do this first

`sqa-higher-modern-studies-assignment`, `sqa-higher-psychology`
**~44 records · 1–2 days · new parser, same publisher**

The only **typed** sources in the audit with **per-mark reasons**.

Every criterion record the corpus holds today is a photograph, so "Jami misreads
the handwriting" and "Jami misjudges the work" cannot be told apart by
measurement — it has taken hand-reading individual scripts, which does not
scale. A typed source with per-mark reasons separates them directly, and that
question currently gates the interpretation of every accuracy number we have.

Commentary is prose rather than bulleted, so the mark-statement parser needs
rewriting even though the document furniture is familiar:

> This was awarded 1 framing knowledge and understanding (KU) mark.
> ♦ Description of the aim, procedure and results of the Weaver et al (2010) study. (2 marks)

Also the first non-quantitative criterion-level data of any kind — the essay
branch of the marking prompt has never been measured.

## 2. SQA National 5 and Advanced Higher maths — cheapest real gain

`sqa-national5-maths`, `sqa-advanced-higher-maths`
**~110 records · half a day · existing parser plus file globs**

Byte-identical commentary format to Higher Maths:

> The candidate was awarded 2/3 marks. • 1 correct multipliers. • 2 incorrect
> power. • 3 follow through working met the criterion for this mark.

Adds the **level** dimension the corpus entirely lacks — National 5 is
GCSE-equivalent, Advanced Higher sits above A-level — so it answers whether
accuracy holds across difficulty, which matters because students span that range.

**Deduplicate first:** `sqa-advanced-higher-maths` (2025-26) probably overlaps
`qualifications-scotland-advanced-higher` (2025).

## 3. SQA Higher Maths back-years — power, which the benchmark badly needs

`sqa-higher-maths` (2018, 2019, 2022-23, 2023-24)
**~150 records · half a day · existing parser plus file globs**

The current benchmark cannot detect the effects being chased. With 89 records
and ~80% agreement there are only about twenty discordant marks, and losing
fifteen records to timeouts has twice been enough to flip a conclusion between
p = 0.0044 and p = 0.29. **No further accuracy hypothesis is worth testing until
this is fixed**, and tripling the maths records is the cheapest fix available.

**Deduplicate first:** the 2023 question papers and marking instructions are
already in `qualifications-scotland` under different names
(`NH_Mathematics_Paper1-Non-calculator_2023.pdf` versus
`higher-2023-2023 Question paper 1.pdf`).

## 4. SQA sciences — does the finding generalise past maths?

`sqa-higher-physics`, then `sqa-higher-chemistry`, `sqa-higher-biology`
**~130 records · 1–2 days · two new commentary shapes**

Physics is per-question per-response; chemistry and biology are section-scored
assignments. Both give reasons, in different prose from anything parsed so far.

Every claim made this week is about Higher Maths. These say whether the
generosity is a property of quantitative marking or of one subject — a question
about Jami rather than about Scotland, so the answer transfers to any board.

Physics also brings graphs and circuit diagrams, which is where the only genuine
*vision* failure appeared.

## 5. SQA Higher English (RUAE only) — split the folder

`sqa-higher-english`
**~40 records · 1 day · needs a paper-type filter**

RUAE commentary cites numbered marking-instruction bullets and qualifies. The
critical essay papers in the same folder are holistic band judgements and do not.

**Ingesting the folder wholesale would silently mix the two** and put holistic
totals into a criterion benchmark. The parser must select on paper type, and
refuse anything it cannot classify.

## 6. Pearson GCSE Maths — the first English-board source

`pearson-gcse-maths`
**~120 records · 2 days · new publisher, new format**

Not criterion-level: reasons attach to sub-questions, not numbered marks. Worth
doing anyway because it is the only English-board candidate work with real
examiner comments in the whole audit, and GCSE is a stage with no per-mark
coverage at all.

Would measure whether Jami attributes to the right *part* — weaker than the mark
question, but on the qualification students actually sit.

---

## Verify before scheduling any work

Nine single-file Pearson and OCR folders are unverified. The three checked so far
were all **examiners' reports**, which mark no individual script and are useless
for accuracy:

`pearson-alevel-further-maths`, `pearson-gcse-chemistry`, `pearson-gcse-business`,
`pearson-gcse-english-language`, `pearson-gcse-spanish`, `pearson-igcse-geography`,
`ocr-gcse-combined-science`, `ocr-alevel`, `ocr-gcse`

Ten minutes each with the recognition test. Do not schedule parser work on any of
them until one has been opened.

## Explicitly not worth parsing

- **`ocr-a-level-maths-h240`** — examiners' report only. It was priority 2 on the
  acquisition list and it cannot be used. English-board A-level maths remains
  unavailable.
- **`pearson-alevel-spanish`, `pearson-alevel-german`, `pearson-ial-french`** —
  examiners' reports. **The languages branch of the marking prompt still has no
  evidence behind it**, despite four language folders having been downloaded.
- **`cambridge-international-alevel`** — landing pages, no payload.
- **`university-model-solutions`** — model answers, no candidate work.
- **`engsaf`** — access request only.

## Deferred, with reasons

- **`DREsS_*`** (28,565 rows) — typed essays with analytic trait scores and **no
  reasons**. Large and tempting; it can measure trait agreement but not *why*,
  which is the question that matters. Also overlaps `asap-2` via ASAP++.
- **`drawedumath`** — teacher *descriptions*, not marks, and **CC BY-NC 4.0**.
  Vision stress-testing only.
- **`edu-circuit-hw`** — substantially a study of LLM grading; the judgements are
  model output, not examiner reasoning.
- **`jorgpt-2026`, `asap-2.0`** — later releases of already-ingested sources;
  compare before ingesting rather than adding.

## One-off housekeeping

**`A Dataset of Digitized Student Examination Papers,`** holds the real payload
for `handwritten-university-data-science`, which is already ingested from a
4-file folder. There is also an empty `... (1)` copy. Resolve which path the
ingest reads before either is touched — ingesting both double-counts 544 records.

`Student_MCQ.csv` in that folder carries **real student names**. The existing
ingest never opens it and uses the anonymised marks file instead; any new parser
must inherit that.

## Licence reality

Thirteen of the fourteen criterion-level sources are SQA, and **all SQA material
is measure-only** — benchmarking is fine, redistribution is not. So the entire
criterion-level corpus can measure Jami but can never be shown to a student.

The newly crawled `sqa-*` folders carry **no licence evidence** beside the
payload, unlike the older ones. Worth copying the terms in before the provenance
is lost.
