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
| `builder` | Sonnet, high | A written plan with files and acceptance criteria | Open-ended "figure it out" tasks |
| `verifier` | Haiku, low | Running checks after a build | Judging whether code is right |
| `reviewer` | Opus, high | The finished diff | Unfinished work |

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
Brief the `builder` fully - it has no context. Include the plan, the exact files, relevant snippets or `path:line` you found, the rules that apply, and what "done" means.
Split into parallel builders only when they touch disjoint files; use `isolation: "worktree"` when they could collide.

## 4. Verify and review
Run `verifier` and `reviewer` in parallel. Send BLOCKER and SHOULD FIX findings back to the same builder with SendMessage (keeps its context). Re-run the verifier after each fix; re-run the reviewer only if the fix was non-trivial. Stop after 3 rounds and report to the user.
For shared `components/ui`, theme, navigation or layout changes, also have the verifier run `npm test` and `npm run build` at the end.

## 5. Hand off
Read the final `git diff` yourself. Report to the user: what changed, verification results (name anything skipped, e.g. browser checks), open questions. Do not commit unless asked.

## Rules
- Never accept a "done" without the verifier's output.
- If a builder fails twice on the same thing, take it over yourself - don't loop.
- No edits, installs, tests or builds while an ingestion/review run is going.
- Several sessions share this machine: no production builds or browser walkthroughs unless the change is a big UI refactor.
