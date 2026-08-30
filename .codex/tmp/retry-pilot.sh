#!/usr/bin/env bash
# Retry one pilot case until it completes or stops making progress.
#
# Each attempt resumes from the checkpoints the previous one banked, so a retry
# costs only the work not yet done. The provider therefore has to be healthy for
# one call at a time rather than for twenty-eight consecutively, which is what
# it has repeatedly failed to be: three 502s in a row ended the last attempt
# after five passes had already been reused for free.
#
# Stops on its own when two attempts in a row bank nothing new, since that means
# the failure is at a point checkpointing cannot get past.
set -u
RUN_ID="$1"
MAX="${2:-8}"
export JAMI_GENERATION_CHECKPOINT_DIR=.codex/checkpoints
export JAMI_CAPTURE_GENERATION_DIR=.codex/captures
stale=0
for attempt in $(seq 1 "$MAX"); do
  before=$(ls .codex/checkpoints 2>/dev/null | wc -l | tr -d ' ')
  npx --yes tsx --conditions=react-server .codex/tmp/run-paper-pilot-local.mjs \
    --run-id "$RUN_ID" --max-cases 1 > "artifacts/evaluation/retry-${attempt}.log" 2>&1
  after=$(ls .codex/checkpoints 2>/dev/null | wc -l | tr -d ' ')
  hits=$(grep -c "checkpoint_hit" "artifacts/evaluation/retry-${attempt}.log" 2>/dev/null || echo 0)
  status=$(grep -oE '"status":"(ready|failed|cancelled|succeeded)"' "artifacts/evaluation/retry-${attempt}.log" | tail -1)
  echo "attempt ${attempt}: checkpoints ${before} -> ${after}, ${hits} reused, ${status:-no status}"

  if grep -q '"event":"pilot_finished"' "artifacts/evaluation/retry-${attempt}.log" 2>/dev/null \
     && ! grep -q '"status":"failed"' "artifacts/evaluation/retry-${attempt}.log" 2>/dev/null; then
    echo "PAPER COMPLETED on attempt ${attempt}"; exit 0
  fi
  if grep -q '"event":"balance_guard"' "artifacts/evaluation/retry-${attempt}.log" 2>/dev/null; then
    echo "stopped: out of credit"; exit 2
  fi
  if [ "$after" -eq "$before" ]; then
    stale=$((stale + 1))
    if [ "$stale" -ge 2 ]; then
      echo "stopped: two attempts banked nothing new, so retrying will not get past this"; exit 3
    fi
  else
    stale=0
  fi
done
echo "stopped: reached ${MAX} attempts"
exit 4
