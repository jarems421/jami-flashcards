import { describe, expect, it } from "vitest";
import {
  availableTutorAppActions,
  buildTutorAppInstruction,
  isJamiAppHref,
  jamiDestinations,
  normalizeJamiAppScope,
  normalizeTutorAppActions,
  readTutorAppActions,
  requestedPageCount,
  requestedTutorAppActions,
  resolveTutorAppLinks,
} from "@/lib/ai/jami-app-guide";
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";

const notebook = { surface: "notebook", notebookId: "nb1", pageId: "p1" } as JamiAssistantContext;
const sources = { surface: "sources", sourceIds: ["s1"] } as JamiAssistantContext;
const scope = { folderId: "bio", notebookId: "nb1" };

describe("where Tutor can send a student", () => {
  it("lists the app's pages, and the folder, deck and notebook in view", () => {
    const keys = jamiDestinations({ folderId: "bio", deckId: "d1", notebookId: "nb1" }).map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(["today", "flashcards", "exam_questions", "this_folder", "study_this_deck", "this_notebook"]));
    expect(jamiDestinations().map((d) => d.key)).not.toContain("this_folder");
    expect(jamiDestinations({ folderId: "../../etc" }).map((d) => d.key)).not.toContain("this_folder");
  });

  it("turns place keys into links and drops any that point nowhere", () => {
    const destinations = jamiDestinations({ folderId: "bio" });
    expect(
      resolveTutorAppLinks(
        "Make one in [Flashcards](jami:flashcards), practise in [this folder](jami:this_folder_exam_questions), see [nowhere](jami:secret_admin) or [a made-up page](/dashboard/admin) and [the web](https://example.com).",
        destinations
      )
    ).toBe(
      "Make one in [Flashcards](/dashboard/decks), practise in [this folder](/dashboard/practice/questions/new?folderId=bio), see nowhere or a made-up page and [the web](https://example.com)."
    );
  });

  it("knows its own pages from anything else", () => {
    expect(isJamiAppHref("/dashboard/decks")).toBe(true);
    expect(isJamiAppHref("/dashboard/notebooks/abc123")).toBe(true);
    expect(isJamiAppHref("/dashboard/internal/exam-corpus")).toBe(false);
    expect(isJamiAppHref("https://jami.app/dashboard")).toBe(false);
    expect(isJamiAppHref("/dashboard/decks/a/../../x")).toBe(false);
  });
});

describe("what Tutor can do", () => {
  it("adds pages only in a notebook, and makes a notebook only with a folder to put it in", () => {
    expect(availableTutorAppActions({ context: notebook, scope })).toEqual(["open", "create_deck", "add_pages", "create_notebook"]);
    expect(availableTutorAppActions({ context: sources, scope: {} })).toEqual(["open", "create_deck"]);
  });

  it("reads what the student asked for in so many words", () => {
    expect([...requestedTutorAppActions("can you add 10 pages to this notebook?")]).toEqual(["add_pages"]);
    expect([...requestedTutorAppActions("add another page")]).toEqual(["add_pages"]);
    expect([...requestedTutorAppActions("make me a new deck for organic chemistry")]).toEqual(["create_deck"]);
    expect([...requestedTutorAppActions("create a notebook called Mechanics")]).toEqual(["create_notebook"]);
    expect([...requestedTutorAppActions("what's on this page?")]).toEqual([]);
    expect([...requestedTutorAppActions("don't add pages, just explain")]).toEqual([]);
    expect(requestedPageCount("add ten more pages")).toBe(10);
    expect(requestedPageCount("could you add 50 pages")).toBe(20);
    expect(requestedPageCount("add a page")).toBe(1);
    expect(requestedPageCount("add pages")).toBeNull();
  });

  it("keeps only real, sensible actions, and runs only what was asked for", () => {
    const destinations = jamiDestinations(scope);
    const available = availableTutorAppActions({ context: notebook, scope });
    expect(
      readTutorAppActions(
        [
          { type: "add_pages", count: 3 },
          { type: "open", destination: "flashcards" },
          { type: "open", destination: "made_up" },
          { type: "delete_everything" },
          { type: "create_deck", name: "  " },
        ],
        { available, destinations, message: "add 10 pages please" }
      )
    ).toEqual([
      { type: "add_pages", count: 10, autoRun: true },
      { type: "open", destination: "flashcards", label: "Flashcards", href: "/dashboard/decks", autoRun: false },
    ]);

    // Suggested without being asked: offered as a button, never run.
    expect(
      readTutorAppActions([{ type: "create_deck", name: "Enzymes" }], {
        available,
        destinations,
        message: "explain enzymes to me",
      })
    ).toEqual([{ type: "create_deck", name: "Enzymes", autoRun: false }]);

    // Not offered here: dropped, even when asked.
    expect(
      readTutorAppActions([{ type: "add_pages", count: 2 }], {
        available: availableTutorAppActions({ context: sources, scope: {} }),
        destinations,
        message: "add 2 pages",
      })
    ).toEqual([]);
  });

  it("reads saved actions back without trusting them", () => {
    const destinations = jamiDestinations({ folderId: "bio" });
    expect(
      normalizeTutorAppActions(
        [
          { type: "open", destination: "this_folder", label: "This folder", href: "/dashboard/folders/bio", autoRun: true },
          { type: "open", destination: "x", label: "Evil", href: "javascript:alert(1)" },
          { type: "add_pages", count: 99, autoRun: true },
        ],
        destinations
      )
    ).toEqual([
      { type: "open", destination: "this_folder", label: "This folder", href: "/dashboard/folders/bio", autoRun: false },
      { type: "add_pages", count: 20, autoRun: true },
    ]);
    expect(normalizeJamiAppScope({ folderId: "bio", deckId: "../x", notebookId: 4 })).toEqual({ folderId: "bio" });
  });

  it("tells Tutor what it can do and where it can link, and nothing it cannot", () => {
    const inNotebook = buildTutorAppInstruction({
      destinations: jamiDestinations(scope),
      available: availableTutorAppActions({ context: notebook, scope }),
    });
    expect(inNotebook).toContain("HOW JAMI WORKS");
    expect(inNotebook).toContain("[words](jami:key)");
    expect(inNotebook).toContain("add_pages");
    expect(inNotebook).toContain("this_notebook (This notebook)");
    const inSources = buildTutorAppInstruction({
      destinations: jamiDestinations(),
      available: availableTutorAppActions({ context: sources, scope: {} }),
    });
    expect(inSources).not.toContain("add_pages:");
    expect(inSources).not.toContain("create_notebook:");
  });
});
