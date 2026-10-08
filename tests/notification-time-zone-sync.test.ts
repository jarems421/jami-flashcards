// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const firestore = vi.hoisted(() => ({ updateDoc: vi.fn<(ref: unknown, data: unknown) => Promise<void>>() }));
vi.mock("firebase/firestore", () => ({
  deleteDoc: vi.fn(),
  doc: (...path: unknown[]) => path.slice(1).join("/"),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: firestore.updateDoc,
}));
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({ withTimeout: <T,>(promise: Promise<T>) => promise }));

const { syncNotificationTimeZone } = await import("@/services/notifications");
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

beforeEach(() => {
  firestore.updateDoc.mockReset();
  firestore.updateDoc.mockResolvedValue(undefined);
  window.localStorage.clear();
});

describe("syncNotificationTimeZone", () => {
  it("records this device's zone on the student's preferences, once", async () => {
    await syncNotificationTimeZone("student");
    await syncNotificationTimeZone("student");

    expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
    expect(firestore.updateDoc).toHaveBeenCalledWith("users/student/notificationPreferences/config", { timeZone: zone });
  });

  it("tries again next time when there were no preferences to update", async () => {
    firestore.updateDoc.mockRejectedValueOnce(new Error("No document to update"));
    await syncNotificationTimeZone("student");
    await syncNotificationTimeZone("student");

    expect(firestore.updateDoc).toHaveBeenCalledTimes(2);
  });
});
