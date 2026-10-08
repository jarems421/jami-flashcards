import { describe, expect, it } from "vitest";
import {
  applyStudySettingsDraft,
  normalizeCardStudySettings,
  studySettingsChange,
  studySettingsDraftFrom,
} from "@/lib/study/card-study-settings";
import { mapCardData, type Card } from "@/lib/study/cards";
import { pinAuthorGaps, selectClozeGaps } from "@/lib/study/gap-fill";
import { describeAuthorMultipleChoice } from "@/lib/study/mcq";
import { getModeEligibility } from "@/lib/study/mode-eligibility";
import { getCardContentHash } from "@/lib/study/study-modes";

/**
 * A card's own study settings: other answers that count, wrong answers for
 * multiple choice, words to blank, ways not to ask it.
 *
 * Learn has honoured these for a long time and nothing wrote them. Now the card
 * editor does, so what is pinned here is that they are read the same way
 * everywhere -- the server and the browser fingerprint a card from them, and a
 * disagreement would leave its prepared questions refused as stale forever --
 * and that the editor says truthfully what Learn will make of them.
 */

const card = (studySettings?: Card["studySettings"], extra: Partial<Card> = {}): Card => ({
  id: "card-1",
  deckId: "deck-1",
  userId: "user-1",
  front: "What carries oxygen in the blood?",
  back: "Haemoglobin",
  tags: [],
  createdAt: 1,
  ...(studySettings ? { studySettings } : {}),
  ...extra,
});

describe("reading a card's own settings", () => {
  it("keeps one fixed order, so the server and Learn fingerprint a card alike", () => {
    const stored = {
      mcqDistractors: ["Plasma", "Platelets", "Fibrinogen"],
      disabledModes: ["gap-fill", "type-answer"],
      acceptedAnswers: ["Hemoglobin"],
    };
    const reordered = {
      acceptedAnswers: ["Hemoglobin"],
      disabledModes: ["type-answer", "gap-fill"],
      mcqDistractors: ["Plasma", "Platelets", "Fibrinogen"],
    };
    const browser = mapCardData("card-1", { ...card(), studySettings: stored });
    const server = { ...card(), studySettings: normalizeCardStudySettings(reordered) };
    expect(getCardContentHash(browser)).toBe(getCardContentHash(server));
    expect(Object.keys(browser.studySettings ?? {})).toEqual(["acceptedAnswers", "disabledModes", "mcqDistractors"]);
    // Read twice, it is the same thing.
    expect(normalizeCardStudySettings(browser.studySettings)).toEqual(browser.studySettings);
  });

  it("keeps only what an author sets: no prepared material, no strangers, nothing malformed", () => {
    expect(
      normalizeCardStudySettings({
        acceptedAnswers: ["  Hemoglobin ", "hemoglobin", "", 7, "x".repeat(400)],
        disabledModes: ["multiple-choice", "flying"],
        numericTolerance: -1,
        requireUnits: "yes",
        listOrder: "any",
        mcqExplanations: { Plasma: "  The liquid part.  ", Empty: "" },
        generatedStudy: { bundleVersion: 1, sourceHash: "x", gapVariants: [], mcqVariants: [] },
        somethingElse: true,
      })
    ).toEqual({
      acceptedAnswers: ["Hemoglobin", "x".repeat(160)],
      listOrder: "any",
      disabledModes: ["multiple-choice"],
      mcqExplanations: { Plasma: "The liquid part." },
    });
    expect(normalizeCardStudySettings({})).toBeUndefined();
    expect(normalizeCardStudySettings(["acceptedAnswers"])).toBeUndefined();
    expect(mapCardData("card-1", { ...card(), studySettings: "nonsense" })).not.toHaveProperty("studySettings");
  });

  it("keeps an empty list as stored, since it means the author turned that way off", () => {
    const settings = normalizeCardStudySettings({ pinnedGaps: [], mcqDistractors: [] });
    expect(settings).toEqual({ pinnedGaps: [], mcqDistractors: [] });
    expect(getModeEligibility(card(settings, { back: "Haemoglobin carries oxygen in red cells" }), "gap-fill")).toEqual({
      eligible: false,
      reason: "disabled-by-author",
    });
  });
});

describe("the editor's draft", () => {
  const saved = {
    acceptedAnswers: ["Hemoglobin"],
    requireUnits: true,
    disabledModes: ["classic" as const, "gap-fill" as const],
    mcqDistractors: ["Plasma", "Platelets", "Fibrinogen"],
    mcqExplanations: { Plasma: "The liquid part.", Fibrinogen: "Clotting." },
  };

  it("shows the four things it edits, and saves them over what it does not show", () => {
    const draft = studySettingsDraftFrom(saved);
    expect(draft).toEqual({
      acceptedAnswers: ["Hemoglobin"],
      wrongAnswers: ["Plasma", "Platelets", "Fibrinogen"],
      pinnedGaps: [],
      disabledModes: ["gap-fill"],
    });
    expect(
      applyStudySettingsDraft(saved, { ...draft, wrongAnswers: ["Plasma", "Platelets", "Myoglobin"], disabledModes: [] })
    ).toEqual({
      acceptedAnswers: ["Hemoglobin"],
      requireUnits: true,
      // Turning a way back on leaves the one the editor does not offer.
      disabledModes: ["classic"],
      mcqDistractors: ["Plasma", "Platelets", "Myoglobin"],
      // Why a wrong answer is wrong goes with the wrong answer.
      mcqExplanations: { Plasma: "The liquid part." },
    });
  });

  it("leaves an emptied list off rather than saving it empty", () => {
    expect(
      applyStudySettingsDraft({ mcqDistractors: ["Plasma"] }, { acceptedAnswers: [], wrongAnswers: [], pinnedGaps: [], disabledModes: [] })
    ).toBeUndefined();
  });

  it("writes nothing when the student left the section as it was", () => {
    expect(studySettingsChange(saved, studySettingsDraftFrom(saved))).toBeNull();
    expect(studySettingsChange(undefined, studySettingsDraftFrom(undefined))).toBeNull();
    expect(studySettingsChange(saved, { ...studySettingsDraftFrom(saved), acceptedAnswers: [] })).toEqual({
      next: expect.not.objectContaining({ acceptedAnswers: expect.anything() }),
    });
  });
});

describe("what Learn will make of an author's wrong answers", () => {
  const wrong = (mcqDistractors: string[], extra: Partial<Card> = {}) =>
    describeAuthorMultipleChoice(card({ mcqDistractors }, extra));

  it("asks with three believable wrong answers of the student's own", () => {
    expect(wrong(["Myoglobin", "Albumin", "Fibrinogen"])).toEqual({ kind: "ready" });
  });

  it("needs three, and does not count the answer said another way", () => {
    expect(wrong(["Myoglobin"])).toEqual({ kind: "needs-more", usable: 1, needed: 3 });
    expect(
      describeAuthorMultipleChoice(
        card({ mcqDistractors: ["Hemoglobin", "Myoglobin", "Albumin"], acceptedAnswers: ["Hemoglobin"] })
      )
    ).toEqual({ kind: "needs-more", usable: 2, needed: 3 });
  });

  it("says when the answer would stand out, or is too long to be an option", () => {
    expect(
      wrong([
        "A protein found in muscle tissue that stores oxygen for later use",
        "The liquid part of blood that carries dissolved nutrients around",
        "A protein that helps blood clot after an injury to a vessel wall",
      ])
    ).toEqual({ kind: "answer-stands-out" });
    expect(wrong(["A", "B", "C"], { back: "x ".repeat(100) })).toEqual({ kind: "answer-too-long" });
    expect(wrong([])).toEqual({ kind: "none" });
  });
});

describe("what Learn will make of an author's words to blank", () => {
  const back = "Haemoglobin in red blood cells carries oxygen from the lungs to every tissue";

  it("blanks the words as written, and says which it could not find", () => {
    const result = pinAuthorGaps(back, ["oxygen", "Oxygen carriers"]);
    expect(result.gaps.map((gap) => gap.answer)).toEqual(["oxygen"]);
    expect(result.missing).toEqual(["Oxygen carriers"]);
    expect(result.problem).toBeNull();
    // Learn asks exactly what the editor previewed.
    expect(selectClozeGaps({ front: "", back, settings: { pinnedGaps: ["oxygen", "Oxygen carriers"] } })).toEqual(result.gaps);
  });

  it("says why words give no gap at all", () => {
    expect(pinAuthorGaps(back, ["nitrogen"]).problem).toEqual({ kind: "not-in-answer" });
    // Up to twelve words has room for one blank; this answer has thirteen, so two.
    expect(pinAuthorGaps(back, ["Haemoglobin", "oxygen"]).problem).toBeNull();
    expect(pinAuthorGaps("Haemoglobin carries oxygen in the blood", ["Haemoglobin", "oxygen"]).problem).toEqual({
      kind: "too-many",
      allowed: 1,
    });
    expect(pinAuthorGaps(back, ["Haemoglobin in red blood cells carries"]).problem).toEqual({ kind: "too-much-hidden" });
    expect(pinAuthorGaps("Haemoglobin", ["Haemoglobin"]).problem).toEqual({ kind: "answer-too-short" });
  });
});
