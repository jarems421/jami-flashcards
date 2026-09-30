import { describe, expect, it } from "vitest";
import {
  readPhotoRestoreSize,
  restoreInputSize,
  restoreModelScale,
  RESTORE_MAX_INPUT_PIXELS,
} from "@/lib/app/photo-background-restore";
import { isSoftPhotoBackground } from "@/lib/app/photo-background";

describe("restoring a background photo", () => {
  it("sends a small photo at its own size and shrinks a large one to what the model takes", () => {
    expect(restoreInputSize(736, 736)).toEqual({ width: 736, height: 736 });
    const large = restoreInputSize(3840, 2160);
    expect(large.width * large.height).toBeLessThanOrEqual(RESTORE_MAX_INPUT_PIXELS);
    expect(large.width / large.height).toBeCloseTo(3840 / 2160, 2);
  });

  it("asks the model for whole steps of at least the stretch needed", () => {
    expect(restoreModelScale({ width: 736, height: 736, targetWidth: 2880, targetHeight: 2880 })).toBe(4);
    expect(restoreModelScale({ width: 2000, height: 1500, targetWidth: 2560, targetHeight: 1920 })).toBe(2);
  });

  it("accepts the restore the page asks for and refuses anything else", () => {
    expect(
      readPhotoRestoreSize({ width: "736", height: "736", targetWidth: "2880", targetHeight: "2880" })
    ).toEqual({ width: 736, height: 736, targetWidth: 2880, targetHeight: 2880 });
    // Missing or not whole numbers.
    expect(readPhotoRestoreSize({ width: "736", height: "736", targetWidth: "2880" })).toBeNull();
    expect(readPhotoRestoreSize({ width: "73.5", height: "736", targetWidth: "2880", targetHeight: "2880" })).toBeNull();
    // Shrunk, stretched past what the model does, reshaped, or too big to send or store.
    expect(readPhotoRestoreSize({ width: 2000, height: 2000, targetWidth: 1000, targetHeight: 1000 })).toBeNull();
    expect(readPhotoRestoreSize({ width: 500, height: 500, targetWidth: 2880, targetHeight: 2880 })).toBeNull();
    expect(readPhotoRestoreSize({ width: 1000, height: 1000, targetWidth: 3000, targetHeight: 2000 })).toBeNull();
    expect(readPhotoRestoreSize({ width: 3000, height: 3000, targetWidth: 4000, targetHeight: 4000 })).toBeNull();
    expect(readPhotoRestoreSize({ width: 1600, height: 1600, targetWidth: 6400, targetHeight: 6400 })).toBeNull();
  });

  it("does not ask for a restored photo again", () => {
    expect(isSoftPhotoBackground("users/a/appBackgrounds/f1/background-restored.webp")).toBe(false);
  });
});
