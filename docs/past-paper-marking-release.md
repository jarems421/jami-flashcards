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

## Remaining release evidence

Per-criterion evidence presence is checked, but presence does not establish
semantic correctness or handwriting accuracy. Authentic representative marking
evaluations, science coverage, end-to-end latency measurements, and browser and
stylus checks remain necessary. No permission or quality approval is inferred
from passing code tests.
