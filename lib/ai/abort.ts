/**
 * Why an AI request stopped, as a type rather than a message to match on.
 *
 * The abort reason used to be a bare string. `fetch` rejects with whatever the
 * reason is, so the rejection was a string, and every check downstream asked
 * `error instanceof Error` first and got false -- which is how two client-side
 * timeouts were logged as provider failures and sent an investigation after an
 * outage that had not happened. Reading a category out of prose was the
 * underlying mistake; this carries it.
 *
 *   call_timeout  this attempt's own budget ran out.
 *   deadline      the whole operation's budget ran out, which is a different
 *                 thing: retrying the attempt cannot help.
 *   cancelled     the caller went away.
 *
 * It lives in its own module rather than beside the OpenRouter client because
 * it is not OpenRouter's idea, and because the router would otherwise have to
 * import a runtime value from a module half the suite replaces with a mock.
 *
 * What it deliberately does not say is what the provider was doing. A client
 * abort establishes only that this end stopped waiting: the request may have
 * been generating, queued, or stalled, it may have produced tokens, and it may
 * have been billed for them. No timing on this side tells those apart.
 */
export type AiAbortKind = "call_timeout" | "deadline" | "cancelled";

export const AI_TIMEOUT_MESSAGE = "Request timed out";

export class AiAbortError extends Error {
  constructor(readonly kind: AiAbortKind) {
    super(
      kind === "cancelled"
        ? "Request cancelled"
        : kind === "deadline"
          ? "Deadline reached before the request completed"
          : AI_TIMEOUT_MESSAGE
    );
    this.name = "AiAbortError";
  }
}
