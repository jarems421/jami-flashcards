// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePhotoEditor from "@/components/profile/ProfilePhotoEditor";

const getProfilePhotoData = vi.fn();
const saveProfilePhotoData = vi.fn();
const uploadProfilePhoto = vi.fn();

vi.mock("@/services/profile/photo", () => ({
  getProfilePhotoData: (...a: unknown[]) => getProfilePhotoData(...a),
  saveProfilePhotoData: (...a: unknown[]) => saveProfilePhotoData(...a),
  uploadProfilePhoto: (...a: unknown[]) => uploadProfilePhoto(...a),
}));

let container: HTMLDivElement;
let root: Root;

async function render(fallbackPhotoURL: string | null = null) {
  await act(async () => {
    root.render(
      <ProfilePhotoEditor
        userId="user-1"
        displayName="Jamie"
        fallbackPhotoURL={fallbackPhotoURL}
      />
    );
  });
}

function button(text: string) {
  return [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text)
  );
}

function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  const target = container.querySelector<HTMLElement>("[class*='rounded-full']");
  if (!target) throw new Error("no drag surface");
  target.setPointerCapture = vi.fn();
  act(() => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: from.x,
        clientY: from.y,
      })
    );
  });
  act(() => {
    target.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: to.x,
        clientY: to.y,
      })
    );
  });
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
}

beforeEach(() => {
  getProfilePhotoData.mockReset().mockResolvedValue(null);
  saveProfilePhotoData.mockReset().mockResolvedValue(undefined);
  uploadProfilePhoto.mockReset().mockResolvedValue("https://cdn/photo.png");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("ProfilePhotoEditor", () => {
  it("falls back to an initial when there is no photo", async () => {
    await render();
    expect(container.textContent).toContain("J");
  });

  it("restores a saved photo and its position", async () => {
    getProfilePhotoData.mockResolvedValue({
      url: "https://cdn/saved.png",
      offsetX: 30,
      offsetY: -20,
    });
    await render();
    expect(container.innerHTML).toContain("https://cdn/saved.png");
    // The saved crop must come back, not reset to centre.
    expect(container.innerHTML).toContain("30");
  });

  it("uploads a chosen file and saves a centred position", async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    expect(input).not.toBeNull();

    const file = new File(["x"], "avatar.png", { type: "image/png" });
    Object.defineProperty(input!, "files", { value: [file] });
    await act(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(uploadProfilePhoto).toHaveBeenCalledWith("user-1", file);
    // A fresh upload is centred and persisted without a second click.
    expect(saveProfilePhotoData).toHaveBeenCalledWith("user-1", {
      url: "https://cdn/photo.png",
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("only accepts image types the uploader supports", async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    expect(input?.getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
  });

  it("surfaces an upload failure instead of looking successful", async () => {
    uploadProfilePhoto.mockRejectedValue(new Error("File too large."));
    await render();
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    const file = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(input!, "files", { value: [file] });
    await act(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("File too large.");
  });

  it("moves the crop when the photo is dragged", async () => {
    await render("https://cdn/existing.png");
    const before = container.innerHTML;
    drag({ x: 100, y: 100 }, { x: 140, y: 100 });
    expect(container.innerHTML).not.toBe(before);
  });

  it("does not start a drag when there is no photo to move", async () => {
    await render(null);
    const before = container.innerHTML;
    drag({ x: 100, y: 100 }, { x: 160, y: 160 });
    expect(container.innerHTML).toBe(before);
  });

  it("clamps the crop so the photo cannot be dragged off the circle", async () => {
    await render("https://cdn/existing.png");
    // Far beyond the circle: the offset is capped at 100 rather than running away.
    drag({ x: 0, y: 0 }, { x: 5000, y: 5000 });
    expect(container.innerHTML).not.toContain("5000");
    expect(container.innerHTML).toMatch(/100%/);
  });

  it("offers no save until the crop has actually moved", async () => {
    getProfilePhotoData.mockResolvedValue({
      url: "https://cdn/saved.png",
      offsetX: 0,
      offsetY: 0,
    });
    await render();
    expect(button("Save position")).toBeUndefined();

    drag({ x: 100, y: 100 }, { x: 120, y: 100 });
    expect(button("Save position")).toBeDefined();
  });

  it("persists the position when the student saves it", async () => {
    getProfilePhotoData.mockResolvedValue({
      url: "https://cdn/saved.png",
      offsetX: 0,
      offsetY: 0,
    });
    await render();
    drag({ x: 100, y: 100 }, { x: 120, y: 100 });

    await act(async () => {
      button("Save position")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    const [, saved] = saveProfilePhotoData.mock.calls.at(-1) ?? [];
    expect(saved.url).toBe("https://cdn/saved.png");
    expect(saved.offsetX).not.toBe(0);
  });

  it("reports a failed save rather than pretending it worked", async () => {
    getProfilePhotoData.mockResolvedValue({
      url: "https://cdn/saved.png",
      offsetX: 0,
      offsetY: 0,
    });
    saveProfilePhotoData.mockRejectedValue(new Error("Network down."));
    await render();
    drag({ x: 100, y: 100 }, { x: 120, y: 100 });

    await act(async () => {
      button("Save position")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(container.textContent).toContain("Network down.");
  });

  it("lets a fallback avatar be dragged but never saved", async () => {
    // Dragging is gated on `currentUrl`, which includes the provider avatar,
    // while the save button is gated on `hasCustomPhoto`, which does not. A
    // student signed in with a Google photo can reposition it and is never
    // offered a way to keep the change.
    await render("https://cdn/provider-avatar.png");
    const before = container.innerHTML;
    drag({ x: 100, y: 100 }, { x: 140, y: 100 });
    expect(container.innerHTML).not.toBe(before);
    expect(button("Save position")).toBeUndefined();
  });
});
