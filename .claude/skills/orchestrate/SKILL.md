---
name: orchestrate
description: Run a Jami task through the multi-model workflow - Opus understands, plans and judges; Sonnet builds; Haiku searches and runs checks.
argument-hint: [task description]
disable-model-invocation: true
---

# Orchestrate

Task: $ARGUMENTS

You are the orchestrator (main session, Opus). You own understanding, the plan and the final judgement. Delegate searching, typing and running checks, and keep your own context for thinking.

## Team
| Agent | Model / effort | Give it | Don't give it |
|---|---|---|---|
| `scout` | Haiku, medium | Lookups: where, who calls, what exists, file sizes | Design questions, explaining tricky logic |
| `builder` | Sonnet, high (never Opus) | A written plan with files and acceptance criteria | Open-ended "figure it out" tasks |
| `verifier` | Haiku, low | Running checks after a build | Judging whether code is right |
| `reviewer` | Opus, high | The finished diff | Unfinished work |

## Effort
These instructions set effort explicitly, so pass `effort` on the Agent call where this table says to:
- **Main chat (you):** `high` for running a stage from a written plan; `xhigh` only for writing a plan or untangling a hard bug. Long chats at max effort are the most expensive thing in this workflow.
- **builder:** `high` (default). Pass `effort: "xhigh"` only for a brief whose core is tricky timing, concurrency or numerical code (e.g. live ink rendering, Safari pointer handling, sync/merge logic) - still on Sonnet.
- **reviewer:** `high` (default). Pass `effort: "xhigh"` when the stage changes stored data shapes, migrations, Firestore rules or the Learning Engine - a missed bug there is costly to undo.
- **scout:** `medium` (default). **verifier:** `low` (default).

## 0. Size the task first
- **Tiny** (a line or two, copy, a single obvious fix): do it yourself, run typecheck + lint + related tests. Don't spawn anyone.
- **Small** (one or two files, clear fix): skip scouts if you already know where; one builder; verifier; skip reviewer unless it touches the risky areas below.
- **Feature / multi-file / risky**: the full flow.

## 1. Understand
Send 1-3 `scout` agents in parallel, each with one specific question. Then read the critical files yourself: scouts find, you understand.
Always read these yourself rather than trusting a summary: Learning Engine (`lib/learning/`, `services/learning/`), Tutor and prompts (`lib/ai/`), Firebase writes and `firestore.rules`/`storage.rules`, notebook ink and persistence (`lib/workspace/`), past-paper permission records, anything touching stored data shapes.

## 2. Plan
Write: root cause or goal, files to change, approach, acceptance criteria, tests to add, and which AGENTS.md rules apply. If a touched file is over 1,000 lines, plan moving a concern out first, as its own step. Ask the user only for decisions that are theirs (product behaviour, data migrations, anything AGENTS.md calls an agreed exception). For big or risky work, show the plan before building.

## 3. Build
Never build on Opus: always use `builder` as defined (Sonnet, high), even for hard stages. Opus builders cost several times more per step and long runs multiply that. Quality comes from your plan and the Opus review, not from Opus typing.

Split the work into briefs of **one concern, about 5 files or fewer** (e.g. "pen input", then "erasers", then "exam sheet"), each to a fresh builder. Short builders stay cheap; one builder doing a whole stage re-reads a huge history every step.
Brief each builder fully - it has no context: the goal, exact files, relevant `path:line`, the rules that apply, the tests to add, and what "done" means. Tell it what earlier briefs already changed.
Run briefs in parallel only when they touch disjoint files (`isolation: "worktree"` if they could collide); otherwise in order.

## 4. Verify and review
Run `verifier` after each brief. Run `reviewer` once per stage, on the stage as a whole, and tell it exactly which files/diff are new (ask the user to commit the previous stage first so `git diff` is only this stage). Send BLOCKER and SHOULD FIX findings back to the builder that wrote that code with SendMessage if its run was short; if it ran long, brief a fresh builder with just the findings and files. Re-run the verifier after each fix; re-run the reviewer only if the fix was non-trivial. Stop after 3 rounds and report to the user.
For shared `components/ui`, theme, navigation or layout changes, also have the verifier run `npm test` and `npm run build` at the end.

## 5. Hand off
Read the final `git diff` yourself. Report to the user: what changed, verification results (name anything skipped, e.g. browser checks), open questions. Do not commit unless asked.

## Rules
- Use `scout`, never the built-in Explore or general-purpose agents (they inherit Opus).
- One stage of a multi-stage plan per chat. Long chats re-read their whole history every message; start a fresh chat for the next stage - the plan file carries the context.
- Never accept a "done" without the verifier's output.
- If a builder fails twice on the same thing, take it over yourself - don't loop.
- No edits, installs, tests or builds while an ingestion/review run is going.
- Several sessions share this machine: no production builds or browser walkthroughs unless the change is a big UI refactor.
