# AI provider release gates

DeepSeek traffic is disabled by default. A key alone is not enough to enable it.
Production must set all of the following only after the corresponding review is
recorded:

- `AI_TEXT_PROVIDER=deepseek`
- `DEEPSEEK_ENABLED=true`
- `DEEPSEEK_PRIVACY_APPROVED=true`
- `DEEPSEEK_QUALITY_GATE_PASSED=true`
- `DEEPSEEK_KILL_SWITCH=false`

## Privacy gate

Before `DEEPSEEK_PRIVACY_APPROVED` is set:

- complete the DPIA and processor/subprocessor review;
- confirm data location, retention, training, deletion and incident terms;
- verify the student-facing AI notice and age-appropriate privacy wording;
- test account and source deletion, including private embedding chunks;
- confirm logs contain diagnostics and structured audits, not student payloads,
  provider reasoning or hidden chain-of-thought.

## Quality gate

Before `DEEPSEEK_QUALITY_GATE_PASSED` is set, evaluate a versioned benchmark
covering Tutor answers, source grounding, full-paper generation, official and
estimated mark schemes, handwriting transcription handoff and marking across
school, university and professional examples. Record accuracy, rubric drift,
fallback rate, latency and cost against the current Gemini baseline.

## Operational gate

- Keep Gemini configured for visual input and emergency fallback.
- Verify the per-feature fallback ladders and model diagnostics.
- Exercise `DEEPSEEK_KILL_SWITCH=true` in staging and confirm new traffic stops.
- Deploy the Firestore vector index before enabling indexed retrieval.
- Re-run the benchmark whenever model aliases, prompts, pricing assumptions or
  provider terms change.

If any gate is false or the kill switch is true, Jami does not send student text
to DeepSeek and uses the configured Gemini path instead.
