import { describe, expect, it } from "vitest";
import {
  copiedSpan,
  matchQuestionTypeRule,
  normalizeQuestionTypeRule,
  questionTypeRuleKey,
  ruleAsConvention,
  subjectKey,
  type QuestionTypeRule,
} from "@/lib/practice/question-types";

/**
 * Question-type rules are read from each board's own mark schemes and filed by
 * board, qualification and subject. These pin how a paper finds its rules, how
 * a question finds its rule, and that no rule can carry its source's wording.
 */

const rule = (patch: Partial<QuestionTypeRule>): QuestionTypeRule => ({
  id: "r",
  name: "Rule",
  tariffs: [4],
  commandWords: [],
  cues: [],
  marking: "levels",
  answerShape: "A developed answer.",
  examinerRules: ["Two levels."],
  pitfalls: [],
  sources: [],
  ...patch,
});

describe("filing rules by subject", () => {
  it("reads one subject out of however a paper names it", () => {
    expect(subjectKey("GCSE (9-1) Geography")).toBe("geography");
    expect(subjectKey("AQA GCSE Geography")).toBe("geography");
    expect(subjectKey("Combined Science: Trilogy")).toBe("combined-science-trilogy");
    expect(subjectKey("GCSE Physics Paper 1 (Higher)")).toBe("physics");
  });

  it("files a generated paper under its board, level and subject", () => {
    expect(questionTypeRuleKey({ awardingBodyOrInstitution: "AQA", qualificationOrModule: "GCSE History", studyLevel: "GCSE" })).toEqual({
      board: "aqa",
      qualification: "gcse",
      subject: "history",
    });
  });

  it("finds the subject of a Past Paper Practice paper, which names the qualification where the subject would be", () => {
    expect(
      questionTypeRuleKey({ awardingBodyOrInstitution: "AQA", qualificationOrModule: "GCSE", specificationOrCourse: "GCSE Geography", studyLevel: "GCSE" })
    ).toMatchObject({ subject: "geography" });
  });

  it("files nothing for a university paper or an unknown board", () => {
    expect(questionTypeRuleKey({ awardingBodyOrInstitution: "University of Loughborough", qualificationOrModule: "Economics" })).toBeNull();
  });
});

describe("keeping a rule", () => {
  it("drops a rule missing what a marker needs", () => {
    expect(normalizeQuestionTypeRule({ name: "No tariff", answerShape: "x", examinerRules: ["y"] }, [])).toBeNull();
    expect(normalizeQuestionTypeRule({ name: "No rules", tariffs: [6], answerShape: "x", examinerRules: [] }, [])).toBeNull();
  });

  it("matches an essay stored with its spelling marks added, without inventing tariffs", async () => {
    const { withoutAddedTariffs } = await import("@/lib/practice/question-types");
    const kept = normalizeQuestionTypeRule(
      { name: "Essay", tariffs: [16], answerShape: "An argued essay.", examinerRules: ["Four levels."], extraMarks: "Up to 4 additional marks for spelling" },
      []
    );
    expect(kept?.tariffs).toEqual([16]);
    expect(matchQuestionTypeRule([kept!], { prompt: "How far do you agree?", marks: 20 })?.name).toBe("Essay");
    // 18 and 24 with 5 for spelling on the 24 was once filed under 23 and 29 too: read back, those go, and nothing matches differently.
    const saved = rule({ tariffs: [18, 23, 24, 29], extraMarks: "SPaG: 5 marks" });
    expect(withoutAddedTariffs(saved).tariffs).toEqual([18, 24]);
    for (const marks of [18, 23, 24, 29]) {
      expect(matchQuestionTypeRule([withoutAddedTariffs(saved)], { marks })).not.toBeNull();
    }
  });

  it("refuses a rule that copies twelve words of its source", () => {
    const source = "Level 3 answers show detailed and thorough understanding of the processes and reach a well supported conclusion about the issue";
    const copied = rule({ examinerRules: ["Top answers show detailed and thorough understanding of the processes and reach a well supported conclusion"] });
    const paraphrased = rule({ examinerRules: ["The top level needs a detailed grasp of how the processes work and a conclusion the argument supports."] });
    expect(copiedSpan(copied, source)).not.toBeNull();
    expect(copiedSpan(paraphrased, source)).toBeNull();
  });
});

describe("finding a question's rule", () => {
  const rules = [
    rule({ id: "explain", name: "Explain (4)", tariffs: [4], commandWords: ["Explain"] }),
    rule({ id: "describe", name: "Describe two (4)", tariffs: [4], commandWords: ["Describe"], cues: ["Describe two"] }),
    rule({ id: "essay", name: "Essay (9)", tariffs: [9, 12], commandWords: ["Evaluate"] }),
  ];

  it("chooses by what the question asks when several rules share its tariff", () => {
    expect(matchQuestionTypeRule(rules, { prompt: "Describe two problems faced by the settlers.", marks: 4 })?.id).toBe("describe");
    expect(matchQuestionTypeRule(rules, { prompt: "Explain why the river floods.", marks: 4 })?.id).toBe("explain");
  });

  it("takes the only rule for a tariff, and nothing for a tariff no rule covers", () => {
    expect(matchQuestionTypeRule(rules, { prompt: "To what extent do you agree?", marks: 12 })?.id).toBe("essay");
    expect(matchQuestionTypeRule(rules, { prompt: "Name the gas.", marks: 1 })).toBeNull();
  });

  it("does not guess between rules when the question names none of their words", () => {
    expect(matchQuestionTypeRule(rules, { prompt: "Complete the table.", marks: 4 })).toBeNull();
  });

  it("reads as a convention the marker already knows how to print", () => {
    const convention = ruleAsConvention(rule({ name: "Essay (16)", extraMarks: "+4 SPaG" }));
    expect(convention.title).toBe("Essay (16) (+4 SPaG)");
    expect(convention.pitfalls.length).toBeGreaterThan(0);
  });
});

describe("reading an extraction's reply", () => {
  it("takes the rules however the reply wraps them", async () => {
    const { parseRulesReply } = await import("@/services/ai/question-type-research.server");
    expect(parseRulesReply('{"rules":[{"id":"a"}]}')?.rules).toHaveLength(1);
    expect(parseRulesReply('[{"id":"a"},{"id":"b"}]')?.rules).toHaveLength(2);
    expect(parseRulesReply('```json\n[{"id":"a"}]\n```')?.rules).toHaveLength(1);
    expect(parseRulesReply('Here are the rules: {"rules":[{"id":"a"}]} Hope that helps.')?.rules).toHaveLength(1);
    expect(parseRulesReply("not json at all")).toBeNull();
  });
});

describe("one rule per kind of question", () => {
  it("merges the same kind described by two sources, keeping both sets of sources", async () => {
    const { dedupeQuestionTypeRules } = await import("@/lib/practice/question-types");
    const merged = dedupeQuestionTypeRules([
      rule({ id: "a", name: "Language analysis, 8 marks", tariffs: [8], sources: [{ title: "corpus" }] }),
      rule({ id: "b", name: "Paper 1 Question 2: Language Analysis (8 marks)", tariffs: [8], examinerRules: ["One.", "Two."], sources: [{ title: "website" }] }),
      rule({ id: "c", name: "Structure analysis, 8 marks", tariffs: [8] }),
      rule({ id: "d", name: "Extended evaluation, method design or explanation (6 marks)", tariffs: [6] }),
      rule({ id: "e", name: "Practical method design (6 marks)", tariffs: [6] }),
    ]);
    expect(merged.map((item) => item.id)).toEqual(["a", "c", "d", "e"]);
    expect(merged[0].examinerRules).toEqual(["One.", "Two."]);
    expect(merged[0].sources.map((source) => source.title)).toEqual(["corpus", "website"]);
  });
});

describe("reading a rule's tariffs", () => {
  it("takes tariffs however the reply writes them", async () => {
    const { readTariffs, missingRuleFields } = await import("@/lib/practice/question-types");
    expect(readTariffs([6])).toEqual([6]);
    expect(readTariffs(6)).toEqual([6]);
    expect(readTariffs("2-4")).toEqual([2, 3, 4]);
    expect(readTariffs(["1", "2 to 3 marks"])).toEqual([1, 2, 3]);
    expect(readTariffs("none")).toEqual([]);
    expect(missingRuleFields({ name: "Essay", tariffs: "12", answerShape: "An essay." })).toEqual(["examiner rules"]);
  });
});

describe("finding a subject's rules under a shorter name", () => {
  it("tries the subject as the paper names it, then each shorter form", async () => {
    const { subjectFallbacks } = await import("@/lib/practice/question-types");
    expect(subjectFallbacks(subjectKey("Biology B (Twenty First Century Science)"))).toContain("biology-b");
    expect(subjectFallbacks("geography-a-geographical-themes")[0]).toBe("geography-a-geographical-themes");
    expect(subjectFallbacks("history")).toEqual(["history"]);
  });
});

describe("reading one Pearson paper of each kind", () => {
  it("groups tiers and options under their paper, and keeps separate papers apart", async () => {
    const { pearsonPaperFamily } = await import("@/services/ai/question-type-research.server");
    expect(["1F", "1H", "01"].map(pearsonPaperFamily)).toEqual(["1", "1", "1"]);
    expect(["10", "12", "30"].map(pearsonPaperFamily)).toEqual(["1", "1", "3"]);
    expect(["P1", "P4", "B2"].map(pearsonPaperFamily)).toEqual(["P", "P", "B"]);
    expect(["1BF", "1CH", "2PF"].map(pearsonPaperFamily)).toEqual(["1B", "1C", "2P"]);
  });
});

describe("reading one OCR component of each kind", () => {
  it("reads one version of a paper with many options, and spreads across the rest", async () => {
    const { spreadAcrossKinds } = await import("@/services/ai/question-type-research.server");
    const names = [
      "International relations 1918-c.1975 with China 1950-1981",
      "International relations 1918-c.1975 with Germany 1925-1955",
      "International relations 1918-c.1975 with the USA 1919-1948",
      "Migrants to Britain c.1250 to present",
      "Power: monarchy and democracy in Britain",
      "War and British society c.790 to present",
      "The Norman conquest 1065-1087",
      "The English reformation 1520-1550",
    ].map((name) => ({ name }));
    const picked = spreadAcrossKinds(names, 5).map((item) => item.name);
    expect(picked).toHaveLength(5);
    expect(picked.filter((name) => name.startsWith("International"))).toHaveLength(1);
    expect(picked.at(-1)).toBe("The English reformation 1520-1550");
    expect(spreadAcrossKinds([{ name: "Paper 1" }, { name: "Paper 2" }], 5)).toHaveLength(2);
  });
});

describe("weighing a question's wording", () => {
  it("lets a long phrase outweigh a stray command word and a one-word cue", () => {
    // Pearson GCSE History, as researched: the essay and the two-option importance question both carry 16.
    const rules = [
      rule({ id: "importance", tariffs: [8, 16], commandWords: ["Explain"], cues: ["Explain two of the following", "The importance of", "for"] }),
      rule({ id: "essay", tariffs: [16, 20], commandWords: ["How far do you agree"], cues: ["How far do you agree? Explain your answer"], extraMarks: "4 marks for SPaG" }),
    ];
    const prompt = "'The main reason for the growth of towns was trade.' How far do you agree? Explain your answer.";
    expect(matchQuestionTypeRule(rules, { prompt, marks: 16 })?.id).toBe("essay");
    expect(matchQuestionTypeRule(rules, { prompt: "Explain two of the following: the importance of the railways for trade.", marks: 16 })?.id).toBe("importance");
  });

  it("prefers the rule written for this tariff over a broader one that also claims it", () => {
    // AQA GCSE English Language, as researched: a 12-mark question must get the 12-mark bands.
    const rules = [
      rule({ id: "language-8-12", tariffs: [8, 12], commandWords: ["How does the writer use language"], cues: ["words and phrases", "language features and techniques", "sentence forms"] }),
      rule({ id: "language-12", tariffs: [12], commandWords: ["How does the writer use language"], cues: ["words and phrases", "refer only to Source A"] }),
    ];
    const prompt = "You now need to refer only to Source A. How does the writer use language to describe the orchard? You could include words and phrases, language features and techniques, sentence forms.";
    expect(matchQuestionTypeRule(rules, { prompt, marks: 12 })?.id).toBe("language-12");
  });

  it("does not read a split inside the tariff as marks on top of it", async () => {
    const { extraMarksOf } = await import("@/lib/practice/question-types");
    expect(extraMarksOf({ extraMarks: "4 marks of the total 20 are for technical accuracy" })).toBe(0);
    expect(extraMarksOf({ extraMarks: "Up to 4 additional marks for SPaG" })).toBe(4);
  });

  it("chooses nothing when equally supported rules would mark differently", () => {
    const levels = rule({ id: "levels", commandWords: ["Explain"], marking: "levels" });
    const points = rule({ id: "points", commandWords: ["Explain"], marking: "points" });
    const alsoLevels = rule({ id: "also-levels", commandWords: ["Explain"], marking: "levels" });
    expect(matchQuestionTypeRule([levels, points], { prompt: "Explain why the river floods.", marks: 4 })).toBeNull();
    expect(matchQuestionTypeRule([levels, alsoLevels], { prompt: "Explain why the river floods.", marks: 4 })?.id).toBe("levels");
  });
});

describe("matching a question's wording", () => {
  it("matches a cue whatever the printed punctuation", () => {
    const rules = [
      rule({ id: "tick", tariffs: [1], cues: ["Tick one box"], marking: "points" }),
      rule({ id: "recall", tariffs: [1], commandWords: ["Name"], marking: "points" }),
    ];
    expect(matchQuestionTypeRule(rules, { prompt: "Which organ produces insulin? Tick (✓) one box.", marks: 1 })?.id).toBe("tick");
    expect(matchQuestionTypeRule(rules, { prompt: "Name the gas produced.", marks: 1 })?.id).toBe("recall");
  });
});
