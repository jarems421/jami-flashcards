# AI quality benchmark

Run this benchmark with synthetic, licensed, or deliberately created material
only. Never copy real student conversations, notebook pages, uploads, answers,
or account data into a benchmark or staging environment.

The benchmark must cover routine and difficult GCSE, A-level, and university
Tutor work; source synthesis and corrections; full-paper generation; blind
marking and adjudication; on-time/overtime scoring; document vision; grounded
research; generated figures; and adversarial privacy cases. Include papers and
rubrics written by qualified reviewers for each assessed subject represented in
the release set.

## Procedure

1. Record the exact application revision, prompt revision, logical-role model
   IDs, approved endpoint list, and gate configuration.
2. Run the fixed cases three times where sampling can affect the result. Keep
   student-facing model names hidden; reviewers may see role labels in the
   restricted report.
3. Have qualified reviewers score correctness, pedagogy, level fit, evidence
   fidelity, paper authenticity, timing/mark realism, marking accuracy, and
   usefulness. Reviewers must separately inspect citations and every awarded
   mark against original typed/visual evidence.
4. Run deterministic checks for total/question mark bounds, duplicate IDs,
   leaked answers or hidden schemes, missing visuals, printable output,
   ownership, source limits, and overtime cut-off behavior.
5. Exercise repeated questions, explicit corrections, a twice-challenged
   supervisor answer, provider outages, malformed structured output, scanned
   PDFs, poor snapshots, malicious source instructions, and web prompt
   injection.
6. Export a restricted JSON summary and run
   `npm run check:ai-benchmark -- <report.json>` in the release environment.

Paper-generation baselines are tracked separately in
`benchmarks/paper-generation-baselines.json`. GCSE, A-level, and university
branches remain explicitly unmeasured until a qualified reviewer approves a
paired baseline. Run `npm run check:paper-benchmark -- <report.json>` for each
release. Approved branches block regressions; unmeasured branches are reported
without pretending they have evidence. Every case must complete and every
paper must receive human answerability and authenticity review before a branch
can become measured.

Release is always blocked by any fabricated citation, invalid score, leaked
mark scheme, missing required figure, critical factual error, private/student
text in a search query, or successful source/web prompt injection. A reviewer
may also block release for material pedagogical regression even when the
machine gate passes.

## Report shape

The checker accepts schema version 1. Each named suite needs at least one case
and a `passed` status. The report is intentionally content-free; retain detailed
case material only in the access-controlled evaluation system.

```json
{
  "schemaVersion": 1,
  "status": "passed",
  "completedAt": "2026-08-14T12:00:00.000Z",
  "suites": {
    "gcseTutor": { "status": "passed", "cases": 1 },
    "alevelTutor": { "status": "passed", "cases": 1 },
    "universityTutor": { "status": "passed", "cases": 1 },
    "paperGeneration": { "status": "passed", "cases": 1 },
    "paperMarking": { "status": "passed", "cases": 1 },
    "documentResearch": { "status": "passed", "cases": 1 },
    "adversarialPrivacy": { "status": "passed", "cases": 1 }
  },
  "blockers": {
    "fabricatedCitations": 0,
    "invalidScoring": 0,
    "leakedMarkSchemes": 0,
    "missingRequiredFigures": 0,
    "criticalFactualErrors": 0,
    "studentDataInSearchQueries": 0,
    "promptInjectionSuccesses": 0
  },
  "routing": { "jurorChallengePathPassed": true },
  "marking": {
    "blindMarkersUsedOriginalEvidence": true,
    "overtimeDualScoringPassed": true
  },
  "privacy": {
    "zdrEndpointCheckPassed": true,
    "noContentLogsPassed": true
  }
}
```
