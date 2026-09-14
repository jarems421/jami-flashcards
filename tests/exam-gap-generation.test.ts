import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateAiText = vi.hoisted(() => vi.fn());
const saved = vi.hoisted(() => [] as unknown[]);

vi.mock("@/lib/ai/provider-router", () => ({ generateAiText }));
vi.mock("@/services/ai/practice-paper-generation.server", () => ({
  parseJsonObject: (text: string) => JSON.parse(text),
}));
vi.mock("@/services/practice/exam-evidence.server", () => ({
  examGeneratedQuestionRefs: () => {
    const collection = { doc: () => ({ set: async (value: unknown) => { saved.push(value); } }) };
    return { questions: collection, secrets: collection };
  },
}));

const { generateExamGapQuestions } = await import("@/services/practice/exam-gap-generation.server");

type Requested = { difficulty: string; marks: number };

/** What a well-behaved model returns for the sequence a call asked for. */
function answer(call: { request: { contents: Array<{ parts: Array<{ text: string }> }> } }) {
  const text = call.request.contents[0]!.parts[0]!.text;
  const requested = JSON.parse(text.match(/Requested sequence: (\[.*?\])\. Preferred/)![1]!) as Requested[];
  return JSON.stringify({
    questions: requested.map((item, index) => ({
      difficulty: item.difficulty,
      prompt: `Solve problem ${index + 1}.`,
      answer: "A complete worked answer.",
      points: Array.from({ length: item.marks }, (_unused, point) => `Mark point ${point + 1}`),
      topicIds: [],
    })),
  });
}

function generate(missing: Record<string, number>) {
  return generateExamGapQuestions({
    uid: "student-1",
    subject: "Maths",
    subjectKey: "maths",
    studyLevel: "gcse-equivalent",
    course: {
      board: "aqa", qualification: "gcse", specificationId: "8300",
      specificationTitle: "GCSE Mathematics", tier: "higher", componentIds: [],
    },
    missing,
    topicIds: [],
  } as Parameters<typeof generateExamGapQuestions>[0]);
}

/**
 * One call used to write the whole shortfall inside 45 seconds and 8,000
 * tokens. Ten questions measured 44.8 seconds, so batches failed on the edge
 * of the timeout and their retry was left five seconds -- and no Jami-created
 * question ever arrived.
 */
describe("writing Jami-created questions for a shortfall", () => {
  beforeEach(() => {
    generateAiText.mockReset();
    saved.length = 0;
  });

  it("splits the shortfall into batches of five sharing one deadline", async () => {
    generateAiText.mockImplementation(async (call) => answer(call));

    const questions = await generate({ easy: 6, medium: 4, hard: 2 });

    expect(questions).toHaveLength(12);
    const calls = generateAiText.mock.calls.map(([call]) => call);
    expect(calls.map((call) => (call.request.contents[0].parts[0].text as string).match(/exactly (\d+)/)![1]))
      .toEqual(["5", "5", "2"]);
    for (const call of calls) {
      expect(call.timeoutMs).toBe(120_000);
      expect(call.stallTimeoutMs).toBe(30_000);
      expect(call.generationConfig.maxOutputTokens).toBe(16_000);
      expect(call.deadlineAt).toBe(calls[0].deadlineAt);
    }
    // In request order, numbered across batches rather than restarting in each.
    expect(questions.map((question) => question.difficulty)).toEqual([
      "easy", "easy", "easy", "easy", "easy", "easy", "medium", "medium", "medium", "medium", "hard", "hard",
    ]);
    expect(new Set(questions.map((question) => question.provenance.questionNumber)).size).toBe(12);
    expect(saved).toHaveLength(24);
  });

  it("never has more than five calls in flight, even for a fifty-question shortfall", async () => {
    let inFlight = 0;
    let peak = 0;
    generateAiText.mockImplementation(async (call) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return answer(call);
    });

    const questions = await generate({ easy: 20, medium: 20, hard: 10 });

    expect(questions).toHaveLength(50);
    expect(generateAiText).toHaveBeenCalledTimes(10);
    expect(peak).toBe(5);
  });

  it("saves nothing when any batch comes back short", async () => {
    generateAiText
      .mockImplementationOnce(async (call) => answer(call))
      .mockImplementationOnce(async () => JSON.stringify({ questions: [] }));

    await expect(generate({ easy: 10 })).rejects.toThrow(/wrong number of questions/);
    expect(saved).toHaveLength(0);
  });
});
