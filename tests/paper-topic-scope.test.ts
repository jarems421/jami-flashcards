import { describe, expect, it } from "vitest";
import {
  appendToPracticePaperRequest,
  parsePracticePaperGenerationRequest,
} from "@/lib/ai/practice-paper-generation";
import { servableExamSpecificationTopics } from "@/lib/practice/exam-specification-topics";
import { describePaperTopicScope, readPaperTopicScope } from "@/lib/practice/paper-topic-scope";

const course = {
  board: "aqa",
  qualification: "gcse",
  specificationId: "8300",
  specificationTitle: "GCSE Mathematics (8300)",
  tier: "Higher",
  componentIds: ["8300/1H", "8300/2H", "8300/3H"],
};
const QUADRATICS = "aqa-8300-algebra-quadratic-equations";
const allTopics = servableExamSpecificationTopics("8300")!.topics.map((topic) => topic.id);

const base = {
  folderId: "folder-1",
  request: "",
  coverage: "",
  length: "full",
  focus: "balanced",
  focusDetail: "",
  timingMode: "untimed",
  tutorEnabled: false,
  sourceIds: [],
};

describe("a paper's course, paper and topics", () => {
  it("keeps only the course's own topic and concept ids", () => {
    const scope = readPaperTopicScope({
      course,
      paper: { code: "8300/1H", title: "Paper 1 Higher" },
      topicIds: ["aqa-8300-probability", "aqa-8300-vibes"],
      conceptIds: [QUADRATICS, "made-up"],
    });
    expect(scope?.topicIds).toEqual(["aqa-8300-probability"]);
    expect(scope?.conceptIds).toEqual([QUADRATICS]);
    expect(scope?.paper).toEqual({ code: "8300/1H", title: "Paper 1 Higher" });
  });

  it("refuses a course that is not a real board and qualification", () => {
    expect(readPaperTopicScope({ course: { ...course, board: "nope" } })).toBeNull();
  });

  it("says nothing extra for the whole course, and names what is in and out otherwise", () => {
    expect(describePaperTopicScope({ course: readPaperTopicScope({ course })!.course, topicIds: allTopics, conceptIds: [] })).toBeNull();
    const text = describePaperTopicScope({
      course: readPaperTopicScope({ course })!.course,
      topicIds: ["aqa-8300-probability"],
      conceptIds: [QUADRATICS],
    });
    expect(text).toMatch(/^Cover only these parts of the course: .*Probability/);
    expect(text).toMatch(/only: .*[Qq]uadratic/);
    expect(text).toMatch(/Leave out entirely/);
  });
});

describe("a paper request built from a picked course", () => {
  it("writes the request from the course, and reads the same after being stored", () => {
    const parsed = parsePracticePaperGenerationRequest({
      ...base,
      note: "Harder algebra, please.",
      scope: { course, paper: { code: "8300/1H", title: "Paper 1 Higher" }, topicIds: allTopics, conceptIds: [] },
    });
    expect(parsed?.request).toBe(
      "A complete AQA GCSE Mathematics (8300), Higher tier, Paper 1 Higher paper in the current format. Student's note: Harder algebra, please."
    );
    expect(parsed?.coverage).toBe("The whole paper, across the course.");
    // Stored and read back on every step: it must not grow.
    expect(parsePracticePaperGenerationRequest(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("keeps a clarification when the request is rebuilt from the course", () => {
    const parsed = parsePracticePaperGenerationRequest({ ...base, scope: { course, topicIds: allTopics, conceptIds: [] } })!;
    const clarified = appendToPracticePaperRequest(parsed, "\n\nStudent clarified: calculator paper");
    expect(parsePracticePaperGenerationRequest(clarified)?.request).toContain("calculator paper");
  });

  it("still needs a description when no course was picked", () => {
    expect(parsePracticePaperGenerationRequest(base)).toBeNull();
  });
});
