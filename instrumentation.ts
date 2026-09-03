/**
 * Next's server bootstrap, used here for one thing: making a crash visible.
 *
 * `register` runs once per server runtime and `onRequestError` is called for
 * every unhandled error in a route, a server component or a workflow step --
 * which is exactly the set that previously went to stdout and no further.
 *
 * Both are inert without `SENTRY_DSN`, and neither runs in the browser.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initialiseErrorReporting } = await import("@/lib/observability/errors");
  initialiseErrorReporting();
}

export async function onRequestError(
  error: unknown,
  request: { path?: string },
  context: { routerKind?: string; routePath?: string; routeType?: string }
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureServerError } = await import("@/lib/observability/errors");
  captureServerError(error, {
    // The matched route pattern rather than the resolved path, so errors group
    // by the code that failed instead of by whose document hit it.
    route: context.routePath ?? request.path ?? "unknown",
    ...(context.routeType ? { action: context.routeType } : {}),
  });
}
