# Notifications

Jami sends at most two push nudges a day, each by the student's own clock:

- **The daily nudge** at 4pm local time.
- **An evening reminder** at 7pm, only while Daily Review still has cards
  waiting. Students can turn it off in their notification settings.

Nothing is sent from 10pm until the next afternoon. A nudge that was not sent
by 10pm waits for the next day.

## Schedule

`vercel.json` calls `/api/notifications/digest` once an hour, as 24 daily cron
entries (one per hour, which every Vercel plan accepts). The route checks
`CRON_SECRET` and runs `runNotificationDigest` in
`services/notifications/digest.ts`.

Who is owed what is decided by a pure function, `getDueNudge` in
`lib/app/notification-schedule.ts`. Each nudge goes on the first hourly run
after its local time rather than at an exact minute, so a cron run that drifts
within its hour, or a time zone half an hour off the hour, still reaches
everyone.

## Time zones

A student's zone is stored on their notification preferences. Settings record
it, and the dashboard reports the device's zone whenever it differs from the
last one that device sent (`DashboardAccessGate`). It only updates existing
preferences. Without a stored zone, Europe/London is used.

## Sending once

- Enabled preferences are read in pages of 100, with at most five students
  processed at a time.
- Cards are read only for a student who is due a nudge. A student with nothing
  to send is marked as checked for that day, so hourly runs cost almost nothing
  per student.
- Each kind of nudge has its own transactional ten-minute claim and its own
  record of being sent, so the digest and the evening reminder never block each
  other and neither is sent twice. An unsent claim is released so a later run
  can retry.
- Expired push subscriptions are removed as they are found.
- Saving settings writes only the fields the student changed, so a stale copy of
  the sent record can never overwrite the server's.

## Limits

The route has a 300-second budget and logs a structured warning at 240 seconds
(`DIGEST_DURATION_WARNING_MS`). Move the fan-out to a durable queue before
either of these becomes normal:

- more than 1,000 students have notifications enabled; or
- p95 run time reaches 240 seconds, or a run reports partial failures caused by
  time pressure.

Until then, paging and bounded concurrency keep a single cron handler enough.
