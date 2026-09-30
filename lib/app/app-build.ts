/**
 * Keeping an installed app on the build that is actually deployed.
 *
 * An installed Jami can go on running a build long after it was replaced.
 * iPadOS keeps a home-screen app suspended in memory rather than relaunching
 * it, so it resumes on whatever JavaScript it last loaded; and the service
 * worker opens on a cached page whenever the network is slower than its budget.
 * A pen fix could be deployed and never reach the student it was for, and a
 * report from them could be about code that no longer exists.
 *
 * So the app compares the build it is running with the one the server says is
 * deployed, and reloads onto the new one -- but only at a moment when a reload
 * cannot cost anything.
 */

/** The commit this copy of the app was built from; empty outside Vercel. */
export const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "";

/**
 * The build as someone reads it off a screen, to compare with `git log`.
 *
 * "Is it fixed for them?" used to be a guess about whether their app had
 * updated. The account page shows this, so it can be read off their device.
 */
export function appBuildLabel(build: string = APP_BUILD) {
  const trimmed = build.trim();
  if (!trimmed) return "development";
  return trimmed.startsWith("dpl_") ? trimmed.slice(4, 12) : trimmed.slice(0, 7);
}

/** Where a reload is attempted from. */
export type AppUpdateMoment = "launch" | "navigation" | "resume";

/**
 * Pages worked on in place, where returning to the app must never reload it.
 *
 * Each holds an answer, a paper or a session that is saved on its own terms,
 * and none of them reports whether it has, so coming back to one waits for the
 * next page change instead. Notebooks are not listed: they say for themselves
 * whether anything is unsaved (`setUnsavedWork`).
 */
const HELD_ON_RESUME_PATHS = [
  "/dashboard/practice/questions/",
  "/dashboard/practice/papers/",
  "/dashboard/revision/",
];

/** Whether the server's build is a different one from the build running here. */
export function isOutdatedBuild(running: string, deployed: unknown): deployed is string {
  return (
    typeof deployed === "string" &&
    deployed.trim() !== "" &&
    running.trim() !== "" &&
    deployed.trim() !== running.trim()
  );
}

/**
 * Whether now is a moment a reload is free.
 *
 * On launch nothing has been done yet. On a page change the page being left has
 * already gone, exactly as it would on any other navigation. On returning to
 * the app something may have been left half-saved, so it waits for anything
 * unsaved and never interrupts a page listed above.
 */
export function mayReloadForUpdate(input: {
  moment: AppUpdateMoment;
  pathname: string;
  unsavedWork: boolean;
}) {
  if (input.unsavedWork) return false;
  if (input.moment !== "resume") return true;
  return !HELD_ON_RESUME_PATHS.some((prefix) => input.pathname.startsWith(prefix));
}

/**
 * Whether this session has already reloaded for that build.
 *
 * A reload that comes back on the old build -- a CDN still serving it, an
 * offline launch -- must not become a loop. One attempt per build per session;
 * the next launch tries again.
 */
export function alreadyReloadedFor(deployed: string, reloadedFor: string | null) {
  return reloadedFor === deployed;
}

/** Pages that say they hold unsaved work, so an update waits for them. */
const unsavedWorkHolders = new Set<string>();

export function setUnsavedWork(holder: string, unsaved: boolean) {
  if (unsaved) unsavedWorkHolders.add(holder);
  else unsavedWorkHolders.delete(holder);
}

export function hasUnsavedWork() {
  return unsavedWorkHolders.size > 0;
}
