/**
 * Whether a pen is writing on a notebook page, for work that can wait.
 *
 * Two jobs used to run whenever their own timers fired, pen or no pen:
 *
 *  - the PDF page render, which pdf.js runs on the main thread in slices of up
 *    to 15ms, one per animation frame, until the page is done;
 *  - the page's SVG export, taken for the recovery draft, the swipe snapshot
 *    and the autosave, which kept going once started even if the pen came
 *    back down.
 *
 * Every slice that landed mid-stroke was a frame the ink could not use, and on
 * a slower iPad a heavy PDF page kept that up for seconds: the pen wrote, the
 * page showed nothing, then the whole word arrived at once when the render
 * finished. Neither job is urgent -- a page already on screen stays on screen,
 * and a draft taken a moment later is just as good -- so both now ask here
 * first and wait for the pen to lift.
 *
 * The ink editor reports each contact. Anything that can wait calls
 * `whenNotebookInkIdle` or `untilNotebookInkIdle` between its slices.
 */

/**
 * How long after the last pen lifts before waiting work resumes.
 *
 * Long enough to span the gap between two strokes of the same word, so a
 * resumed slice does not land just as the next one starts; short enough that
 * a pause between words still lets work through.
 */
export const NOTEBOOK_INK_IDLE_GRACE_MS = 150;

/**
 * The longest any waiting work is held, however busy the pen is.
 *
 * A safety valve, not a tuning knob. If a contact were ever reported and never
 * ended, everything waiting here -- autosave included -- would wait forever.
 * No real stroke comes close to this.
 */
export const NOTEBOOK_INK_MAX_HOLD_MS = 4_000;

const contacts = new Set<object>();
const waiters = new Set<() => void>();
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let settled = true;

function releaseWaiters() {
  const pending = [...waiters];
  waiters.clear();
  pending.forEach((callback) => callback());
}

/**
 * Reports whether `owner` has a pen on the page.
 *
 * Owners are tracked separately so two surfaces with ink, or one remounting,
 * cannot end each other's contacts.
 */
export function setNotebookInkContact(owner: object, active: boolean) {
  if (active) {
    contacts.add(owner);
    settled = false;
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    return;
  }
  if (!contacts.delete(owner) || contacts.size > 0) return;
  if (graceTimer !== null) clearTimeout(graceTimer);
  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (contacts.size > 0) return;
    settled = true;
    releaseWaiters();
  }, NOTEBOOK_INK_IDLE_GRACE_MS);
}

/** True while a pen is down, or lifted less than the grace period ago. */
export function isNotebookInkBusy() {
  return !settled;
}

/**
 * Runs `callback` once no pen is writing, straight away if none is.
 *
 * Returns a function that drops the callback if it has not run yet, for work
 * that is cancelled while it waits.
 */
export function whenNotebookInkIdle(
  callback: () => void,
  maxHoldMs = NOTEBOOK_INK_MAX_HOLD_MS
): () => void {
  if (settled) {
    callback();
    return () => undefined;
  }
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    clearTimeout(fallback);
    waiters.delete(run);
    callback();
  };
  const fallback = setTimeout(run, maxHoldMs);
  waiters.add(run);
  return () => {
    done = true;
    clearTimeout(fallback);
    waiters.delete(run);
  };
}

export function untilNotebookInkIdle(): Promise<void> {
  return new Promise((resolve) => {
    whenNotebookInkIdle(resolve);
  });
}

/**
 * Resolves on a new task, so the browser can paint and deliver input first.
 *
 * A message rather than `setTimeout(0)`, which browsers clamp to 4ms once
 * nested, and rather than an animation frame, which would put the work just
 * in front of the paint it is trying to stay out of the way of.
 */
export function yieldToNotebookInput(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * Paces a long job that reports progress one item at a time: a fresh task
 * every `sliceSize` items, and no work at all while a pen is on the page.
 *
 * Written for the page's SVG export. js-draw's own pause waits for an
 * animation frame, which is exactly where the next frame's ink is drawn, and
 * it never looked at the pen -- an export that started between two words ran
 * on through the next one.
 */
export async function paceNotebookInkWork(processed: number, sliceSize: number) {
  if (sliceSize <= 0 || processed % sliceSize !== 0) return;
  await yieldToNotebookInput();
  if (isNotebookInkBusy()) await untilNotebookInkIdle();
}

/** Forgets every contact and waiter. Tests only. */
export function resetNotebookInkActivityForTests() {
  contacts.clear();
  if (graceTimer !== null) clearTimeout(graceTimer);
  graceTimer = null;
  settled = true;
  releaseWaiters();
}
