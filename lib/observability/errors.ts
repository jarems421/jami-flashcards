import "server-only";

import * as Sentry from "@sentry/node";

/**
 * Where a server error goes, so that finding out about one does not depend on
 * a student telling you.
 *
 * Structured logs already carry every request, but they are written to stdout
 * and nothing watches them: a crash in an API route, a workflow step or a
 * provider failover is discoverable only by knowing to look. This is the part
 * that arrives without being asked for.
 *
 * Inert until `SENTRY_DSN` is set. With no DSN this initialises nothing, sends
 * nothing and costs nothing, so it is safe to ship before the account exists --
 * paste the DSN in and it starts reporting with no code change.
 *
 * Server only, deliberately. The browser SDK would need a CSP entry and would
 * ship to every page, and the failures worth waking up for are the ones a
 * student never sees.
 */

let started = false;

function dsn() {
  return process.env.SENTRY_DSN?.trim() ?? "";
}

export function initialiseErrorReporting() {
  if (started || !dsn()) return;
  started = true;

  Sentry.init({
    dsn: dsn(),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    /*
     * Performance tracing is off. What is missing today is knowing that
     * something broke; sampling spans on every AI request is a separate
     * decision with its own cost, and turning it on by default would make the
     * first bill a surprise.
     */
    tracesSampleRate: 0,
    /*
     * Never send request bodies, headers, cookies or user identifiers.
     *
     * This app's logger redacts by field name because student work is the
     * easiest thing in it to leak, and an error reporter that helpfully
     * attaches the request body would walk straight past that. What is wanted
     * here is the stack and the route, not the flashcard.
     */
    sendDefaultPii: false,
    maxValueLength: 2_000,
    beforeSend(event) {
      if (event.request) {
        event.request = {
          method: event.request.method,
          url: event.request.url?.split("?")[0],
        };
      }
      delete event.user;
      return event;
    },
  });
}

/** Reports a server-side failure, and never throws while doing so. */
export function captureServerError(
  error: unknown,
  context?: { route?: string; action?: string }
) {
  if (!dsn()) return;
  try {
    initialiseErrorReporting();
    Sentry.captureException(error, context ? { tags: context } : undefined);
  } catch {
    // A reporter that can take the request down with it is worse than one that
    // occasionally misses an error.
  }
}
