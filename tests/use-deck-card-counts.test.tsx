// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckCardCount } from "@/lib/study/deck-counts";
import type { DeckCardCountRequest } from "@/hooks/useDeckCardCounts";

const service = vi.hoisted(() => ({
  getDeckCardCount: vi.fn<(userId: string, deckId: string, options: { force?: boolean }) => Promise<DeckCardCount>>(),
}));
vi.mock("@/services/study/deck-counts", () => service);

const { useDeckCardCounts } = await import("@/hooks/useDeckCardCounts");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ request }: { request: DeckCardCountRequest | null }) {
  return <output>{JSON.stringify(useDeckCardCounts("student", request))}</output>;
}

let container: HTMLDivElement;
let root: Root;

function seen(): Record<string, DeckCardCount | null> {
  return JSON.parse(container.querySelector("output")?.textContent || "{}");
}

async function render(request: DeckCardCountRequest | null) {
  await act(async () => {
    root.render(<Probe request={request} />);
  });
  // Past the hook's short gathering window, so everything that arrived is shown.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

beforeEach(() => {
  service.getDeckCardCount.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useDeckCardCounts", () => {
  it("counts nothing until the decks are known", async () => {
    await render(null);
    expect(service.getDeckCardCount).not.toHaveBeenCalled();
    expect(seen()).toEqual({});
  });

  it("fills in each deck's count, and marks one that could not be counted", async () => {
    service.getDeckCardCount.mockImplementation(async (_userId, deckId) => {
      if (deckId === "broken") throw new Error("timed out");
      return { total: deckId.length, due: 1 };
    });
    await render({ deckIds: ["first", "second", "broken"], force: false });

    expect(seen()).toEqual({
      first: { total: 5, due: 1 },
      second: { total: 6, due: 1 },
      broken: null,
    });
    expect(service.getDeckCardCount).toHaveBeenCalledWith("student", "first", { force: false });
  });

  it("keeps a count on screen when its recount fails", async () => {
    service.getDeckCardCount.mockResolvedValue({ total: 10, due: 2 });
    await render({ deckIds: ["deck"], force: false });
    expect(seen().deck).toEqual({ total: 10, due: 2 });

    service.getDeckCardCount.mockRejectedValue(new Error("offline"));
    await render({ deckIds: ["deck"], force: true });
    expect(seen().deck).toEqual({ total: 10, due: 2 });
    expect(service.getDeckCardCount).toHaveBeenLastCalledWith("student", "deck", { force: true });
  });
});
