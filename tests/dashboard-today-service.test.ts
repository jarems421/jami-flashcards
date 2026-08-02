import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureStudyStateSetup: vi.fn(),
  ensureDailyReviewState: vi.fn(),
  getDecks: vi.fn(),
  loadInAppUsername: vi.fn(),
  loadUserCards: vi.fn(),
  loadRemoteActiveStudySession: vi.fn(),
  getDashboardGoalSummary: vi.fn(),
  loadDashboardStudyActivity: vi.fn(),
  getActiveTopics: vi.fn(),
  getMasteryEvents: vi.fn(),
  getPendingGeneratedContentDrafts: vi.fn(),
  getActiveSourcesForDashboard: vi.fn(),
  getActiveStudyFoldersPage: vi.fn(),
  getRecentActiveNotebooks: vi.fn(),
}));

vi.mock("@/services/study/daily-review", () => ({
  ensureStudyStateSetup: mocks.ensureStudyStateSetup,
  ensureDailyReviewState: mocks.ensureDailyReviewState,
}));
vi.mock("@/services/study/decks", () => ({ getDecks: mocks.getDecks }));
vi.mock("@/services/profile", () => ({
  loadInAppUsername: mocks.loadInAppUsername,
}));
vi.mock("@/services/study/cards", () => ({
  loadUserCards: mocks.loadUserCards,
}));
vi.mock("@/services/study/session", () => ({
  loadRemoteActiveStudySession: mocks.loadRemoteActiveStudySession,
}));
vi.mock("@/services/study/goals", () => ({
  getDashboardGoalSummary: mocks.getDashboardGoalSummary,
}));
vi.mock("@/services/study/activity", () => ({
  loadDashboardStudyActivity: mocks.loadDashboardStudyActivity,
}));
vi.mock("@/services/study/topics", () => ({
  getActiveTopics: mocks.getActiveTopics,
}));
vi.mock("@/services/study/mastery", () => ({
  getMasteryEvents: mocks.getMasteryEvents,
}));
vi.mock("@/services/study/generated-content", () => ({
  getPendingGeneratedContentDrafts: mocks.getPendingGeneratedContentDrafts,
}));
vi.mock("@/services/study/sources", () => ({
  getActiveSourcesForDashboard: mocks.getActiveSourcesForDashboard,
}));
vi.mock("@/services/study/folders", () => ({
  getActiveStudyFoldersPage: mocks.getActiveStudyFoldersPage,
}));
vi.mock("@/services/study/notebooks", () => ({
  getRecentActiveNotebooks: mocks.getRecentActiveNotebooks,
}));

const { clearDashboardData, invalidateDashboardData } = await import(
  "@/services/dashboard/cache"
);
const { getCachedDashboardSnapshot, loadDashboardSnapshot } = await import(
  "@/services/dashboard/today"
);

function resetSuccessfulLoads() {
  mocks.ensureStudyStateSetup.mockResolvedValue(undefined);
  mocks.ensureDailyReviewState.mockResolvedValue({
    requiredCardIds: [],
    optionalCardIds: [],
    completedRequiredCardIds: [],
    parkedRequiredCardIds: [],
    completedOptionalCardIds: [],
  });
  mocks.getDecks.mockResolvedValue([]);
  mocks.loadInAppUsername.mockResolvedValue("Student");
  mocks.loadUserCards.mockResolvedValue([]);
  mocks.loadRemoteActiveStudySession.mockResolvedValue({
    session: null,
    foundRemoteSession: false,
  });
  mocks.getDashboardGoalSummary.mockResolvedValue({
    activeGoals: [],
    hasEarnedStars: false,
  });
  mocks.loadDashboardStudyActivity.mockResolvedValue([]);
  mocks.getActiveTopics.mockResolvedValue([]);
  mocks.getMasteryEvents.mockResolvedValue([]);
  mocks.getPendingGeneratedContentDrafts.mockResolvedValue([]);
  mocks.getActiveSourcesForDashboard.mockResolvedValue([]);
  mocks.getActiveStudyFoldersPage.mockResolvedValue({
    items: [],
    nextCursor: null,
  });
  mocks.getRecentActiveNotebooks.mockResolvedValue([]);
}

beforeEach(() => {
  clearDashboardData("user-1");
  Object.values(mocks).forEach((mock) => mock.mockReset());
  resetSuccessfulLoads();
});

describe("Today data coordinator", () => {
  it("deduplicates overlapping loads and serves a fresh snapshot without refetching", async () => {
    const [first, second] = await Promise.all([
      loadDashboardSnapshot("user-1"),
      loadDashboardSnapshot("user-1"),
    ]);

    expect(first.snapshot.username).toBe("Student");
    expect(second.snapshot).toBe(first.snapshot);
    expect(mocks.getDecks).toHaveBeenCalledOnce();
    expect(mocks.getPendingGeneratedContentDrafts).toHaveBeenCalledWith(
      "user-1",
      4
    );
    expect(mocks.getActiveStudyFoldersPage).toHaveBeenCalledWith("user-1", {
      pageSize: 1,
    });
    expect(mocks.getRecentActiveNotebooks).toHaveBeenCalledWith("user-1", 1);
    expect(mocks.getActiveSourcesForDashboard).toHaveBeenCalledWith(
      "user-1",
      []
    );

    await loadDashboardSnapshot("user-1");
    expect(mocks.getDecks).toHaveBeenCalledOnce();
    expect(getCachedDashboardSnapshot("user-1")?.freshness).toBe("fresh");
  });

  it("bypasses a fresh cache for an explicit refresh and expires displayable stale data", async () => {
    await loadDashboardSnapshot("user-1");

    const refreshed = await loadDashboardSnapshot("user-1", { force: true });

    expect(mocks.getDecks).toHaveBeenCalledTimes(2);
    expect(
      getCachedDashboardSnapshot(
        "user-1",
        refreshed.snapshot.fetchedAt + 5 * 60_000 + 1
      )
    ).toBeNull();
  });

  it("marks a successful snapshot stale after a related write invalidates it", async () => {
    await loadDashboardSnapshot("user-1");
    invalidateDashboardData("user-1");

    expect(getCachedDashboardSnapshot("user-1")?.freshness).toBe("stale");
    await loadDashboardSnapshot("user-1");
    expect(mocks.getDecks).toHaveBeenCalledTimes(2);
  });

  it("retains previous values and labels a failed refresh instead of caching false emptiness", async () => {
    mocks.getDecks.mockResolvedValue([
      { id: "deck-1", name: "Biology", userId: "user-1", createdAt: 1 },
    ]);
    await loadDashboardSnapshot("user-1");
    invalidateDashboardData("user-1");
    mocks.getDecks.mockRejectedValue(new Error("offline"));

    const refreshed = await loadDashboardSnapshot("user-1");

    expect(refreshed.snapshot.decks).toHaveLength(1);
    expect(refreshed.snapshot.sections.decks).toBe("stale");
    expect(refreshed.feedback?.type).toBe("error");
    // Naming the section is the point: Today loads thirteen of them, so a
    // bare count cannot be acted on by the student or by whoever debugs it.
    expect(refreshed.feedback?.message).toContain("your decks");
    expect(
      getCachedDashboardSnapshot(
        "user-1",
        refreshed.snapshot.fetchedAt + 5 * 60_000 + 1
      )
    ).toBeNull();
  });

  it("marks a first-load failure unavailable while keeping its empty value distinguishable", async () => {
    mocks.getActiveSourcesForDashboard.mockRejectedValue(new Error("offline"));

    const result = await loadDashboardSnapshot("user-1");

    expect(result.snapshot.sources).toEqual([]);
    expect(result.snapshot.sections.sources).toBe("unavailable");
    expect(getCachedDashboardSnapshot("user-1")?.freshness).toBe("stale");
  });

  it("keeps an in-flight snapshot stale when a mutation invalidates it", async () => {
    let resolveDecks!: (value: unknown[]) => void;
    mocks.getDecks.mockReturnValue(
      new Promise((resolve) => {
        resolveDecks = resolve;
      })
    );

    const firstLoad = loadDashboardSnapshot("user-1");
    await Promise.resolve();
    invalidateDashboardData("user-1");
    resolveDecks([]);
    await firstLoad;

    expect(getCachedDashboardSnapshot("user-1")?.freshness).toBe("stale");
    mocks.getDecks.mockResolvedValue([]);
    await loadDashboardSnapshot("user-1");
    expect(mocks.getDecks).toHaveBeenCalledTimes(2);
  });

  it("does not rebuild review queues when active-session state is unavailable", async () => {
    mocks.loadRemoteActiveStudySession.mockRejectedValue(new Error("offline"));

    const result = await loadDashboardSnapshot("user-1");

    expect(mocks.ensureDailyReviewState).not.toHaveBeenCalled();
    expect(result.snapshot.sections.session).toBe("unavailable");
    expect(result.snapshot.sections.dailyReview).toBe("unavailable");
  });
});
