import { describe, expect, it } from "vitest";
import {
  countedDraftKey,
  presentationDraftKey,
  resolvePresentationId,
} from "@/lib/study/presentation-identity";

const base = { sessionId: "s-1", index: 0, cardId: "c-1", newId: () => "minted" };

describe("resolvePresentationId", () => {
  it("uses the pinned exercise's own id, which is already saved", () => {
    const result = resolvePresentationId({ ...base, pinnedId: "pinned", exerciseId: "exercise", stored: "stored" });
    expect(result).toEqual({ commitId: "pinned", persist: false });
  });

  it("falls back to the exercise's id when nothing is pinned", () => {
    const result = resolvePresentationId({ ...base, exerciseId: "exercise", stored: "stored" });
    expect(result).toEqual({ commitId: "exercise", persist: false });
  });

  it("resumes the stored id after a reload, so a half-finished save is not answered twice", () => {
    const result = resolvePresentationId({ ...base, stored: "stored" });
    expect(result).toEqual({ commitId: "stored", persist: false });
  });

  it("mints and asks to persist only when no id exists anywhere", () => {
    const result = resolvePresentationId({ ...base, stored: undefined });
    expect(result).toEqual({ commitId: "s-1:0:c-1:minted", persist: true });
  });

  it("ignores a gap map stored under the same key", () => {
    const result = resolvePresentationId({ ...base, stored: { "0": "answer" } });
    expect(result.commitId).toBe("s-1:0:c-1:minted");
    expect(result.persist).toBe(true);
  });

  it("ignores an empty stored string rather than committing under it", () => {
    expect(resolvePresentationId({ ...base, stored: "" }).persist).toBe(true);
  });

  it("mints a different id for each presentation of a repeated card", () => {
    let n = 0;
    const mint = () => `id-${(n += 1)}`;
    const first = resolvePresentationId({ ...base, stored: undefined, newId: mint });
    const second = resolvePresentationId({ ...base, stored: undefined, newId: mint });
    expect(first.commitId).not.toBe(second.commitId);
  });
});

describe("draft keys", () => {
  it("separates two presentations of one card in one session", () => {
    const first = presentationDraftKey({ sessionId: "s-1", index: 0, cardId: "c-1", presentation: 0 });
    const second = presentationDraftKey({ sessionId: "s-1", index: 0, cardId: "c-1", presentation: 1 });
    expect(first).not.toBe(second);
  });

  it("keys the counted flag off the commit id, not the slot", () => {
    expect(countedDraftKey("s-1:0:c-1:abc")).toBe("counted:s-1:0:c-1:abc");
  });
});
