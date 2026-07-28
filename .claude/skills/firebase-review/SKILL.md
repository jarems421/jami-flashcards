---
name: firebase-review
description: Review Jami Firebase code, authentication, Firestore, Storage, listeners, writes, and security-sensitive data flows. Use when changing Firebase services or investigating persistence and synchronisation bugs.
argument-hint: [feature, files, or problem]
---

# Jami Firebase Review

Review the Firebase-related implementation for:

$ARGUMENTS

Check:

1. Firebase access is contained within the appropriate service layer.
2. Authentication and ownership are checked correctly.
3. Firestore and Storage paths cannot expose another user's data.
4. Writes are validated and do not silently overwrite unrelated fields.
5. Concurrent writes and race conditions are handled safely.
6. Realtime listeners are unsubscribed during cleanup.
7. React effects do not create duplicate listeners or repeated writes.
8. Errors are surfaced meaningfully rather than swallowed.
9. Read and write volume is reasonable.
10. Offline, retry, and reconnect behaviour cannot corrupt state.
11. Existing stored documents remain compatible.
12. Security rules are not weakened to fix a client-side problem.
13. Secrets, tokens, and private configuration are not committed.

Separate confirmed problems from speculative risks.

For each confirmed problem, provide:

- Severity
- Affected files
- Why it matters
- Smallest safe fix
- Testing required

Do not make destructive data changes without explicitly explaining the migration and rollback strategy.
