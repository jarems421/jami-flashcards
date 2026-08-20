# Marking corpus audit

Audited `C:\Users\jarem\jami-datasets` recursively on 2026-08-20.
**48 source folders, 2,179 files, 2.5 GB.** Nothing was moved, renamed, copied or
ingested; this is a read-only survey.

## The rule applied

A source is **criterion-level** only where the evidence lets us determine *why an
individual mark or rubric criterion was awarded or withheld*. A total with a
paragraph of praise is not criterion-level, however detailed the paragraph. This
matters because the product's value is telling a student *which* mark they lost
and why, and only criterion-level sources can measure whether that is true.

Applying it strictly moves several hoped-for sources into lower tiers — including
OCR A-level Maths, which was the highest-priority acquisition on the previous
list and turns out to be an examiners' report.

## Headline

**Fourteen sources are genuinely criterion-level, and thirteen of them are SQA.**
The English boards mostly published examiners' reports or holistic exemplars.
The research datasets carry scores without reasons.

This is a large gain over the corpus today, which has criterion data from exactly
one source, one subject, one level. It also concentrates risk: nearly everything
we can measure *why* on comes from one awarding body under one licence.

---

## Tier 1 — criterion-level, reasons tied to individual marks

### SQA mathematics family
`sqa-higher-maths`, `sqa-national5-maths`, `sqa-advanced-higher-maths`,
`qualifications-scotland`, `qualifications-scotland-advanced-higher`

The format already parsed. Commentaries name each mark and give the examiner's
reason:

> The candidate was awarded 1/2 marks. • 1 correct process. • 2 answer not in
> simplest form; see note 2 of the marking instructions.

Handwritten scans. National 5 and Advanced Higher use the identical structure to
Higher, so the existing parser should need little more than new file globs. This
is the cheapest expansion available and it adds the **level** dimension —
National 5 is GCSE-equivalent, Advanced Higher sits above A-level.

### SQA sciences
`sqa-higher-physics`, `sqa-higher-chemistry`, `sqa-higher-biology`

Physics is per-question, per-response, with the reason stated:

> Response 3 — 0. The candidate's final answer is acceptable, but there is a
> rounding error in the penultimate line, and so the mark is not awarded.

Chemistry and Biology are assignment-based and score by section with reasons
("awarded 1 out of 3 marks because they have provided limited explanations").
Handwritten and typed mixed; diagrams, graphs and tables throughout.

These answer a question the maths sources cannot: whether Jami's generosity is
about *mathematics* or about quantitative marking generally.

### SQA social sciences — the most valuable new material
`sqa-higher-modern-studies-assignment`, `sqa-higher-modern-studies-qp`,
`sqa-higher-psychology`

Modern Studies attributes individual marks to specific candidate sentences:

> This was awarded 1 framing knowledge and understanding (KU) mark.

Psychology itemises with marks against each element:

> ♦ Description of relevant psychology theory/concept. (4 marks)
> ♦ Description of the aim, procedure and results of the Weaver et al (2010)
> study. (2 marks)

**The assignments are typed, not handwritten.** That is the single most
important property in this audit: it breaks the confound that has needed
hand-reading all week, because a typed source with per-mark reasons can separate
"misreads the handwriting" from "misjudges the work" by measurement.

### SQA English — RUAE only
`sqa-higher-english` (Reading for Understanding, Analysis and Evaluation)

RUAE commentary ties awards to numbered marking-instruction bullets:

> The candidate's first point ... is an accurate, own words comment on
> "Amazon surpassed multi-store Walmart..." (bullet point 4 of the marking
> instruction).

**The critical essay papers in the same folder are not criterion-level** — they
are holistic band judgements ("awarded 9 marks for this piece" followed by prose).
The folder must be split by paper type, not ingested wholesale.

---

## Tier 2 — answer-level with reasons; usable, not criterion-level

### `pearson-gcse-maths`
The strongest non-SQA source. 153 pages of real candidate responses with
examiner comments and a score:

> Student Response B — 0/4. In part (a) the answer is incorrect and no correct
> working is seen. In part (b) the student has recognised that the mean doesn't
> represent all values, but has shown no understanding that extreme values can
> drag the mean up or down, and as such no marks are scored.

Reasons attach to *parts*, not to numbered marks, so it fails the hard rule. It
would measure whether Jami attributes to the right sub-question — worth having,
and it is English-board GCSE maths, which nothing else here covers.

### `cambridge-ecr`
Example Candidate Responses with examiner comments keyed by annotation number to
places in the script. Band-level ("high"), itemised observations. Broad subject
coverage; a real parser job.

### `sqa-higher-history`, `sqa-higher-modern-languages`
History gives a structured breakdown of a total ("awarded 13 marks for this
question as follows: Introduction ... Two pieces of background given in total")
which is close to criterion-level and needs a closer look before committing.
Modern languages are trait-level (Content, Language) with prose reasons.

### `nzqa-exemplars`
Band-graded exemplars (Achieved / Merit / Excellence). Annotations exist but the
unit is the band, not the mark.

---

## Tier 3 — totals or trait scores, no reasons

| source | what it has |
|---|---|
| `DREsS_New` (12,254), `DREsS_Std` (6,508), `DREsS_CASE_*` (9,803 each) | typed essays with content / organisation / language trait scores. **No reasons.** Analytic, so trait-level — but nothing says *why* |
| `asap-2`, `asap-2.0` | holistic rubric scores, already ingested |
| `jorgpt-2026` | teacher grade plus DeepSeek / Qwen / Gemini grades and a judge. Model outputs, not examiner reasoning |
| `drawedumath` | handwritten maths images with **teacher descriptions**, not marks. Useful for vision, not for marking |
| `edu-circuit-hw` | LLM-as-a-judge outputs over handwritten STEM. Substantially a study of model grading |
| `mohler`, `graduate-neural-networks`, `medly-gcse` | already ingested; totals only |

---

## Sources that turned out not to be what was hoped

**`ocr-a-level-maths-h240`** — one file, and it is
`726297-examiners-report-pure-mathematics-and-statistics.pdf`. A cohort-level
examiners' report that marks no individual script. This was priority 2 on the
acquisition list; it cannot be used for marking accuracy at all.

**`pearson-alevel-spanish`, `pearson-alevel-german`, `pearson-ial-french`** —
Principal Examiner Feedback documents. Same problem. The languages branch of the
marking prompt therefore **still has no evidence behind it**.

**`pearson-alevel-further-maths`, `pearson-gcse-business`,
`pearson-gcse-chemistry`, `pearson-gcse-english-language`,
`pearson-gcse-spanish`, `pearson-igcse-geography`,
`ocr-gcse-combined-science`** — single files each, unverified individually;
given the pattern across Pearson and OCR, expect examiners' reports rather than
annotated scripts. Check before scheduling parser work.

**`engsaf`** — access request only; two text files and an HTML page, no dataset.

---

## Duplicates and overlaps

1. **`A Dataset of Digitized Student Examination Papers,` duplicates
   `handwritten-university-data-science`.** The manual download landed in a
   folder named after the paper rather than the source id. It holds the real
   payload (100 PDFs, `Teacher_manual_marks_Anonymized.csv`, `answerkey.txt`)
   while the source-id folder holds only 4 files. There is also an empty
   `... (1)` folder. Ingesting both would double-count 544 records.

2. **2023 Higher Maths appears twice.** `qualifications-scotland` holds
   `higher-2023-*`; `sqa-higher-maths` holds `NH_Mathematics_*_2023.pdf` and
   `mi_NH_*_2023.pdf` — the same question papers and marking instructions under
   different names. Candidate evidence for 2023 exists only in the first.

3. **Advanced Higher appears twice** — `qualifications-scotland-advanced-higher`
   (2025) and `sqa-advanced-higher-maths` (2023-24, 2025-26). Probable 2025
   overlap.

4. **`DREsS_Std` is built from ASAP++**, which overlaps `asap-2` — already the
   largest source in the corpus at 17,307 records.

5. **`jorgpt-2026` versus `jorgpt`** — same project, later release.

---

## Licence and access

**Every SQA source is measure-only.** The preserved terms are explicit:

> Understanding Standards terms say content may be read, printed and downloaded
> for private use, but commercial reproduction/use requires advance written
> permission. Do not ship this corpus inside Jami unless permission is obtained.

That is fine for benchmarking and forbids using any of it as exemplars shown to
students. Since thirteen of the fourteen criterion-level sources are SQA, **the
entire criterion-level corpus is measure-only** — worth knowing before anything
depends on redistribution.

**A gap worth closing:** the older folders carry `LICENCE_STATUS.txt`,
`SOURCE_URLS.txt` and `TERMS_AND_CONDITIONS.html`. The newly crawled `sqa-*`
folders carry **no licence evidence at all**. Same publisher and same terms, but
the evidence is not preserved beside the payload, which is the discipline the
corpus catalogue relies on.

**`drawedumath` is CC BY-NC 4.0** — non-commercial. Usable for measurement in a
commercial product only with care; flag before use.

## Privacy

`A Dataset of Digitized Student Examination Papers,/Student_MCQ.csv` contains
**real student names** ("Suy chakriya", "Ung Keng long") beside institutional
IDs. The existing ingest deliberately never reads that file and uses the
anonymised marks file instead. Any new parser must inherit that rule.

`edu-circuit-hw` and `drawedumath` contain student handwriting images; neither
has been checked for identifying marks in the scans.
