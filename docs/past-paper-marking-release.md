# Past Paper Practice marking release checks

The owner-facing Practice surface and student-release approval are separate.
The surface flag, board switches, licences and corpus checks do not establish
marking accuracy.

## Student deployments

Set `PAST_PAPER_STUDENT_RELEASE=true` and `MARKING_QUALITY_REPORT` to a readable
aggregate report path in the deployment environment. Set the matching repository
variables for CI. The report must be provisioned before the check; these commands
do not call an AI provider or run an evaluation.

`npm run build` runs the marking checker first. In student-release mode it refuses
an entirely unapproved registry. Approved components require a matching current
report and must satisfy the configured checks. `npm run check:marking-release`
always requests strict mode, independently of the environment variable.

This is not a per-course runtime entitlement: operators must keep unsupported
boards/specifications unavailable. A passing maths component does not approve
science or English. Do not bypass a failed student-release check by clearing the
deployment variable or invoking Next directly.

## English evaluation

Weighted assessment-objective records retain separate traits only when the
published scheme supplies recoverable AO maxima and complete, non-overlapping
bands. Unsupported rubric layouts are refused, not converted into a generic
banded scale. Human AO awards are reference labels, never rubric maxima.

The initial extractor supports `AO5: Content (24 marks)`-style headings and the
existing level/score descriptor formats. Additional source layouts require
reviewed fixtures before extending extraction. This implementation has not been
validated on a paid English evaluation run.

## Measured on real exam scripts, 22 September 2026

Not an approval: one run, one board, one subject, single-marked. Recorded so
the next run has something to be compared against.

`criterion-run.ts --source=qualifications-scotland --pipeline=pastPaperPractice`
marks Qualifications Scotland Higher Mathematics 2023 scripts through the path
students get, against the examiner's own mark-by-mark commentary.

| | Aug, whole-paper path | Sep, Past Paper Practice path |
| --- | --- | --- |
| answers marked | 61 of 89 | 67 of 89 |
| individual marks agreeing with the examiner | 79.7% | 82.5% |
| generous / harsh mark errors | 39 / 7 | 26 / 21 |
| marks the examiner withheld that Jami awarded | 50% | 27% |
| total mark exact / within one | 47.5% / 88.5% | 64.2% / 92.5% |
| bias per answer | +0.51 | +0.09 |

The 22 answers lost were only slightly longer than those kept (4.23 against
4.04 marks) and about as hard, so the survivors are a fair sample. They were
lost to the harness's old 420s ceiling, which is half production's deadline;
the Past Paper Practice pipeline now defaults to production's own.

A stronger supervisor (Kimi K2.6), paired on the 17 answers both runs
completed, changed one mark of 57 and made it worse (McNemar p = 1.0), at three
to four times the cost and far slower. Model size is not what limits this.

Still open: English boards and sciences; real scripts double-marked by
examiners, so the result can be set against how far examiners disagree.

## Essays, measured 23 September 2026

`criterion-run.ts --banded --source=medly-gcse --subject=english
--per-question=6 --pipeline=pastPaperPractice` marks GCSE English Language
reading answers (8, 12, 16 and 20 marks, six a question) through the student
path. Every answer was marked by two examiners, so Jami can be judged against
how far apart they are: 1.31 marks on these answers. Each column is the same
36 answers.

| | before | levels guidance | + worker adjudicates |
| --- | --- | --- | --- |
| bias per answer | -2.13 | -1.68 | -0.93 |
| distance from the examiners' mean | 2.26 | 1.88 | 1.15 |
| between the two examiners' marks | 28% | 31% | 53% |
| within one mark of an examiner | 53% | 67% | 83% |

Essays were marked harshly on every question. Two causes, fixed in turn:

- The marking request was written for point schemes and said nothing about
  levels. It now carries the boards' own levels-of-response guidance (best fit,
  indicative content is not a checklist, the top level is not held back for a
  perfect answer), sent only for banded and weighted-trait questions.
- The adjudicator shared the harsh marker's model. Marking blind, the
  supervisor placed essays 2.0 marks low and the worker 0.5 low, and the
  supervisor settled 27 of 36 disputes on the harsh side. Disputes on
  levels-marked questions are now settled by the worker; point-marked questions
  keep the supervisor, where maths measured +0.09.

Against the first run, 23 answers moved closer to the examiners and 1 further
(sign test p < 0.0001). Jami is still slightly harsh: 15 answers below both
examiners, 2 above both.

Not an approval. One source, one subject, one question paper's worth of
answers. The 40-mark writing tasks are refused, correctly: their published
scheme has no level descriptors, and their two examiners differ by up to 15
marks. The whole-paper path uses the same adjudicator rule but was not
measured separately.

A caution from outside the corpus the change was made on: four AQA A-level
English Literature exemplars, examiner-marked by level (1 to 5) and carrying no
mark scheme, went the other way. Both models were generous on two of the four,
and the one dispute was settled at 5 where the examiner gave 4. Four answers
without a scheme cannot outweigh 36 with one, but the next essay measurement
should be real board scripts, not more of the same source. The Pearson A-level
Economics essays could not be used: their schemes give no recoverable AO
maxima, so all ten were refused before any call.

## Handwritten extended answers, and examiner practice, 23 September 2026

Two gates marking had not been measured on: handwritten extended writing, and a
science answer marked by level. `artifacts/corpus/sqa-extended-response.json`
(built by `scripts/eval/build-sqa-extended-corpus.ts`) holds thirteen
Understanding Standards scripts, every one handwritten and examiner-marked:
eleven Higher Chemistry open questions (3 marks, limited / reasonable / good
understanding) and two Higher History essays (22 marks, on the 2022 grid).
History Paper 2 and Biology were left out because several candidates share
unlabelled pages; the four 2019 essays because their 20-mark grid is not in
the folder.

Each marker change can now be switched off for a run
(`criterion-run.ts --variant=no-levels,no-practice,supervisor-adjudicator`),
so the same answers were marked three ways:

| | before this work | levels guidance + worker adjudicator | + examiner practice |
| --- | --- | --- | --- |
| Chemistry, bias (11 answers) | +0.55 | +0.45 | +0.45 |
| Chemistry, exactly the examiner's mark | 5 | 4 | 7 |
| History essays, bias (2 answers) | +2.5 | +3.0 | +2.0 |

On real examiners' marks Jami leans generous, not harsh; the Medly English
harshness does not carry over. The essay changes did not make it worse here,
and examiner practice (below) helped slightly. One pattern survives every
version: answers the examiner called "limited" are given "reasonable".

**Examiner practice** (`lib/practice/question-conventions.ts`) tells the
marker, the scheme writer and the paper designer how a board's examiners treat
each kind of question -- AQA Geography 9-markers need a supported judgement,
Edexcel "explain why" needs knowledge beyond the stimulus, an SQA "how fully"
earns most of its marks from omission. Paired on the 36 Medly English answers
(now presented as the AQA English Language questions they are):

| | before | with examiner practice |
| --- | --- | --- |
| distance from the examiners' mean | 1.15 | 1.10 |
| between the two examiners' marks | 53% | 61% |
| exactly one examiner's mark | 39% | 47% |

11 answers moved closer and 7 further: not significant, the right direction.

**Live signal**: `npm run check:marking-live` reports, from the attempts
students have actually had marked, how often the blind markers disagreed and
how often a student's check changed the mark and which way. On 23 September:
16 attempts, markers disagreed on 2, no checks requested yet.

## Remaining release evidence

Per-criterion evidence presence is checked, but presence does not establish
semantic correctness or handwriting accuracy. Authentic representative marking
evaluations, science coverage, end-to-end latency measurements, and browser and
stylus checks remain necessary. No permission or quality approval is inferred
from passing code tests.
