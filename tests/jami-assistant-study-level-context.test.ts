import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    accountLevel: "undergraduate" as string | undefined,
    folderIds: ["folder-1"],
    folderLevels: new Map<string, string | undefined>([
      ["folder-1", "post-16-equivalent"],
    ]),
  };

  const emptyQuery = {
    where: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(async () => ({ docs: [] })),
  };
  emptyQuery.where.mockReturnValue(emptyQuery);
  emptyQuery.limit.mockReturnValue(emptyQuery);

  const cardQuery = {
    where: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(async () => ({ docs: [] })),
  };
  cardQuery.where.mockReturnValue(cardQuery);
  cardQuery.limit.mockReturnValue(cardQuery);

  const db = {
    collection: vi.fn((name: string) => {
      if (name === "cards") {
        return {
          ...cardQuery,
          doc: () => ({
            get: async () => ({
              id: "card-1",
              exists: true,
              data: () => ({
                userId: "user-1",
                deckId: "deck-1",
                front: "Explain differentiation.",
                back: "The rate of change.",
              }),
            }),
          }),
        };
      }
      if (name === "decks") {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({
                userId: "user-1",
                name: "Maths",
                folderIds: state.folderIds,
              }),
            }),
          }),
        };
      }
      if (name === "users") {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({ defaultStudyLevel: state.accountLevel }),
            }),
            collection: (collectionName: string) => {
              if (collectionName === "studyFolders") {
                return {
                  doc: (folderId: string) => ({
                    get: async () => ({
                      exists: true,
                      data: () => ({ studyLevel: state.folderLevels.get(folderId) }),
                    }),
                  }),
                };
              }
              return {
                ...emptyQuery,
                doc: () => ({
                  get: async () => ({ exists: false, data: () => undefined }),
                }),
              };
            },
          }),
        };
      }
      return emptyQuery;
    }),
  };

  return { db, state };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => mocks.db,
}));

const { resolveJamiAssistantContext } = await import(
  "@/services/ai/assistant-context"
);

async function resolve() {
  return resolveJamiAssistantContext({
    uid: "user-1",
    message: "Explain this.",
    context: { surface: "learn", cardId: "card-1", phase: "answer" },
    useRelatedSources: false,
  });
}

beforeEach(() => {
  mocks.state.accountLevel = "undergraduate";
  mocks.state.folderIds = ["folder-1"];
  mocks.state.folderLevels = new Map([
    ["folder-1", "post-16-equivalent"],
  ]);
});

describe("Tutor study-level context", () => {
  it("prefers the current folder override to the account default", async () => {
    const result = await resolve();

    expect(result.studyLevelContext).toContain("A level, IB or equivalent");
    expect(result.studyLevelContext).toContain("folder override");
    expect(result.studyLevelContext).toContain("not the student's ability");
  });

  it("uses the account default when the folder inherits it", async () => {
    mocks.state.folderLevels.set("folder-1", undefined);

    const result = await resolve();

    expect(result.studyLevelContext).toContain("undergraduate university level");
    expect(result.studyLevelContext).toContain("account default");
  });

  it("does not choose between conflicting folder overrides", async () => {
    mocks.state.folderIds = ["folder-1", "folder-2"];
    mocks.state.folderLevels.set("folder-2", "gcse-equivalent");

    const result = await resolve();

    expect(result.studyLevelContext).toContain("undergraduate university level");
    expect(result.studyLevelContext).toContain("account default");
  });
});
