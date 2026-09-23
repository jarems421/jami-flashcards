import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { PracticePaperQuestion } from "@/lib/practice/practice-papers";
import { renderPracticePaperPdf, type PracticePaperPdfInput } from "@/services/practice/practice-paper-pdf.server";

async function pdfText(bytes: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    wasmUrl: `${join(process.cwd(), "node_modules", "pdfjs-dist", "wasm")}/`,
  });
  const document = await task.promise;
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const content = await (await document.getPage(number)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  await task.destroy();
  return pages;
}

const question = (id: string, label: string, prompt: string, marks: number, extra: Partial<PracticePaperQuestion> = {}): PracticePaperQuestion => ({
  id,
  label,
  prompt,
  marks,
  assets: [],
  ...extra,
});

const paper: PracticePaperPdfInput = {
  title: "Physics Paper 1 practice",
  instructions: ["Answer all questions.", "Use black ink or black ball-point pen."],
  durationMinutes: 105,
  totalMarks: 36,
  choiceGroups: [],
  assessmentProfile: {
    studyLevel: "GCSE",
    qualificationOrModule: "GCSE Physics",
    awardingBodyOrInstitution: "AQA",
    specificationOrCourse: "GCSE Physics (8463)",
    tierOrComponent: "Paper 1 Higher",
    formatSummary: "",
    confidence: "high",
  },
  companionDocuments: [
    { id: "equations", role: "formula_sheet", title: "Physics equations sheet", pages: [{ id: "p1", content: "Kinetic energy $E_k = \\tfrac{1}{2} m v^2$" }] },
  ],
  questions: [
    question("q1", "Question 1", "A ball of mass 0.5 kg moves at 4 m/s.\n\nCalculate the kinetic energy of the ball using $E_k = \\tfrac{1}{2} m v^2$.", 3, { section: "A" }),
    question("q2", "Question 2", "The table shows the results.", 2, {
      section: "A",
      assets: [
        { id: "t1", type: "table", title: "Table 1", content: "| Mass (kg) | Weight (N) |\n|---|---|\n| 2 | 19.6 |\n| 3 | 29.4 |", altText: "Table" },
        { id: "g1", type: "graph", title: "Figure 1", content: "0,0\n1,2\n2,4", altText: "Graph" },
      ],
    }),
    question("q3", "Question 3", "Describe what the diagram shows.", 1, {
      section: "B",
      assets: [
        { id: "d1", type: "diagram", title: "Figure 2", content: '<svg viewBox="0 0 100 50"><rect x="5" y="5" width="90" height="40" fill="none" stroke="black"/></svg>', altText: "A box" },
        { id: "i1", type: "image", title: "Figure 3", content: "", altText: "A photo", storagePath: "users/u/generatedPaperAssets/p/q3-i1.png", width: 40, height: 30 },
      ],
    }),
    question("q4", "Question 4", "Evaluate the use of nuclear power compared with wind power. You should use your knowledge and understanding throughout.", 30, { section: "B" }),
  ],
};

describe("renderPracticePaperPdf", () => {
  it("typesets a booklet and records which questions are on each page", async () => {
    const image = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#cccccc" } }).png().toBuffer();
    const requested: string[] = [];
    const rendered = await renderPracticePaperPdf(paper, {
      loadImage: async (path) => {
        requested.push(path);
        return image;
      },
    });

    expect(rendered.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(requested).toEqual(["users/u/generatedPaperAssets/p/q3-i1.png"]);
    expect(rendered.pages).toHaveLength(rendered.pageCount);
    // The cover belongs to no question.
    expect(rendered.pages[0].questionIds).toEqual([]);
    for (const id of ["q1", "q2", "q3", "q4"]) {
      expect(rendered.pages.some((page) => page.questionIds.includes(id))).toBe(true);
    }
    // A thirty-mark evaluation's answer space carries on over more than one page.
    expect(rendered.pages.filter((page) => page.questionIds.includes("q4")).length).toBeGreaterThan(1);

    const text = await pdfText(rendered.bytes);
    expect(text).toHaveLength(rendered.pageCount);
    expect(text[0]).toContain("The maximum mark for this paper is 36.");
    expect(text[0]).toContain("not an official examination paper");
    const body = text.join(" ");
    expect(body).toContain("[3 marks]");
    expect(body).toContain("[1 mark]");
    expect(body).toContain("Section A");
    expect(body).toContain("Weight (N)");
    expect(body).toContain("END OF QUESTIONS");
    expect(text[text.length - 1]).toContain("Physics equations sheet");
  }, 60_000);

  /**
   * A generated paper should look like the paper the student will sit, so the
   * booklet takes its board's conventions: where the marks go, what the margins
   * say, how a question's parts are numbered.
   */
  const board = (awardingBodyOrInstitution: string, questions: PracticePaperQuestion[], qualificationOrModule = "GCSE Chemistry"): PracticePaperPdfInput => ({
    ...paper,
    companionDocuments: [],
    totalMarks: questions.reduce((sum, item) => sum + item.marks, 0),
    assessmentProfile: { ...paper.assessmentProfile, awardingBodyOrInstitution, qualificationOrModule },
    questions,
  });

  it("sets an AQA paper with its candidate boxes, examiner's grid and boxed margin", async () => {
    const text = await pdfText((await renderPracticePaperPdf(board("AQA", [question("a", "01.1", "Name the gas.", 1), question("b", "01.2", "Explain why.", 2)]))).bytes);
    expect(text[0]).toContain("Candidate number");
    expect(text[0]).toContain("For Examiner's Use");
    expect(text[0]).toContain("not an official examination paper");
    expect(text[1]).toContain("Do not write outside the box");
    expect(text[1]).toContain("[2 marks]");
  }, 60_000);

  it("sets a Pearson paper with bracketed marks and each question's total after its last part", async () => {
    const rendered = await renderPracticePaperPdf(board("Pearson Edexcel", [
      question("a", "1(a)", "Describe the arrangement of particles in a liquid.", 2),
      question("b", "1(b)", "Explain why the dyes separate.", 3),
      question("c", "2", "State one use of copper.", 1),
    ]));
    const text = await pdfText(rendered.bytes);
    const body = text.slice(1).join(" ");
    expect(body).toContain("(2)");
    expect(body).toContain("(Total for Question 1 = 5 marks)");
    expect(body).toContain("(Total for Question 2 = 1 mark)");
    expect(body).toContain("DO NOT WRITE IN THIS AREA");
    expect(body).toContain("TOTAL FOR PAPER IS 6 MARKS");
    // A later part prints its own letter, not the question number again.
    expect(body).not.toContain("1 (b)");
  }, 60_000);

  it("ends an OCR answer line with its marks, and turns over on every page but the last", async () => {
    const rendered = await renderPracticePaperPdf(board("OCR", [
      question("a", "1", "Explain why the reaction is exothermic.", 2),
      question("b", "2", "Evaluate the use of recycled aluminium.", 30),
    ]));
    const text = await pdfText(rendered.bytes);
    expect(text.slice(1).join(" ")).toContain("[2]");
    expect(text.slice(0, -1).every((page) => page.includes("Turn over"))).toBe(true);
    expect(text[text.length - 1]).not.toContain("Turn over");
    expect(text[text.length - 1]).toContain("END OF QUESTION PAPER");
  }, 60_000);

  it("puts an SQA paper's marks in its marks column", async () => {
    const text = await pdfText((await renderPracticePaperPdf(board("SQA", [question("a", "1", "Evaluate the usefulness of Source A.", 6)], "Higher History"))).bytes);
    expect(text[0]).toContain("Scottish candidate number");
    expect(text[1]).toContain("MARKS");
    expect(text[1]).toContain("1.");
    expect(text[1]).toContain("DO NOT WRITE IN THIS MARGIN");
  }, 60_000);
});
