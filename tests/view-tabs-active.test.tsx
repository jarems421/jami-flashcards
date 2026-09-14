// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ViewTabs from "@/components/ui/ViewTabs";
import { FLASHCARD_VIEWS } from "@/lib/app/flashcard-views";
import { PROGRESS_VIEWS } from "@/lib/app/progress-views";

const pathname = vi.hoisted(() => ({ current: "/dashboard/progress" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function currentTabs(items: typeof PROGRESS_VIEWS, at: string) {
  pathname.current = at;
  await act(async () => {
    root.render(<ViewTabs items={items} label="Views" />);
  });
  return Array.from(container.querySelectorAll('a[aria-current="page"]')).map((link) => link.textContent);
}

describe("which view tab is current", () => {
  it("marks only Practice under Progress's own address, not Cards as well", async () => {
    expect(await currentTabs(PROGRESS_VIEWS, "/dashboard/progress/practice")).toEqual(["Practice"]);
  });

  it("marks Cards on Progress itself", async () => {
    expect(await currentTabs(PROGRESS_VIEWS, "/dashboard/progress")).toEqual(["Cards"]);
  });

  it("still matches a page nested under a view that has no nested sibling", async () => {
    // A deck's own page sits under Decks, and Decks stays lit there.
    expect(await currentTabs(FLASHCARD_VIEWS, "/dashboard/decks/deck-1")).toEqual(["Decks"]);
  });
});
