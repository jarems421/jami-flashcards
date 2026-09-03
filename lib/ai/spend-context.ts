import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type { AiSpendSample } from "@/lib/ai/spend";

/**
 * Who a request's model calls should be billed to, carried without threading.
 *
 * A single student request can fan out into a routing preflight, a worker call,
 * a supervisor pass and a juror opinion, across four files that have no reason
 * to know a user id. Passing one down to each would mean touching every AI call
 * site in the app and would still miss the next one somebody adds.
 *
 * The route establishes the context once and every model call underneath it is
 * attributed automatically. Each of these routes runs on the Node runtime,
 * where async-local storage survives the awaits in between.
 *
 * Absent context is normal, not an error: benchmark and internal tooling spend
 * against nobody in particular, and those calls are recorded as unattributed
 * rather than being blamed on whoever ran them.
 */
export type AiSpendContext = {
  uid: string;
  action: string;
  /**
   * Where a metered call goes. Supplied by the server layer rather than
   * imported, because this module sits in the pure domain layer and must not
   * reach into a service to reach Firestore -- the same rule that keeps the
   * provider clients swappable.
   */
  record: (sample: AiSpendSample) => void;
};

const storage = new AsyncLocalStorage<AiSpendContext>();

export function runWithAiSpendContext<T>(context: AiSpendContext, run: () => T): T {
  return storage.run(context, run);
}

export function getAiSpendContext(): AiSpendContext | undefined {
  return storage.getStore();
}

/**
 * Attributes the rest of the current request, for handlers that only learn who
 * the user is part-way through.
 *
 * A route verifies a token, checks a budget and only then knows both the uid
 * and the action, by which point there is no callback left to wrap. `enterWith`
 * sets the store for the remainder of this async execution instead.
 *
 * The caveat is real and worth stating: unlike `runWithAiSpendContext`, this
 * has no scope that closes, so it must be called once per request, inside the
 * handler, after authentication -- never at module load and never in shared
 * setup, where it could outlive the request that set it.
 */
export function enterAiSpendContext(context: AiSpendContext) {
  storage.enterWith(context);
}
