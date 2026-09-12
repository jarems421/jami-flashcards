# Past Paper Practice rights registry

Past Paper Practice is fail-closed. An official question can be stored for review, but it cannot be selected, marked, or have assets streamed until `lib/practice/exam-question-rights.ts` contains a versioned permission record for its board and every required permission is true.

Each official record must point to owner-supplied evidence covering:

- immutable source storage;
- display of questions, diagrams, extracts, and mark schemes to students;
- reproduction in user-requested notebook copies;
- transmission of the question, scheme, answer, and working to approved AI providers;
- any third-party material embedded in a paper.

Do not treat a board's public past-paper page as this permission. The public policies ordinarily require specific permission for reuse: [AQA](https://www.aqa.org.uk/about-us/who-we-are/our-standards/copyright-and-intellectual-property-policy), [OCR](https://www.ocr.org.uk/about/our-policies/copyright/), [Pearson](https://qualifications.pearson.com/en/support/Services/pearson-edexcel-mocks-service/terms-and-conditions.html), and [Qualifications Scotland](https://www.sqa.org.uk/pastpapers/findpastpaper.htm).

## Correctness is a separate gate, and it has two halves

A permission record makes material *legal* to serve. It does not make it
*correct*. Extraction and the audit pass are both model work, so an official
question passes two further checks before `isExamQuestionServable` will release
it, and they catch different things.

**A review, of one question.** `question.review` records a verdict, who reached
it — `by: "ai"` or `by: "human"` — and when. Ingestion itself can never approve
anything: it writes `pending`. The AI reviewer re-reads the question against its
rendered source page and can approve or reject; a person can overrule it in
either direction, and their word is recorded as the last one. **A model's
approval is sufficient to serve**, which is a deliberate decision and not an
oversight.

**A spot-check, of one paper.** Because model approval is sufficient per
question, a person samples each paper before any of it serves:
`isExamQuestionServable` refuses an official question whose
`paperSpotCheckedAt` is unset, whatever its review says. This is the half that
can notice a fault running through a whole extraction — a scheme paired one
question out, a region located on the wrong page, a tariff read off the next
line — which a per-question reviewer is the wrong shape to see.

Draw a sample and record it in the corpus workspace, or through
`/api/internal/exam-questions/spot-check`. Keeping anything at all stamps the
paper and lets its questions serve; throwing back everything drawn records the
attempt and stamps nothing, so the paper stays unservable. Whatever the sample
rejects is withdrawn as a batch rather than returned to the reviewer that
approved it.

> An earlier version of this section said a person had to set
> `humanChecked: true` and that ingestion had no way to write anything else.
> Neither was ever true of exam questions — `humanChecked` belongs to the exam
> *format* profiles in `lib/practice/exam-formats.ts`. The spot-check gate is
> what that paragraph described and the code did not have.

Two known limitations of the current extractor to check during a spot-check:

- a question's asset is a render of the **whole** PDF page, so it can show
  neighbouring questions the student was not asked;
- source PDFs are capped at 8 MB each, because both documents are attached
  inline to two separate vision calls.

## Topics are a separate registry, on the same terms

`lib/practice/exam-specification-topics.ts` holds the canonical topic list per
specification, versioned and owner-controlled like the rights registry above,
and for the same reason: it is a claim about a published document that someone
has to have checked. A catalogue is `verified: false` until then, and an
unverified catalogue serves nothing, is offered to nothing, and matches nothing
— an unverified topic list is worse than none, because a wrong topic silently
narrows a student's practice to the wrong questions.

Recorded on 2026-09-12: **AQA GCSE Mathematics (8300)**, read from the published
subject content at aqa.org.uk. The grain is the finest the specification itself
names — 3.1, 3.2 and 3.4 publish numbered subsections, while 3.3, 3.5 and 3.6
are flat lists of reference codes and so stay single topics. Thirteen topics in
total. Cross-checked for coverage against a real higher-tier GCSE maths paper
(Edexcel 1MA1/1H June 2023): all 28 questions map onto the list with nothing
left over.

Two operational notes for whoever adds the next one:

- **Extraction has to be told the ids.** It asks the model for `topicIds`, and
  until the catalogue was injected into its prompt the model invented strings
  that the canonical filter then dropped — which is why every question ingested
  before this is stored with an empty list.
- **Existing questions need backfilling.** `POST /api/internal/exam-questions/topics`
  tags untagged questions on one specification, a capped batch at a time. It
  refuses outright for a specification with no checked catalogue, rather than
  spending a provider call per question to write empty arrays over empty ones.

## Where the agreements live

The agreements are correspondence held by the owner and are deliberately not in
this repository. `evidenceReference` records that evidence exists and who can
produce it, not the evidence itself — a pointer into a private mailbox helps no
reader and is not something to commit. Anyone auditing a board asks the owner,
who sends the agreement directly.

Recorded on 2026-09-09: the seven UK domestic boards (AQA, Pearson Edexcel,
OCR, WJEC, Eduqas, CCEA, Qualifications Scotland), each confirmed by the owner
as covering storage, display to students, and transmission to third-party AI
providers for marking. International boards are not covered and remain
unservable.

## Adding evidence

1. Keep the agreement or licence wherever the owner controls it.
2. Add a new immutable registry version with its evidence reference and review date.
3. Ingest with that exact key and version. Never edit an old version in place.
4. Run a dry ingestion report and review every rejection.
5. Enable the corresponding server kill switch, then the public feature flag.

Setting a board switch to `false`, adding its specification ID to `EXAM_QUESTION_DISABLED_SPECIFICATIONS`, revoking the registry record, or withdrawing the question blocks new selection. Asset delivery independently rechecks the same controls so an emergency change takes effect without deleting audit history.
