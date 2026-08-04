/**
 * Where the student was, so relaunching the app can put them back.
 *
 * Installed as a PWA, Jami always starts at `/`, so a relaunch would otherwise
 * land on the home screen wherever they had got to.
 *
 * Kept in **session** storage, which decides the behaviour and is the point of
 * choosing it. Closing the app properly ends the session and clears this, so
 * the next launch opens at home. A launch that is really the same session
 * resumed -- backgrounded, or evicted and restored by the OS -- still has it,
 * and goes back to the page that was open. That matches what closing an app is
 * understood to mean without having to ask the operating system, which does not
 * reliably say.
 */

const LAST_ROUTE_KEY = "jami:last-route";

/**
 * Somewhere inside the app that it is safe to send a browser.
 *
 * Anything that could leave the app is refused rather than corrected: this
 * value is a path handed straight to the router, and a stored `//evil.example`
 * or `https://…` would be followed off-site. Only paths under the dashboard
 * qualify, which is the only part of the app worth returning to.
 */
export function isRestorableRoute(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith("/dashboard")) return false;
  // `//host` is protocol-relative and leaves the site; a colon before the first
  // slash would be a scheme. Neither can appear in a path we wrote.
  if (value.startsWith("//") || value.includes("://")) return false;
  if (value.includes("\\")) return false;
  return true;
}

export function rememberLastRoute(path: string) {
  if (!isRestorableRoute(path)) return;

  try {
    window.sessionStorage.setItem(LAST_ROUTE_KEY, path);
  } catch {
    // Storage can be unavailable in privacy modes. Returning to the home
    // screen is a perfectly good outcome; it is what happens anyway.
  }
}

/** The page to open on launch: where they were, or the home screen. */
export function readLastRoute(fallback = "/dashboard") {
  try {
    const stored = window.sessionStorage.getItem(LAST_ROUTE_KEY);
    return isRestorableRoute(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function forgetLastRoute() {
  try {
    window.sessionStorage.removeItem(LAST_ROUTE_KEY);
  } catch {
    // Nothing to clean up if it was never readable.
  }
}
