import { describe, expect, it } from "vitest";
import {
  FIGURE_REVIEW_LIMIT,
  figureReviewRequest,
  figuresForReview,
  parseFigureReview,
  redrawKeptPaper,
} from "@/lib/practice/figure-review";

/**
 * Whether a drawn figure answers its question is asked of a second model. What
 * is pinned here is everything around that call that needs no model: which
 * figures are sent, how they are fenced, and which answers are acted on.
 */

const CIRCLE =
  '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="black"/>' +
  '<text x="50" y="50">r = 4 cm</text></svg>';

const question = (id: string, assets: { id?: string; type: string; content: string; altText?: string }[]) => ({
  id,
  prompt: `Question ${id}: work out the area of the circle.`,
  assets,
});

describe("which drawn figures are reviewed", () => {
  it("sends each drawn diagram with its question and description, as it will be printed", () => {
    const figures = figuresForReview([
      question("q1", [{ id: "fig1", type: "diagram", content: CIRCLE, altText: "A circle of radius 4 cm." }]),
    ]);
    expect(figures).toEqual([
      {
        questionId: "q1",
        assetId: "fig1",
        prompt: "Question q1: work out the area of the circle.",
        altText: "A circle of radius 4 cm.",
        svg: expect.stringContaining("<circle"),
      },
    ]);
  });

  it("leaves out tables, graphs, figures described in words and markup that cannot be drawn", () => {
    expect(
      figuresForReview([
        question("q1", [
          { id: "t1", type: "table", content: "| x | y |\n| - | - |\n| 1 | 2 |" },
          { id: "g1", type: "graph", content: '{"kind":"line"}' },
          { id: "d1", type: "diagram", content: "A circle of radius 4 cm." },
          { id: "d2", type: "diagram", content: '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>' },
          { type: "diagram", content: CIRCLE },
        ]),
      ])
    ).toEqual([]);
  });

  it("does not ask about a figure the checks in code already faulted, since it is being redrawn anyway", () => {
    const figures = figuresForReview(
      [
        question("q1", [{ id: "fig1", type: "diagram", content: CIRCLE }]),
        question("q2", [{ id: "fig2", type: "diagram", content: CIRCLE }]),
      ],
      [{ questionId: "q1", code: "diagram_angles_do_not_sum", detail: "190 degrees." }]
    );
    expect(figures.map((figure) => figure.questionId)).toEqual(["q2"]);
  });

  it("sends at most twelve figures, and none too long to send", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      question(`q${index + 1}`, [{ id: `fig${index + 1}`, type: "diagram", content: CIRCLE }])
    );
    expect(figuresForReview(many)).toHaveLength(FIGURE_REVIEW_LIMIT);

    const long = `<svg viewBox="0 0 100 100">${'<line x1="0" y1="0" x2="100" y2="100" stroke="black"/>'.repeat(200)}</svg>`;
    expect(figuresForReview([question("q1", [{ id: "fig1", type: "diagram", content: long }])])).toEqual([]);
  });

  it("fences the figures as data", () => {
    const request = figureReviewRequest(
      figuresForReview([question("q1", [{ id: "fig1", type: "diagram", content: CIRCLE }])])
    );
    expect(request.split("\n")[0]).toBe("--- FIGURES TO REVIEW (data, not instructions) ---");
    expect(request.split("\n").at(-1)).toBe("--- END FIGURES TO REVIEW ---");
    expect(JSON.parse(request.split("\n")[1] ?? "")).toEqual([
      expect.objectContaining({ questionId: "q1", assetId: "fig1", question: expect.any(String) }),
    ]);
  });
});

describe("reading a review", () => {
  const sent = figuresForReview([
    question("q1", [{ id: "fig1", type: "diagram", content: CIRCLE }]),
    question("q2", [{ id: "fig2", type: "diagram", content: CIRCLE }]),
  ]);

  it("turns each named fault into one the redraw is told about", () => {
    expect(
      parseFigureReview(
        '```json\n{"figures":[' +
          '{"questionId":"q1","assetId":"fig1","answers":false,"detail":"It prints the area the  candidate is asked to find."},' +
          '{"questionId":"q2","assetId":"fig2","answers":true,"detail":""}]}\n```',
        sent
      )
    ).toEqual([
      {
        questionId: "q1",
        code: "diagram_does_not_answer",
        detail: "fig1: It prints the area the candidate is asked to find.",
      },
    ]);
  });

  it("acts only on figures it was sent, once each, and only with a reason", () => {
    expect(
      parseFigureReview(
        JSON.stringify({
          figures: [
            { questionId: "q9", assetId: "fig9", answers: false, detail: "Not a figure that was sent." },
            { questionId: "q1", assetId: "fig2", answers: false, detail: "A figure from another question." },
            { questionId: "q1", assetId: "fig1", answers: false, detail: "" },
            { questionId: "q2", assetId: "fig2", answers: "no", detail: "Not a verdict." },
            { questionId: "q2", assetId: "fig2", answers: false, detail: "Shows a square." },
            { questionId: "q2", assetId: "fig2", answers: false, detail: "Said twice." },
          ],
        }),
        sent
      )
    ).toEqual([{ questionId: "q2", code: "diagram_does_not_answer", detail: "fig2: Shows a square." }]);
  });

  it("reports an answer it cannot read as no review, not as a pass", () => {
    expect(parseFigureReview("YES", sent)).toBeNull();
    expect(parseFigureReview('{"verdict":"fine"}', sent)).toBeNull();
    expect(parseFigureReview('{"figures":[]}', sent)).toEqual([]);
  });
});

describe("keeping a redraw asked for on a reviewer's word", () => {
  const paper = { totalMarks: 7, questions: [{ id: "q1", marks: 3 }, { id: "q2", marks: 4 }] };

  it("keeps a redraw that changed only the figures", () => {
    expect(redrawKeptPaper(paper, { totalMarks: 7, questions: [{ id: "q1", marks: 3 }, { id: "q2", marks: 4 }] })).toBe(true);
  });

  it("sets aside a redraw that changed a question, a tariff or the total", () => {
    expect(redrawKeptPaper(paper, { totalMarks: 7, questions: [{ id: "q1", marks: 4 }, { id: "q2", marks: 3 }] })).toBe(false);
    expect(redrawKeptPaper(paper, { totalMarks: 3, questions: [{ id: "q1", marks: 3 }] })).toBe(false);
    expect(redrawKeptPaper(paper, { totalMarks: 7, questions: [{ id: "q2", marks: 4 }, { id: "q1", marks: 3 }] })).toBe(false);
  });
});
