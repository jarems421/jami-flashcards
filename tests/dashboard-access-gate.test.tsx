// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardAccessGate from "@/components/layout/DashboardAccessGate";

type AuthCallback = (user: { uid: string } | null) => void;

let authCallback: AuthCallback | null = null;
let listenThrows = false;
const unsubscribe = vi.fn();
const replace = vi.fn();

vi.mock("@/services/auth/auth-listener", () => ({
  listenToAuth: (callback: AuthCallback) => {
    if (listenThrows) throw new Error("auth unavailable");
    authCallback = callback;
    return unsubscribe;
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  // The gate notes where the student is, so a relaunch can return them there.
  usePathname: () => "/dashboard/decks",
}));

// The authenticated tree pulls in the whole dashboard chrome; this suite is
// about the gate in front of it.
vi.mock("@/components/layout/TabBar", () => ({ default: () => null }));
vi.mock("@/components/layout/InAppNotice", () => ({ default: () => null }));
vi.mock("@/components/topics/TopicMigrationGate", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/providers/UserProvider", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root.render(
      <DashboardAccessGate>
        <div data-protected>Dashboard content</div>
      </DashboardAccessGate>
    );
  });
}

const protectedContent = () => container.querySelector("[data-protected]");
const spinner = () => container.querySelector(".animate-spin");

beforeEach(() => {
  authCallback = null;
  listenThrows = false;
  unsubscribe.mockClear();
  replace.mockClear();
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

describe("DashboardAccessGate", () => {
  it("shows nothing protected until auth has answered", () => {
    render();
    // The dangerous frame: content on screen before the user is known.
    expect(protectedContent()).toBeNull();
    expect(spinner()).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("renders the dashboard once a user arrives", () => {
    render();
    act(() => {
      authCallback?.({ uid: "user-1" });
    });
    expect(protectedContent()).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor away rather than rendering", () => {
    render();
    act(() => {
      authCallback?.(null);
    });
    expect(protectedContent()).toBeNull();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("does not redirect while auth is still undecided", () => {
    render();
    // `checked` gates the redirect; without it a slow auth check would bounce
    // a signed-in user to the landing page on every load.
    expect(replace).not.toHaveBeenCalled();
  });

  it("treats a broken auth listener as signed out", async () => {
    listenThrows = true;
    render();
    await act(async () => {
      await Promise.resolve();
    });
    expect(protectedContent()).toBeNull();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("stops listening when it unmounts", () => {
    render();
    act(() => {
      authCallback?.({ uid: "user-1" });
    });
    act(() => {
      root.unmount();
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    // Remount so the shared teardown has a root to unmount.
    root = createRoot(container);
  });

  it("ignores an auth answer that lands after unmount", () => {
    render();
    const callback = authCallback;
    act(() => {
      root.unmount();
    });
    replace.mockClear();

    act(() => {
      callback?.(null);
    });
    // A late callback must not redirect a page the user has already left.
    expect(replace).not.toHaveBeenCalled();

    root = createRoot(container);
  });
});
