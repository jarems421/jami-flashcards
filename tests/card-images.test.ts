import { describe, expect, it } from "vitest";
import {
  getCardImageFileError,
  isUnchangedCardImageDraft,
  normalizeCardImage,
  type CardImage,
} from "@/lib/study/card-images";
import {
  getCardDuplicateKey,
  getCardContentKey,
  getCardFacesError,
  mapCardData,
  type Card,
} from "@/lib/study/cards";
import {
  getClassicEligibility,
  getGapFillEligibility,
  getMultipleChoiceEligibility,
  getTypeAnswerEligibility,
  needsStudyAssetPreparation,
  scoreModesForCard,
} from "@/lib/study/mode-eligibility";
import { canRestoreStudyExercise } from "@/lib/study/restored-exercise";
import { getCardContentHash } from "@/lib/study/study-modes";

const IMAGE: CardImage = {
  storagePath: "users/user-1/cardImages/file-1/heart.png",
  width: 800,
  height: 600,
};

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    deckId: "deck-1",
    userId: "user-1",
    front: "What does the left ventricle pump blood into?",
    back: "The aorta, which carries oxygenated blood to the body",
    createdAt: 1,
    tags: [],
    ...overrides,
  };
}

describe("card image files", () => {
  it("accepts JPEG, PNG and WebP up to 10 MB", () => {
    expect(getCardImageFileError({ type: "image/png", size: 1_000 })).toBeNull();
    expect(getCardImageFileError({ type: "image/webp", size: 10 * 1024 * 1024 })).toBeNull();
    expect(getCardImageFileError({ type: "image/gif", size: 1_000 })).toMatch(/JPEG, PNG or WebP/);
    expect(getCardImageFileError({ type: "image/jpeg", size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
    expect(getCardImageFileError({ type: "image/jpeg", size: 0 })).toMatch(/empty/);
  });
});

describe("reading a stored card image", () => {
  it("keeps an image in the owner's own folder", () => {
    expect(normalizeCardImage(IMAGE, "user-1")).toEqual(IMAGE);
    expect(mapCardData("card-1", { userId: "user-1", front: "", back: "Aorta", frontImage: IMAGE }))
      .toMatchObject({ frontImage: IMAGE });
  });

  it("ignores a path anywhere else, so it is never shown or deleted", () => {
    expect(normalizeCardImage({ ...IMAGE, storagePath: "users/user-2/cardImages/f/x.png" }, "user-1")).toBeUndefined();
    expect(normalizeCardImage({ ...IMAGE, storagePath: "users/user-1/cardImages/../sourceFiles/x.pdf" }, "user-1")).toBeUndefined();
    expect(normalizeCardImage("users/user-1/cardImages/f/x.png", "user-1")).toBeUndefined();
    expect(mapCardData("card-1", { userId: "user-1", front: "Q", back: "A" })).not.toHaveProperty("frontImage");
  });

  it("tells a draft that still holds the saved image from one that changed", () => {
    expect(isUnchangedCardImageDraft(undefined, undefined)).toBe(true);
    expect(isUnchangedCardImageDraft({ kind: "saved", image: IMAGE }, IMAGE)).toBe(true);
    expect(isUnchangedCardImageDraft(undefined, IMAGE)).toBe(false);
    expect(
      isUnchangedCardImageDraft(
        { kind: "new", file: new File(["x"], "x.png", { type: "image/png" }), previewUrl: "blob:x" },
        IMAGE
      )
    ).toBe(false);
  });
});

describe("what a card needs on each side", () => {
  it("takes text, an image, or both", () => {
    expect(getCardFacesError({ front: "", back: "Aorta", hasFrontImage: true })).toBeNull();
    expect(getCardFacesError({ front: "Label this", back: "", hasBackImage: true })).toBeNull();
    expect(getCardFacesError({ front: "", back: "Aorta" })).toBe("Both front and back are required.");
    expect(getCardFacesError({ front: "Q", back: "", hasFrontImage: true })).toBe(
      "Both front and back are required."
    );
  });

  it("does not call every image-only card a duplicate of the others", () => {
    const first = card({ front: "", back: "", frontImage: IMAGE, backImage: { ...IMAGE, storagePath: "users/user-1/cardImages/a/a.png" } });
    const second = card({ front: "", back: "", frontImage: { ...IMAGE, storagePath: "users/user-1/cardImages/b/b.png" }, backImage: IMAGE });
    expect(getCardDuplicateKey(first)).not.toBe(getCardDuplicateKey(second));
    // A text-only card keys exactly as it did before images existed.
    expect(getCardDuplicateKey(card())).toBe(getCardContentKey(card().front, card().back));
  });
});

describe("a card's content fingerprint", () => {
  it("is unchanged for a card without images, so nothing prepared or saved is lost", () => {
    const plain = card();
    expect(getCardContentHash(plain)).toBe(getCardContentHash({ front: plain.front, back: plain.back }));
  });

  it("moves when an image is added, and tells the two sides apart", () => {
    const plain = card();
    expect(getCardContentHash({ ...plain, frontImage: IMAGE })).not.toBe(getCardContentHash(plain));
    expect(getCardContentHash({ ...plain, backImage: IMAGE })).not.toBe(
      getCardContentHash({ ...plain, frontImage: IMAGE })
    );
  });
});

describe("studying a card whose answer is a picture", () => {
  const pictureAnswer = card({ back: "The labelled heart", backImage: IMAGE });

  it("flips it, including when a side is only an image", () => {
    expect(getClassicEligibility(card({ front: "", frontImage: IMAGE }))).toEqual({ eligible: true });
    expect(getClassicEligibility(card({ back: "", backImage: IMAGE }))).toEqual({ eligible: true });
    expect(getClassicEligibility(card({ front: "" }))).toEqual({ eligible: false, reason: "empty-card" });
  });

  it("never types, gaps or chooses it, because the answer cannot be written", () => {
    for (const eligibility of [
      getTypeAnswerEligibility(pictureAnswer),
      getGapFillEligibility(pictureAnswer),
      getMultipleChoiceEligibility(pictureAnswer),
    ]) {
      expect(eligibility).toEqual({ eligible: false, reason: "image-answer" });
    }
    expect(scoreModesForCard(pictureAnswer).map((entry) => entry.mode)).toEqual(["classic"]);
  });

  it("does not resume a question saved before the answer became a picture", () => {
    expect(
      canRestoreStudyExercise({ cardId: "card-1", mode: "type-answer", contentHash: "saved" }, pictureAnswer)
    ).toBe(false);
  });
});

describe("studying a card whose question is a picture", () => {
  const flag = card({ front: "", frontImage: IMAGE, back: "France", fsrsState: 2 });

  it("can be typed, and is marked against the written answer", () => {
    expect(getTypeAnswerEligibility(flag)).toEqual({ eligible: true });
  });

  it("is typed by Smart Mix when the answer suits typing", () => {
    const scored = scoreModesForCard(flag);
    expect(scored.map((entry) => entry.mode)).toEqual(["classic", "type-answer"]);
    const score = (mode: string) => scored.find((entry) => entry.mode === mode)?.score ?? -Infinity;
    expect(score("type-answer")).toBeGreaterThan(score("classic"));
  });

  it("does not wait for preparation that will never come", () => {
    const explained = card({
      front: "",
      frontImage: IMAGE,
      back: "It pumps oxygenated blood around the body",
    });
    expect(getGapFillEligibility(explained)).toEqual({ eligible: false, reason: "image-prompt" });
    expect(getMultipleChoiceEligibility(explained)).toEqual({ eligible: false, reason: "image-prompt" });
    expect(needsStudyAssetPreparation(explained, { kind: "smart" })).toBe(false);
  });

  it("gaps it on the gaps the student chose", () => {
    const pinned = card({
      front: "",
      frontImage: IMAGE,
      back: "Paris is the capital of France",
      studySettings: { pinnedGaps: ["capital"] },
    });
    expect(getGapFillEligibility(pinned)).toEqual({ eligible: true });
  });
});
