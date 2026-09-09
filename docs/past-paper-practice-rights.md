# Past Paper Practice rights registry

Past Paper Practice is fail-closed. An official question can be stored for review, but it cannot be selected, marked, or have assets streamed until `lib/practice/exam-question-rights.ts` contains a versioned permission record for its board and every required permission is true.

Each official record must point to owner-supplied evidence covering:

- immutable source storage;
- display of questions, diagrams, extracts, and mark schemes to students;
- reproduction in user-requested notebook copies;
- transmission of the question, scheme, answer, and working to approved AI providers;
- any third-party material embedded in a paper.

Do not treat a board's public past-paper page as this permission. The public policies ordinarily require specific permission for reuse: [AQA](https://www.aqa.org.uk/about-us/who-we-are/our-standards/copyright-and-intellectual-property-policy), [OCR](https://www.ocr.org.uk/about/our-policies/copyright/), [Pearson](https://qualifications.pearson.com/en/support/Services/pearson-edexcel-mocks-service/terms-and-conditions.html), and [Qualifications Scotland](https://www.sqa.org.uk/pastpapers/findpastpaper.htm).

## Human review is a separate gate

A permission record makes material *legal* to serve. It does not make it
*correct*. Extraction and the audit pass are both model work, so an official
question is additionally unservable until a person sets `humanChecked: true` on
it — `isExamQuestionServable` refuses it otherwise, whatever its status says.
Ingestion writes `humanChecked: false` and has no way to write anything else.

Two known limitations of the current extractor to check during that review:

- a question's asset is a render of the **whole** PDF page, so it can show
  neighbouring questions the student was not asked;
- source PDFs are capped at 8 MB each, because both documents are attached
  inline to two separate vision calls.

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
