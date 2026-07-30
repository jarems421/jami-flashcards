import { describe, expect, it } from "vitest";
import { resolveFirebaseEmulatorConfig } from "@/lib/firebase/emulator-config";

describe("Firebase emulator configuration", () => {
  it("stays disabled unless explicitly enabled", () => {
    expect(
      resolveFirebaseEmulatorConfig({
        enabled: undefined,
        projectId: "jami-production",
      })
    ).toEqual({ enabled: false });
  });

  it("uses fixed localhost ports for a demo project", () => {
    expect(
      resolveFirebaseEmulatorConfig({
        enabled: "true",
        projectId: "demo-jami-browser",
      })
    ).toEqual({
      enabled: true,
      host: "127.0.0.1",
      authPort: 9099,
      firestorePort: 8085,
      storagePort: 9199,
    });
  });

  it("rejects emulator mode for non-demo projects", () => {
    expect(() =>
      resolveFirebaseEmulatorConfig({
        enabled: "true",
        projectId: "jami-production",
      })
    ).toThrow("requires a demo-* project ID");
  });
});
