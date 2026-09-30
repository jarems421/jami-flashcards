import { describe, expect, it } from "vitest";
import {
  COMPLETION_COOLDOWN_DAYS,
  DISMISSALS_BEFORE_COOLDOWN,
  DISMISSAL_COOLDOWN_DAYS,
  actionCooldown,
  summariseActionHistory,
} from "@/lib/learning/actions/action-cooldown";
import {
  buildStudyActionEventWrite,
  decodeStudyActionEvent,
  studyActionEventId,
  type StudyActionEvent,
} from "@/lib/learning/events/study-action-event";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-21T10:00:00.000Z");

function event(overrides: Partial<StudyActionEvent> = {}): StudyActionEvent {
  return {
    id: "e1",
    actionId: "folder:f1|low_mastery|topic:osmosis",
    reason: "low_mastery",
    targetKey: "topic:osmosis",
    folderId: "f1",
    outcome: "completed",
    at: NOW - 2 * DAY,
    studyDayKey: "2026-09-19",
    ...overrides,
  };
}

describe("recording what became of advice", () => {
  it("writes one record per action, outcome and study day", () => {
    const first = studyActionEventId({
      actionId: "folder:f1|low_mastery|topic:osmosis",
      outcome: "shown",
      studyDayKey: "2026-09-21",
    });
    const again = studyActionEventId({
      actionId: "folder:f1|low_mastery|topic:osmosis",
      outcome: "shown",
      studyDayKey: "2026-09-21",
    });
    expect(first).toBe(again);
    expect(first).not.toContain("/");

    const nextDay = studyActionEventId({
      actionId: "folder:f1|low_mastery|topic:osmosis",
      outcome: "shown",
      studyDayKey: "2026-09-22",
    });
    expect(nextDay).not.toBe(first);
  });

  it("refuses a record it cannot trust", () => {
    const base = {
      actionId: "a",
      reason: "low_mastery",
      targetKey: "topic:x",
      outcome: "completed" as const,
      at: NOW,
      studyDayKey: "2026-09-21",
    };
    expect(buildStudyActionEventWrite(base, NOW)).not.toBeNull();
    expect(buildStudyActionEventWrite({ ...base, reason: "invented" }, NOW)).toBeNull();
    expect(buildStudyActionEventWrite({ ...base, studyDayKey: "21/09/2026" }, NOW)).toBeNull();
    expect(buildStudyActionEventWrite({ ...base, at: 0 }, NOW)).toBeNull();
    expect(buildStudyActionEventWrite({ ...base, actionId: "  " }, NOW)).toBeNull();
  });

  it("skips a stored record of an unknown schema rather than guessing", () => {
    const write = buildStudyActionEventWrite(
      {
        actionId: "a",
        reason: "low_mastery",
        targetKey: "topic:x",
        outcome: "completed",
        at: NOW,
        studyDayKey: "2026-09-21",
      },
      NOW
    );
    expect(decodeStudyActionEvent("id", { ...write })).not.toBeNull();
    expect(decodeStudyActionEvent("id", { ...write, schemaVersion: 2 })).toBeNull();
  });

  it("stores no wording, only ids and the outcome", () => {
    const write = buildStudyActionEventWrite(
      {
        actionId: "a",
        reason: "low_mastery",
        targetKey: "topic:x",
        folderId: "f1",
        outcome: "dismissed",
        at: NOW,
        studyDayKey: "2026-09-21",
      },
      NOW
    );
    expect(Object.keys(write ?? {}).sort()).toEqual([
      "actionId",
      "at",
      "createdAt",
      "folderId",
      "outcome",
      "reason",
      "schemaVersion",
      "studyDayKey",
      "targetKey",
    ]);
  });
});

describe("resting advice that has already been given", () => {
  it("rests an acted-on action until evidence newer than the work arrives", () => {
    const history = summariseActionHistory([event()]);
    const entry = history.get("folder:f1|low_mastery|topic:osmosis");

    // Evidence older than the work: they did it, nothing has been seen since.
    expect(actionCooldown(entry, { lastEvidenceAt: NOW - 5 * DAY }, NOW)).toBe("acted_on");
    // Evidence recorded after they acted: the loop has turned, speak again.
    expect(actionCooldown(entry, { lastEvidenceAt: NOW - DAY }, NOW)).toBeNull();
  });

  it("stops resting an acted-on action that never produced any evidence", () => {
    const actedAt = NOW - (COMPLETION_COOLDOWN_DAYS + 1) * DAY;
    const history = summariseActionHistory([event({ at: actedAt })]);
    expect(
      actionCooldown(history.get("folder:f1|low_mastery|topic:osmosis"), { lastEvidenceAt: actedAt - DAY }, NOW)
    ).toBeNull();
  });

  it("takes repeated dismissal as a signal, but only after a few", () => {
    const dismissals = Array.from({ length: DISMISSALS_BEFORE_COOLDOWN - 1 }, (_, index) =>
      event({ outcome: "dismissed", at: NOW - index * DAY })
    );
    const few = summariseActionHistory(dismissals);
    expect(
      actionCooldown(few.get("folder:f1|low_mastery|topic:osmosis"), { lastEvidenceAt: NOW }, NOW)
    ).toBeNull();

    const enough = summariseActionHistory([
      ...dismissals,
      event({ outcome: "dismissed", at: NOW - DAY }),
    ]);
    expect(
      actionCooldown(enough.get("folder:f1|low_mastery|topic:osmosis"), { lastEvidenceAt: NOW }, NOW)
    ).toBe("dismissed");
  });

  it("raises a dismissed action again once its rest is over", () => {
    const longAgo = NOW - (DISMISSAL_COOLDOWN_DAYS + 1) * DAY;
    const history = summariseActionHistory(
      Array.from({ length: DISMISSALS_BEFORE_COOLDOWN }, () =>
        event({ outcome: "dismissed", at: longAgo })
      )
    );
    expect(
      actionCooldown(history.get("folder:f1|low_mastery|topic:osmosis"), { lastEvidenceAt: NOW }, NOW)
    ).toBeNull();
  });

  it("says nothing about an action with no history", () => {
    expect(actionCooldown(undefined, { lastEvidenceAt: NOW }, NOW)).toBeNull();
  });
});

describe("the id one record is filed under", () => {
  it("tells two different actions apart on the same day", () => {
    const seen = new Set<string>();
    for (const topic of ["osmosis", "diffusion", "active-transport", "a/b", "a_b"]) {
      const id = studyActionEventId({
        actionId: `folder:f1|low_mastery|topic:${topic}`,
        outcome: "shown",
        studyDayKey: "2026-09-21",
      });
      expect(id).not.toBeNull();
      expect(seen.has(id as string)).toBe(false);
      seen.add(id as string);
    }
  });

  it("stays a legal, fixed-length Firestore id however long the action is", () => {
    const long = studyActionEventId({
      actionId: `folder:${"f".repeat(80)}|low_mastery|topic:${"t".repeat(80)}`,
      outcome: "completed",
      studyDayKey: "2026-09-21",
    });
    const short = studyActionEventId({
      actionId: "a|low_mastery|topic:b",
      outcome: "completed",
      studyDayKey: "2026-09-21",
    });
    expect(long).not.toBeNull();
    expect(long).not.toContain("/");
    expect((long as string).length).toBe((short as string).length);
  });
});
