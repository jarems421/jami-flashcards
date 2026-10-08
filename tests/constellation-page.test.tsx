// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConstellationDashboardPage from "@/app/dashboard/constellation/page";
import type { Constellation } from "@/lib/constellation/constellations";
import type { NormalizedStar } from "@/lib/constellation/stars";
import {
  CONSTELLATION_BACKGROUND_CONSTELLATION_ID_STORAGE_KEY,
  CONSTELLATION_BACKGROUND_STORAGE_KEY,
} from "@/lib/constellation/background";

/**
 * The Stars page, driven the way a student uses it: which sky opens, opening a
 * past one, renaming, joining two stars, nudging one, clearing lines, starting
 * and finishing a sky, and making a sky the background.
 */

const UID = "user-1";

const services = vi.hoisted(() => ({
  ensureConstellationSetup: vi.fn(),
  createConstellation: vi.fn(),
  finishConstellation: vi.fn(),
  renameConstellation: vi.fn(),
  saveConstellationLines: vi.fn(),
  getStars: vi.fn(),
  backfillStarPositions: vi.fn(),
  saveStarPosition: vi.fn(),
  getGoals: vi.fn(),
  saveSkyBackgroundChoice: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dashboard/constellation",
}));
vi.mock("@/components/providers/UserProvider", () => ({
  useUser: () => ({ user: { uid: UID } }),
}));
vi.mock("@/services/constellation/constellations", () => ({
  ensureConstellationSetup: services.ensureConstellationSetup,
  createConstellation: services.createConstellation,
  finishConstellation: services.finishConstellation,
  renameConstellation: services.renameConstellation,
  saveConstellationLines: services.saveConstellationLines,
}));
vi.mock("@/services/constellation/stars", () => ({
  getStars: services.getStars,
  backfillStarPositions: services.backfillStarPositions,
  saveStarPosition: services.saveStarPosition,
}));
vi.mock("@/services/study/goals", () => ({ getGoals: services.getGoals }));
vi.mock("@/services/profile/appearance", () => ({
  saveSkyBackgroundChoice: services.saveSkyBackgroundChoice,
  updateAppearance: vi.fn(),
}));
vi.mock("@/services/constellation/sky-pattern", () => ({
  requestSkyPattern: vi.fn(),
  saveSkyArrangement: vi.fn(),
}));

function sky(overrides: Partial<Constellation> & Pick<Constellation, "id" | "name">): Constellation {
  return {
    status: "active",
    maxStars: 40,
    starCount: 2,
    lines: [],
    createdAt: 1,
    ...overrides,
  };
}

function star(id: string, constellationId: string, x: number, y: number): NormalizedStar {
  return {
    id,
    goalId: `goal-${id}`,
    constellationId,
    size: 30,
    glow: 0.5,
    position: { x, y },
    createdAt: 1,
    needsBackfill: false,
  };
}

let skies: Constellation[];
let container: HTMLDivElement;
let root: Root;

async function settle() {
  for (let pass = 0; pass < 4; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderPage() {
  await act(async () => {
    root.render(<ConstellationDashboardPage />);
  });
  await settle();
}

function buttonByText(text: string) {
  return [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text
  );
}

function starButton(id: string) {
  return container.querySelector<HTMLButtonElement>(`button[data-star-id="${id}"]`);
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

async function press(element: Element | null | undefined, key: string) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  await settle();
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  skies = [
    sky({ id: "orion", name: "Orion" }),
    sky({ id: "lyra", name: "Lyra", status: "finished", starCount: 40, finishedAt: 2 }),
  ];
  for (const mock of Object.values(services)) mock.mockReset();
  services.ensureConstellationSetup.mockImplementation(async () => skies);
  services.getStars.mockResolvedValue([
    star("s1", "orion", 20, 30),
    star("s2", "orion", 60, 70),
    star("s3", "lyra", 50, 50),
  ]);
  services.getGoals.mockResolvedValue([]);
  services.saveConstellationLines.mockResolvedValue(undefined);
  services.saveStarPosition.mockResolvedValue(undefined);
  services.saveSkyBackgroundChoice.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("the Stars page", () => {
  it("opens on the sky collecting stars, with its stars and how full it is", async () => {
    await renderPage();

    expect(container.textContent).toContain("Orion");
    expect(container.textContent).toContain("Collecting stars now");
    expect(container.textContent).toContain("5% filled");
    expect(starButton("s1")).not.toBeNull();
    expect(starButton("s2")).not.toBeNull();
    expect(starButton("s3")).toBeNull();
    expect(container.textContent).toContain("Past skies");
  });

  it("opens a past sky in place", async () => {
    await renderPage();
    await click(buttonByText("Open"));

    expect(container.textContent).toContain("Finished - kept as a record");
    expect(starButton("s3")).not.toBeNull();
    expect(starButton("s1")).toBeNull();
    expect(buttonByText("Viewing")?.disabled).toBe(true);
  });

  it("renames a sky from its title", async () => {
    services.renameConstellation.mockResolvedValue("Orion's Belt");
    await renderPage();
    await click(container.querySelector("button .sr-only")?.closest("button"));

    const input = document.activeElement as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("Orion");
    await type(input, "  Orion's Belt ");
    await press(input, "Enter");

    expect(services.renameConstellation).toHaveBeenCalledWith(UID, "orion", "Orion's Belt");
    expect(buttonByText("Save")).toBeUndefined();
    expect(container.textContent).toContain("Orion's Belt");
  });

  it("joins two stars by choosing one and then the other", async () => {
    await renderPage();
    await click(buttonByText("Connect"));
    await press(starButton("s1"), "Enter");
    expect(container.textContent).toContain("Now choose another star to join it to.");

    await press(starButton("s2"), "Enter");

    expect(services.saveConstellationLines).toHaveBeenCalledTimes(1);
    const [uid, constellationId, lines] = services.saveConstellationLines.mock.calls[0];
    expect([uid, constellationId]).toEqual([UID, "orion"]);
    expect(lines).toHaveLength(1);
    expect([lines[0].a, lines[0].b].sort()).toEqual(["s1", "s2"]);
  });

  it("lets go of a chosen star when the sky leaves Connect mode", async () => {
    await renderPage();
    await click(buttonByText("Connect"));
    await press(starButton("s1"), "Enter");
    await click(buttonByText("Move"));
    await click(buttonByText("Connect"));

    expect(container.textContent).not.toContain("Now choose another star");
    expect(starButton("s1")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("nudges a star with the arrow keys and saves where it lands", async () => {
    await renderPage();
    await press(starButton("s1"), "ArrowRight");

    expect(services.saveStarPosition).toHaveBeenCalledWith(UID, "s1", { x: 21, y: 30 });
    expect(starButton("s1")?.style.left).toBe("21%");
  });

  it("clears every line only after asking", async () => {
    skies[0] = sky({ id: "orion", name: "Orion", lines: [{ a: "s1", b: "s2" }] });
    await renderPage();
    await click(buttonByText("Connect"));
    await click(document.querySelector('[aria-label="Clear all lines"]'));

    expect(document.body.textContent).toContain("Clear all lines?");
    expect(services.saveConstellationLines).not.toHaveBeenCalled();
    await click(buttonByText("Clear lines"));

    expect(services.saveConstellationLines).toHaveBeenCalledWith(UID, "orion", []);
  });

  it("offers a new sky once every sky is finished, and makes it", async () => {
    skies = [sky({ id: "lyra", name: "Lyra", status: "finished", starCount: 40 })];
    services.createConstellation.mockImplementation(async (_uid: string, name: string) => {
      skies = [...skies, sky({ id: "cygnus", name, starCount: 0 })];
    });
    await renderPage();

    expect(container.textContent).toContain("Start your next sky");
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Sky name"]')!;
    await type(input, " Cygnus ");
    await click(buttonByText("Create sky"));

    expect(services.createConstellation).toHaveBeenCalledWith(UID, "Cygnus");
    expect(container.textContent).toContain("Created constellation Cygnus.");
    expect(container.textContent).not.toContain("Start your next sky");
  });

  it("finishes the active sky once it is full", async () => {
    skies[0] = sky({ id: "orion", name: "Orion", starCount: 40 });
    services.finishConstellation.mockResolvedValue(undefined);
    await renderPage();

    expect(container.textContent).toContain("This sky is full");
    await click(buttonByText("Finish this sky"));

    expect(services.finishConstellation).toHaveBeenCalledWith(UID, "orion");
    expect(container.textContent).toContain("Orion is now finished.");
  });

  it("does not offer to finish a full sky that is already finished", async () => {
    await renderPage();
    await click(buttonByText("Open"));

    expect(container.textContent).not.toContain("This sky is full");
  });

  it("makes the open sky the background", async () => {
    await renderPage();
    await click(buttonByText("Use as background"));

    expect(services.saveSkyBackgroundChoice).toHaveBeenCalledWith(UID, true, "orion");
  });

  it("shows the open sky as the background when it is one, and takes it off", async () => {
    window.localStorage.setItem(CONSTELLATION_BACKGROUND_STORAGE_KEY, "true");
    window.localStorage.setItem(CONSTELLATION_BACKGROUND_CONSTELLATION_ID_STORAGE_KEY, "orion");
    await renderPage();

    const toggle = buttonByText("Remove background");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    await click(toggle);

    expect(services.saveSkyBackgroundChoice).toHaveBeenCalledWith(UID, false);
  });
});
