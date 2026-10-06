import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/study/cards";
import type { DailyReviewState } from "@/lib/study/daily-review";
import type { Topic } from "@/lib/material/topics";
import {
  buildPersistedStudySession,
  closePersistedStudySession,
  createEmptySessionStats,
  type PersistedStudySession,
} from "@/lib/study/session";
import { planStudySessionRestore } from "@/lib/study/session-restore";

function createCard(id: string): Card {
  return {
    id,
    deckId: "deck-1",
    userId: "user-1",
    front: `Front ${id}`,
    back: `Back ${id}`,
    createdAt: 1,
    tags: [],
  };
}

const cards = [createCard("card-1"), createCard("card-2"), createCard("card-3")];

function createSession(
  overrides: Partial<PersistedStudySession> = {},
  options: { sessionId?: string; index?: number; startedAt?: number } = {}
): PersistedStudySession {
  return {
    ...buildPersistedStudySession({
      userId: "user-1",
      sessionId: options.sessionId ?? "session-1",
      kind: "custom",
      sessionCards: cards,
      index: options.index ?? 1,
      stats: createEmptySessionStats(),
      selectedDeckIds: [],
      selectedTopicIds: [],
      startedAt: options.startedAt ?? 1_000,
      now: 2_000,
    }),
    ...overrides,
  };
}

const noRemote = { session: null, foundRemoteSession: false };
const anyRequest = { mode: null, deckIds: [], topicIds: [] };

function plan(input: Partial<Parameters<typeof planStudySessionRestore>[0]>) {
  return planStudySessionRestore({
    localSession: null,
    remote: noRemote,
    isClosedHere: () => false,
    request: anyRequest,
    topics: [],
    cards,
    dailyReviewState: null as DailyReviewState | null,
    ...input,
  });
}

describe("planStudySessionRestore", () => {
  it("resumes this device's session where it was left", () => {
    const localSession = createSession();

    expect(plan({ localSession })).toEqual({
      kind: "resume",
      session: localSession,
      cards,
      index: 1,
    });
  });

  it("prefers the server's copy when it is further on, keeping this device's drafts", () => {
    const localSession = createSession({ draftResponses: { "draft-1": "half an answer" } });
    const remoteSession = createSession({ revision: 4, index: 2 });

    const result = plan({
      localSession,
      remote: { session: remoteSession, foundRemoteSession: true },
    });

    expect(result).toMatchObject({ kind: "resume", index: 2 });
    expect(result.kind === "resume" ? result.session.draftResponses : null).toEqual({
      "draft-1": "half an answer",
    });
  });

  it("forgets a session the server says was closed after this copy", () => {
    const localSession = createSession();
    const closed = closePersistedStudySession(localSession, "ended", "user-ended", 3_000);

    expect(
      plan({
        localSession,
        remote: { session: null, closedSession: closed, foundRemoteSession: true },
      })
    ).toEqual({ kind: "discard", closedElsewhere: closed });
  });

  it("clears the saved copy when the server has no active session and none is saved here", () => {
    expect(
      plan({ remote: { session: null, closedSession: null, foundRemoteSession: true } })
    ).toEqual({ kind: "discard" });
  });

  it("remembers a different session closed elsewhere without touching this one", () => {
    const localSession = createSession();
    const otherClosed = closePersistedStudySession(
      createSession({}, { sessionId: "session-0", startedAt: 500 }),
      "completed",
      "completed",
      900
    );

    expect(
      plan({
        localSession,
        remote: { session: null, closedSession: otherClosed, foundRemoteSession: true },
      })
    ).toEqual({ kind: "none", closedElsewhere: otherClosed });
  });

  it("does not resume a session this device already closed", () => {
    expect(plan({ localSession: createSession(), isClosedHere: () => true })).toEqual({
      kind: "discard",
    });
  });

  it("leaves a session that does not match the link for later", () => {
    expect(
      plan({ localSession: createSession(), request: { mode: "daily", deckIds: [], topicIds: [] } })
    ).toEqual({ kind: "none" });
  });

  it("closes a saved session with nothing left to answer", () => {
    const localSession = createSession({}, { index: 3 });

    expect(plan({ localSession })).toEqual({ kind: "close-finished", session: localSession });
  });

  it("matches the tag filters of an old session to Topics by name", () => {
    const topics: Topic[] = [
      {
        id: "topic-1",
        name: "Cell Biology",
        slug: "cell-biology",
        subject: "Biology",
        status: "active",
        createdBy: "user",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const localSession = createSession({ legacySelectedTags: ["cell biology", "gone"] });

    const result = plan({ localSession, topics });

    expect(result.kind === "resume" ? result.session.selectedTopicIds : null).toEqual(["topic-1"]);
    expect(result.kind === "resume" ? result.session.legacySelectedTags : "kept").toBeUndefined();
  });
});
