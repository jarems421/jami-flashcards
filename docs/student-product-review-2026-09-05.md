# Student product review — 5 September 2026

This assesses the whole implemented product from source, workflow definitions,
tests and current competitor documentation. It is a product judgement, not a
hands-on usability score or evidence from paying customers. No browser walkthrough,
live model evaluation or production deployment verification was performed.

## Assessment

**7/10 for student usefulness; 5/10 for demonstrated readiness to sell broadly.**

The useful proposition is a subject workspace that keeps reference material,
handwritten practice, contextual help and memory review together. Scheduled review,
focused review, multiple answer formats, offline review replay, draft approval,
goals and progress give it substance beyond a chat wrapper. The strongest audience
looks like students who already use both handwritten working and flashcards.

As a student, I would try it for a difficult subject. I would hesitate to move an
entire course into it until I trusted saving, could take my material out, and knew
how often its feedback was wrong. Folders, topics, decks, notebooks, sources,
several study modes and separate progress/reward destinations create a learning
cost. The existing onboarding and Today guidance help, but the first useful study
session should arrive before a student has to understand the whole structure.

Exam-paper creation and marking could be valuable, but automated correctness tests
do not validate educational quality. The repository's paper-generation benchmark
currently reports that all exact components are explicitly unmeasured and no
release gate is active. Do not interpret that check passing as measured accuracy.

## Competitive position

| Alternative | What students can already get | Implication for Jami |
| --- | --- | --- |
| [Anki](https://apps.ankiweb.net/) | Free desktop flashcards, scheduling and free sync; official iOS app sold separately | Basic spaced repetition is a weak reason to subscribe. |
| [Knowt](https://help.knowt.com/en/articles/10298016-what-are-the-differences-between-free-and-paid-accounts-for-students) | Free unlimited notes/flashcards and core study modes, including spaced repetition | More quiz modes alone are not a paid differentiator. |
| [RemNote](https://www.remnote.com/pricing) | Notes, flashcards, PDF annotation, handwriting and AI; displayed annual-billing prices are $8/month Pro and $18/month Pro with AI | Closest direct competitor. An integrated workspace is already available elsewhere. |
| [Goodnotes](https://www.goodnotes.com/pricing) | Handwriting, PDF annotation and AI features | Students who write extensively already have a specialist option; Jami should win through what happens after practice. |
| [Save My Exams](https://www.savemyexams.com/as/) | Expert-created notes, exam questions, answers and past papers | Curriculum relevance and trusted content matter more than the number of generated questions. |

These are current published offerings, not independently benchmarked comparisons.
Prices are the displayed US-dollar annual-billing figures, not UK checkout quotes.

## Would students pay?

Some plausibly would, particularly if Jami saves them repeated copying between
their notebook, tutor and flashcard app. Broad willingness to pay is unproven.
The pitch should demonstrate a complete useful result: work through a difficult
page, understand the mistake, approve a useful card, and revisit it later.

Test a £4–6/month founding offer with real students as a pricing hypothesis,
with explicit AI allowances. This is not an established market-clearing price or
a margin forecast. Measure actual payment, repeated study and renewal; positive
feedback and free signups are not substitutes. Validate inference cost per active
student before promising generous use. No checkout/subscription implementation
was found in the reviewed app routes and package dependencies.

## Prioritised improvement checklist

- [ ] Validate one narrow audience and subject workflow with 10–20 students using their own material for several weeks.
- [ ] Shorten time to first useful session: a ready example and a direct route from the student's material to practice and later review. Build on the existing onboarding.
- [ ] Measure Tutor and marking accuracy against independently marked examples, including incorrect reasoning, ambiguous answers and unsupported questions; expose uncertainty and a correction path.
- [ ] Make exam date, specification coverage and the next useful revision action clearer. Existing progress and goals are useful foundations, not proof of exam readiness.
- [ ] Provide obvious, tested export/backup and migration paths. I did not find a general student-facing course export or Anki migration flow in this review.
- [ ] Validate saving, reload recovery, offline behavior and tablet input on real student devices. Unit tests cannot establish pen feel or production reliability.
- [ ] Test actual willingness to pay, then add clear entitlements, checkout/cancellation and sustainable AI usage limits.

Adding more disconnected features is unlikely to address these gaps. The main
opportunity is to make the existing study loop faster, trustworthy and measurably
useful enough to replace part of a student's current routine.
