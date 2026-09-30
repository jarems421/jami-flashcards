/**
 * The one thing Today needs to know about a session it sent the student into.
 *
 * Today proposes a piece of work, the student goes and does it somewhere else,
 * and comes back. Without a handoff the home page cannot tell that apart from
 * an ordinary visit, so it greets somebody who has just finished exactly as it
 * greets somebody who has just arrived -- which reads as Jami not noticing.
 *
 * Deliberately a note in the browser rather than anything stored. What the
 * engine needs to know is already written as a study-action event by the
 * surface that did the work, and reading it back to draw one sentence would
 * mean a Firestore query on every load of the most-visited page in the app.
 * This is only the sentence.
 *
 * So it is allowed to be lost. A closed tab, a second device, storage the
 * browser refuses: all of them cost the completion moment and nothing else,
 * which is the right trade for a flourish.
 */

const KEY = "jami:mission-handoff";

/**
 * The id used when the mission is the day's review rather than a recommendation.
 *
 * Due cards are the commonest thing Today asks for and they come from the
 * scheduler, not from the engine, so there is no recommendation to complete --
 * but the student has still done the thing the page asked them to do, and
 * coming back to no acknowledgement is the gap this whole handoff exists to
 * close.
 *
 * It travels on the session link in the same slot a real action id would, and
 * it is deliberately shaped so `parseStudyActionId` refuses it: it has no
 * scope, reason or target, so nothing can turn it into a study-action event
 * about advice that was never given. That refusal is load-bearing rather than
 * incidental, and is pinned by a test.
 */
export const DAILY_REVIEW_MISSION_ID = "today:daily-review";
/** A start older than this was not this sitting; a session left open overnight is not a handoff. */
const START_TTL_MS = 4 * 60 * 60 * 1000;
/** How long a finished mission is still worth mentioning when the student comes back. */
const COMPLETION_TTL_MS = 60 * 60 * 1000;

export type MissionHandoff = {
  /** The recommendation this was, so a different one finishing cannot claim it. */
  actionId: string;
  /** What Today said, in the words the student read. */
  headline: string;
  conceptLabel: string;
  startedAt: number;
  completedAt?: number;
  /** How many items were actually answered. Never inferred from the target. */
  answered?: number;
  targetItems?: number;
};

function read(): MissionHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MissionHandoff>;
    if (
      typeof parsed?.actionId !== "string" ||
      typeof parsed.headline !== "string" ||
      typeof parsed.conceptLabel !== "string" ||
      typeof parsed.startedAt !== "number"
    ) {
      return null;
    }
    return parsed as MissionHandoff;
  } catch {
    // Blocked or corrupt storage costs the completion moment, nothing else.
    return null;
  }
}

function write(record: MissionHandoff | null) {
  if (typeof window === "undefined") return;
  try {
    if (record) window.sessionStorage.setItem(KEY, JSON.stringify(record));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing downstream depends on this having been written.
  }
}

/** Today, handing off: the student has just opened the work it proposed. */
export function noteMissionStarted(
  input: Omit<MissionHandoff, "startedAt" | "completedAt" | "answered">,
  now = Date.now()
) {
  write({ ...input, startedAt: now });
}

/**
 * The surface that did the work, handing back.
 *
 * Only ever marks the mission the student was actually sent on: a session
 * opened from somewhere else finishing must not let an unrelated
 * recommendation announce itself as done.
 *
 * `answered` is what happened, not what was asked for. A student who answered
 * two of five has done two, and saying otherwise on the way back would be the
 * one place in this loop where Jami overstates the student's work.
 */
export function noteMissionCompleted(actionId: string, answered: number, now = Date.now()) {
  const current = read();
  if (!current || current.actionId !== actionId) return;
  if (now - current.startedAt > START_TTL_MS) {
    write(null);
    return;
  }
  write({ ...current, completedAt: now, answered });
}

/**
 * A mission finished by something that already knows what it was.
 *
 * The paired form above exists because a flashcard session knows only an
 * action id -- it has to be told the concept on the way out. Material Jami
 * wrote does not have that problem: the provenance is stored on the paper
 * itself, durably, so the surface that marks it can say what was finished
 * without anything having been left in this tab beforehand.
 *
 * That matters more than it sounds. A student can confirm a set of questions
 * today and sit them next week, on another device, in another tab -- by which
 * time nothing survives here. Requiring a start record would mean the
 * acknowledgement worked only for people who did it immediately.
 *
 * It replaces whatever is here, including an unfinished start for something
 * else: they have just finished this, and this is the more recent truth.
 */
export function noteMissionFinished(
  input: { actionId: string; headline: string; conceptLabel: string; targetItems?: number },
  answered: number,
  now = Date.now()
) {
  if (!input.actionId.trim() || answered <= 0) return;
  write({ ...input, startedAt: now, completedAt: now, answered });
}

/**
 * The finished mission, once, if there is one.
 *
 * Clears as it reads. The moment belongs to the return journey, and a student
 * who has seen it and carried on should not meet it again on their next visit.
 */
export function takeCompletedMission(now = Date.now()): MissionHandoff | null {
  const current = read();
  if (!current) return null;
  if (!current.completedAt) {
    // Still out there, or abandoned. Only age clears it, so coming back to
    // Today mid-session does not throw away the handoff.
    if (now - current.startedAt > START_TTL_MS) write(null);
    return null;
  }
  write(null);
  return now - current.completedAt <= COMPLETION_TTL_MS ? current : null;
}

/** Forget a handoff outright, for a student who has declined or started something else. */
export function clearMission() {
  write(null);
}
