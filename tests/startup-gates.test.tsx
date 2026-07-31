// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PwaBootstrap from "@/components/layout/PwaBootstrap";
import TopicMigrationGate from "@/components/topics/TopicMigrationGate";

const ensureServiceWorkerRegistration = vi.fn();
const migrateCardTagsToTopics = vi.fn();

vi.mock("@/services/notifications", () => ({
  ensureServiceWorkerRegistration: () => ensureServiceWorkerRegistration(),
}));

vi.mock("@/services/study/topics", () => ({
  migrateCardTagsToTopics: (...args: unknown[]) =>
    migrateCardTagsToTopics(...args),
}));

vi.mock("@/components/providers/UserProvider", () => ({
  useUser: () => ({ user: { uid: "user-1" } }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  ensureServiceWorkerRegistration.mockReset().mockResolvedValue(undefined);
  migrateCardTagsToTopics.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllEnvs();
});

describe("PwaBootstrap", () => {
  it("registers the service worker in a normal browser", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_EMULATORS", "");
    await act(async () => {
      root.render(<PwaBootstrap />);
    });
    expect(ensureServiceWorkerRegistration).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way under the emulators", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_EMULATORS", "true");
    await act(async () => {
      root.render(<PwaBootstrap />);
    });
    // A service worker caching emulator responses made the browser suite
    // compile-stampede, so this carve-out is load-bearing.
    expect(ensureServiceWorkerRegistration).not.toHaveBeenCalled();
  });

  it("does not take the app down when registration fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_EMULATORS", "");
    ensureServiceWorkerRegistration.mockRejectedValue(new Error("blocked"));
    await act(async () => {
      root.render(<PwaBootstrap />);
      await Promise.resolve();
    });
    expect(ensureServiceWorkerRegistration).toHaveBeenCalledTimes(1);
  });
});

describe("TopicMigrationGate", () => {
  function renderGate() {
    return act(async () => {
      root.render(
        <TopicMigrationGate>
          <div data-migrated>Topics</div>
        </TopicMigrationGate>
      );
    });
  }

  const content = () => container.querySelector("[data-migrated]");

  it("holds the UI back until the migration settles", async () => {
    let release: () => void = () => undefined;
    migrateCardTagsToTopics.mockImplementation(
      () => new Promise<void>((resolve) => {
        release = resolve;
      })
    );

    await renderGate();
    expect(content()).toBeNull();
    expect(
      container.querySelector('[aria-label="Preparing Topics"]')
    ).not.toBeNull();

    await act(async () => {
      release();
    });
    expect(content()).not.toBeNull();
  });

  it("lets the app through even when the migration fails", async () => {
    migrateCardTagsToTopics.mockRejectedValue(new Error("migration failed"));
    await renderGate();
    // Blocking forever on a failed migration would lock the student out of
    // their own material.
    expect(content()).not.toBeNull();
  });

  it("runs the migration for the signed-in user", async () => {
    await renderGate();
    expect(migrateCardTagsToTopics).toHaveBeenCalledWith("user-1");
  });
});
