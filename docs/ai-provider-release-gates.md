# AI provider release gates

OpenRouter traffic is fail-closed. An API key alone does not activate it.
Production must set all of the following only after the corresponding review is
recorded:

- `OPENROUTER_ENABLED=true`
- `OPENROUTER_PRIVACY_APPROVED=true`
- `OPENROUTER_QUALITY_GATE_PASSED=true`
- `OPENROUTER_KILL_SWITCH=false`

The application resolves logical roles rather than accepting model names from
students. Worker, supervisor, and juror requests are restricted to the model
and provider allowlists in `.env.example`. Every OpenRouter request also sets
Zero Data Retention, denies data collection, and requires the selected endpoint
to support every requested parameter. No unapproved endpoint is a fallback.

## Privacy gate

Before `OPENROUTER_PRIVACY_APPROVED` is enabled:

- enable ZDR for non-frontier models in the OpenRouter account guardrail;
- disable prompt logging, data discounts, and response caching;
- restrict the key to the approved Xiaomi, MiniMax, and Moonshot model IDs and
  hosting endpoints;
- set a provider-side budget and alert;
- complete the DPIA and processor/subprocessor review for OpenRouter, Xiaomi,
  MiniMax, Moonshot, and Google;
- confirm retention, training, deletion, data location, and incident terms;
- verify the student-facing AI and conditional web-search notice;
- verify account deletion covers assistant images, paper assets, workflow jobs,
  source indexes, and notebook-owned image copies;
- confirm diagnostics never contain prompts, answers, source text, images,
  student identifiers, provider reasoning, or hidden chain-of-thought.

Paid-tier Gemini access is required for student content. Disable Gemini
developer logging and do not use a training-enabled free tier. Specialist
inference remains closed until `GEMINI_ENABLED`, `GEMINI_PRIVACY_APPROVED`, and
`GEMINI_QUALITY_GATE_PASSED` are all `true`; `GEMINI_KILL_SWITCH=true` disables
it immediately. Embedding compatibility remains separately server-controlled.

## Quality gate

Before `OPENROUTER_QUALITY_GATE_PASSED` is enabled, run a versioned offline
benchmark covering:

- routine and difficult Tutor answers at GCSE, A-level, and university level;
- source grounding, corrections, repeated-concept escalation, and juror review;
- complete-paper design, specification/format fidelity, marks, timing, source
  receipts, and generated figures;
- blind primary/verifier marking, adjudication, overtime scoring, handwritten
  evidence, and AI-generated mark schemes;
- scanned PDFs, document vision, web research citations, and prompt-injection
  resistance.

Block release for fabricated citations, invalid scoring, leaked mark schemes,
missing required figures, or critical factual errors. Record accuracy, rubric
drift, escalation rate, latency, reliability, and estimated cost.

Follow `docs/ai-quality-benchmark.md` and validate the content-free summary with
`npm run check:ai-benchmark -- <report.json>`.

## Operational gate

- Run `npm run check:ai-release` from the deployment environment. This fails if
  any release gate or explicit allowlist is missing, a deprecated DeepSeek
  variable remains, or no approved ZDR, multimodal, full-context endpoint is
  currently available for a role.
- Confirm the configured OpenRouter endpoints are currently ZDR-capable,
  multimodal, full-context, and meet the required numerical precision.
- Exercise the OpenRouter, juror, web-research, Tutor-image, and paper-image kill
  switches in staging.
- Confirm Vercel Workflow can resume a staged paper job across a deployment and
  that cancellation/retry operations are idempotent.
- Configure Vercel and provider spend alerts before production traffic.
- Deploy Firestore indexes/rules and Storage rules before enabling the UI.
- Run production smoke tests with synthetic material only; never shadow real
  student content.
- Re-run the benchmark whenever models, endpoint allowlists, prompts, provider
  terms, or material pricing assumptions change.

If a gate is false or a kill switch is true, the affected capability fails
safely. Jami does not route student text to Gemini as a universal fallback.
