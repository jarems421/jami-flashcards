# AI operations runbook

Jami exposes capabilities, not provider or model controls. Browser payloads,
Firestore student documents, analytics, and student-facing errors must never
contain provider names, model IDs, route decisions, prompts, responses, source
text, student work, image bytes, or cost metadata.

## Release sequence

1. Deploy Firestore indexes/rules and Storage rules before enabling any new AI
   surface.
2. Configure the server-only variables in `.env.example` for Preview. Keep
   every API key and Firebase Admin credential sensitive.
3. Complete the privacy and quality gates in
   `docs/ai-provider-release-gates.md`.
4. Run `npm run check:ai-release` inside the Preview deployment environment.
   This live check must pass for every OpenRouter role.
5. Exercise all kill switches using synthetic content, then restore only the
   capabilities approved for release.
6. Run the offline quality benchmark, automated verification, browser checks,
   and a paper-workflow restart/cancellation drill.
7. Cut over production atomically. Do not shadow or replay real student
   content.

## Kill switches

| Incident scope | Immediate action |
|---|---|
| All OpenRouter text inference | Set `OPENROUTER_KILL_SWITCH=true` |
| Independent juror only | Set `OPENROUTER_JUROR_KILL_SWITCH=true` |
| All Gemini specialist inference | Set `GEMINI_KILL_SWITCH=true` |

Formal paper marking is separately released with
`PRACTICE_PAPER_MARKING_WORKFLOW_ENABLED=true`. Keep it false until Preview has
completed a synthetic submitted paper, overtime dual scoring, cancellation,
retry, question recheck, and deletion. The service-wide marking lease defaults
to four jobs (`PRACTICE_PAPER_MARKING_JOB_CONCURRENCY=4`) and the automatic
provider ceiling defaults to `$0.50`
(`PRACTICE_PAPER_MARKING_MAX_COST_USD=0.50`). A job that reaches the ceiling
pauses with its evidence and completed provider checkpoints intact; raising the
ceiling or retrying after an operational review does not consume another daily
allowance.
| Grounded web/URL research | Set `AI_WEB_RESEARCH_ENABLED=false` |
| Tutor illustrations | Set `AI_TUTOR_IMAGES_ENABLED=false` |
| Paper raster illustrations | Set `AI_PAPER_IMAGES_ENABLED=false` |

After changing a kill switch, redeploy or refresh the runtime environment,
verify that the affected endpoint fails safely, and record the incident. A
disabled specialist must not silently fall back to a general text model.

## Content-free telemetry

Aggregate only these fields from `ai.provider` events:

- logical role and stable route reason;
- approved provider endpoint and configured model ID (operations access only);
- latency, input/output/total token counts, and estimated cost;
- success/failure category and numeric upstream status;
- workflow stage, duration, retry count, cancellation count, and queue depth.

Do not attach a user ID, email, folder/notebook/source/paper ID, free-form error
message, request URL, prompt, answer, citation, source title, file name, or any
student content. Dashboards should show p50/p95 latency, error rate, escalation
rate, queue age, jobs per stage, token/cost totals, and quota rejection counts.

Alert on:

- privacy/release-check failure (page immediately; keep the gate closed);
- spend threshold or abnormal token growth;
- sustained provider failure or empty/invalid structured responses;
- stuck paper stages, expired leases, repeated retries, or growing queue age;
- image validation failures, marking disagreement spikes, or score-bound errors.

## Workflow recovery

Practice-paper steps are idempotent and persist checkpoints. A retry must reuse
the same job and paper IDs, completed artifacts, allowance grant, and assets.
Operators must never create a replacement job merely to resume a clarification.

- A cancellation request takes effect between stages. Remove unfinished paper
  assets and workflow artifacts; only refund an allowance when provider work has
  not started.
- Expired global concurrency leases are safe to reclaim. Never manually edit a
  live lease without first checking its job and workflow run.
- A deployment-interruption drill passes only when the same job resumes without
  duplicate papers, assets, hidden mark schemes, or allowance charges.
- Student-facing failures stay generic. Investigate using content-free failure
  category, workflow stage, timing, and run ID in restricted Vercel tooling.

## Spend controls

Application quotas are the primary control: 40 Tutor replies per day, six
generated papers per day, eight full-paper markings per day, ten Tutor
illustrations per day, and eight raster visuals per generated paper. Also set
OpenRouter/Google hard or soft budgets and Vercel spend alerts. Keep paper-job
concurrency configurable and start at four globally active jobs.

Re-run privacy approval, the live provider check, and the quality benchmark
after any model, provider allowlist, prompt, routing threshold, privacy term,
retention policy, SDK, or material price change.
