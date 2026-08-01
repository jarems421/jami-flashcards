# Notification digest operations

The daily notification digest runs at the Europe/London study-day boundary.
The two configured cron paths cover summer and winter UTC offsets; the handler
itself rejects invocations outside the boundary window.

Enabled notification preferences are read in pages of 100 and no more than
five users are processed concurrently. A transactional ten-minute claim keeps
overlapping cron invocations from sending the same study-day digest twice. An
unsent claim is released so a later invocation can retry, while expired push
subscriptions are removed.

The route has a 300-second execution budget and emits a structured warning at
240 seconds. Move digest fan-out to a durable queue before either of these
conditions becomes normal:

- more than 1,000 users have notifications enabled; or
- p95 digest duration reaches 240 seconds, or any run reports partial failures
  caused by execution pressure.

Until then, pagination and bounded concurrency keep the single cron handler
appropriate without adding queue infrastructure.
