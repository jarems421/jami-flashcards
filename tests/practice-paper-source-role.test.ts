import { describe, expect, it } from "vitest";
import { practicePaperSourceRole } from "@/lib/ai/practice-paper-generation";

describe("sorting a folder's material for a paper", () => {
  it("tells past papers, mark schemes and notes apart", () => {
    expect(practicePaperSourceRole({ title: "MA2031 Exam 2023" })).toBe("paper");
    expect(practicePaperSourceRole({ title: "Past paper: MA2031 2022" })).toBe("paper");
    expect(practicePaperSourceRole({ title: "2023 Mark Scheme" })).toBe("scheme");
    expect(practicePaperSourceRole({ title: "Solutions to 2022", fileName: "sol.pdf" })).toBe("scheme");
    expect(practicePaperSourceRole({ title: "Lecture 4 — Compactness", fileName: "lec4.pdf" })).toBe("notes");
  });
});

describe("fitting material to what one paper can read", () => {
  it("keeps past papers and schemes first, then notes in order, and reports the rest", async () => {
    const { fitPracticePaperMaterial } = await import("@/lib/ai/practice-paper-generation");
    const items = [
      { title: "Lecture 1", size: 40 },
      { title: "2023 Exam", size: 50 },
      { title: "Lecture 2", size: 40 },
      { title: "2023 Mark Scheme", size: 20 },
    ];
    const { kept, dropped } = fitPracticePaperMaterial(items, (item) => item.size, 110);
    expect(kept.map((item) => item.title)).toEqual(["2023 Exam", "2023 Mark Scheme", "Lecture 1"]);
    expect(dropped.map((item) => item.title)).toEqual(["Lecture 2"]);
  });
});
