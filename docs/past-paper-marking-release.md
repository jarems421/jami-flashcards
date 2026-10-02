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

**The deployment's model variables must match its provider lists.** Until 24
September 2026, production still set `OPENROUTER_SUPERVISOR_MODEL` to MiniMax M3,
the supervisor the code retired, while its supervisor providers had been updated
for Qwen. Every marking that carried an image was refused by every approved
endpoint with HTTP 404. The verifier's report arrived and the primary's never
did, so every marking failed, for past-paper and Jami-created questions alike.
Session creation, which is text only, kept working, and nothing failed locally,
where `.env.local` names Qwen. The variable is sensitive, so `vercel env pull`
shows it blank. The fix was to remove it, so the code's default applies, and
redeploy. When a role's providers change, set or remove its model variable in
the same change.

A failed attempt now records why in its execution audit, as a content-free
`cause`: `provider_http_404`, `abort_deadline`, `invalid_report`, or one of the
job's own codes. It never records the error's text, which can carry the
student's answer.

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

**Close essay disputes are settled without an adjudicator.** Adjudication is
the slow step in marking an essay: a second sequential call of about 29 seconds
after the two markers' 34, needed on 30 of 36 English answers. A levels-marked
question whose two blind markers are within one mark of each other now takes
the worker's report. Measured live on the same 36 answers: 18 adjudications
instead of 30, and no measurable accuracy cost -- paired, 5 answers moved
closer to the examiners and 9 further, within run-to-run noise (the blind
markers themselves were 0.1 to 0.2 harsher that run), and the answers settled
without adjudication had the smaller error (0.89 against 1.69 for those still
adjudicated). Maths keeps adjudicating every dispute: replayed on the 67 real
scripts, the rule cost two correct marks, because a mark on a four-mark
question is a real disagreement. `--variant=always-adjudicate` turns it off for
a comparison run.

Taking the worker's mark and never adjudicating an essay looked better on the
36 answers every essay change was measured on -- in all five runs, including
on bias-free error and rank agreement. It did not survive fresh answers.
`--offset=2` drew 36 Medly answers no run had seen, and there the two tied:
average error 1.06 against 1.11, bias-free error 10.0% against 10.1%, rank
correlation 0.80 against 0.81, 8 answers closer and 7 further (sign test
p = 1.0). The earlier advantage came from testing on the tuning sample and
from the supervisor's harsher adjudications in the first two runs. Adjudication
stays: it costs no accuracy and is the safety net for a misread answer.

On those fresh answers the shipped marker held up: 1.11 marks from the
examiners' mean against their own gap of 1.61, bias -0.64, between their two
marks on 24 of 36.

**Live signal**: `npm run check:marking-live` reports, from the attempts
students have actually had marked, how often the blind markers disagreed and
how often a student's check changed the mark and which way. On 23 September:
16 attempts, markers disagreed on 2, no checks requested yet.

## GCSE by board and subject, 1-2 October 2026

Not an approval. The first GCSE measurement that names its board:
`artifacts/corpus/gcse-board-exemplars.json`, built by
`scripts/eval/build-gcse-board-corpus.py` from the boards' own published
examiner-marked student work (Pearson exemplar booklets, AQA answers and
commentaries, OCR exemplar candidate work). Real students, real series, the
board's own mark; single-marked. Scans are cut out of the PDFs so the typed
award and commentary beside them never reach the marker. Measure-only.

`scripts/eval/gcse-benchmark-report.ts` gives the breakdown with 95%
intervals; a cell under 20 answers is reported as too few to call.

| | answers | marks agreeing | total exact | within one | bias |
| --- | --- | --- | --- | --- | --- |
| All | 353 | 90% | 73% | 89% | -0.21 |
| Pearson Edexcel Maths | 122 | 95% | 84% | 98% | +0.10 |
| OCR Maths | 113 | 96% | 88% | 98% | +0.01 |
| AQA Geography | 53 | 88% | 62% | 89% | +0.09 |
| Pearson Edexcel History | 30 | 84% | 30% | 50% | -1.00 |
| Pearson Edexcel English Language | 22 | 82% | 36% | 55% | -2.59 |
| AQA History | 13 | 88% | 23% | 69% | too few |

For scale, two examiners marking the same GCSE answer (Medly, double-marked)
agree exactly on 72% of point-marked answers and 34% of levels-marked ones.

**What it found.** Point-marked questions are close to examiner level.
Levels-marked answers are held back at the top: both blind markers put answers
the examiner placed in the top band about a sixth of the tariff too low (40/40
given 30, 16/16 given 12), while lower answers were within a few percent. A
paragraph in the boards' own words telling the marker to test the top
descriptor before settling lower changed nothing (12 answers closer, 13
further), and was removed. Still open.

**Measurement faults fixed on the way, recorded because each looked like a
marker fault.** The harness capped an answer at three images, which cut the
end off the longest essays (those answers were 38% of the tariff low, the rest
+0.6%). Board level tables did not parse, so levels-marked answers were sent
with derived bands and a notice that the board published no descriptors
(false); the first 83 AQA figures were taken that way and discarded.

**Marking changes.** A supervisor whose thinking fills the 16,000-token output
ceiling returned a cut-off report and the marking failed, about 2% of maths
answers. It is now asked once more with thinking off
(`callMarker`, tested in `practice-paper-marking-pipeline.test.ts`).

**Thinking off, measured.** `--variant=quick-all` marks with the supervisor's
thinking off. Paired on the 116 answers that are marked with thinking:
21 closer to the examiner, 18 further, average error unchanged (10.2% of the
tariff); levels-marked 18 closer, 13 further; point-marked maths over four
marks 3 closer, 5 further. The supervisor's median call time fell from 43 to 8
seconds. A quarter of thinking calls ended in an HTTP 502 after a median of
about two minutes; with thinking off, 18%.

Checked on answers nothing was tuned on: 36 unseen double-marked Medly GCSE
English answers (`--offset=4`), both arms. Thinking off sat 1.22 marks from the
examiners' mean against 1.28, between the two examiners on 21 against 19,
bias -0.58 against -0.92; paired, 7 closer and 10 further (p = 0.63). No loss
either way, so **levels-marked questions now mark with the primary's thinking
off** (`primaryReasoningEffort`; `--variant=slow-levels` is the other arm).
Point-marked questions over four marks keep it. The verifier and the
adjudicator are unchanged.

## Remaining release evidence

Per-criterion evidence presence is checked, but presence does not establish
semantic correctness or handwriting accuracy. Authentic representative marking
evaluations, science coverage, end-to-end latency measurements, and browser and
stylus checks remain necessary. No permission or quality approval is inferred
from passing code tests.
