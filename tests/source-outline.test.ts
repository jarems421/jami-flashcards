import { describe, expect, it } from "vitest";
import { chunkSourcePages } from "@/lib/ai/source-chunking";
import {
  attachSectionChunkRanges,
  buildSourceRetrievalQuery,
  detectSourceOutline,
  findSourceReferences,
  formatSourceOutline,
  matchSectionsByTitle,
  normalizeSourceOutline,
  parseSectionMarker,
  resolveOutlineTargets,
  sourceTitleMatchesReferences,
  type OutlinePage,
  type SourceOutline,
} from "@/lib/ai/source-outline";

const LECTURE_TITLES = [
  "Temperature", "Heat and work", "The first law", "Entropy", "Heat engines",
  "Refrigerators", "Free energy", "Phase changes", "Kinetic theory",
  "Maxwell-Boltzmann distribution", "Transport", "Statistical mechanics",
  "Black-body radiation", "Revision",
];

/** A fourteen-lecture pack: a contents slide, then eight slides per lecture. */
function lecturePack(): OutlinePage[] {
  const pages: OutlinePage[] = [{
    pageNumber: 1,
    heading: "PHYS1001 Thermal Physics",
    text: `PHYS1001 Thermal Physics\n\nContents\n${LECTURE_TITLES.map((title, index) => `Lecture ${index + 1}: ${title}`).join("\n")}`,
  }];
  LECTURE_TITLES.forEach((title, index) => {
    const lecture = index + 1;
    pages.push({
      pageNumber: pages.length + 1,
      heading: `Lecture ${lecture}: ${title}`,
      text: `Lecture ${lecture}: ${title}\n\nDr Smith`,
    });
    for (let slide = 0; slide < 7; slide += 1) {
      pages.push({
        pageNumber: pages.length + 1,
        heading: `${title} ${slide}`,
        text: `${title} ${slide}\n\n${`Lecture ${lecture} material about ${title.toLowerCase()} on slide ${slide}. `.repeat(8)}\n\nPHYS1001 Lecture ${lecture}`,
      });
    }
  });
  return pages;
}

function outlineFor(pages: OutlinePage[]): SourceOutline {
  const detected = detectSourceOutline(pages);
  const labels = new Map(detected.sections.map((section) => [section.key, section.label]));
  const chunks = chunkSourcePages(
    pages.map((page, index) => {
      const sectionKey = detected.pageSectionKeys[index];
      return sectionKey ? { ...page, sectionKey, sectionLabel: labels.get(sectionKey) } : page;
    })
  );
  return {
    sourceId: "pack",
    pageKind: "page",
    sections: attachSectionChunkRanges(detected.sections, chunks),
    chunkCount: chunks.length,
    chunkPageStarts: chunks.map((chunk) => chunk.pageStart ?? 0),
    chunkPageEnds: chunks.map((chunk) => chunk.pageEnd ?? 0),
  };
}

describe("reading a source's own divisions", () => {
  it("recognises the headings that open a lecture, week or chapter", () => {
    expect(parseSectionMarker("Lecture 4: Entropy")).toEqual({ kind: "lecture", number: 4, title: "Entropy" });
    expect(parseSectionMarker("PHYS1001 Lecture 12 - Black bodies")).toEqual({
      kind: "lecture",
      number: 12,
      title: "Black bodies",
    });
    expect(parseSectionMarker("WEEK 3 | Enzymes")).toMatchObject({ kind: "week", number: 3, title: "Enzymes" });
    expect(parseSectionMarker("Chapter IV")).toEqual({ kind: "chapter", number: 4 });
    expect(parseSectionMarker("Lecture four: Heat engines")).toMatchObject({ kind: "lecture", number: 4 });
    expect(parseSectionMarker("Lec 04")).toEqual({ kind: "lecture", number: 4 });
  });

  it("does not mistake a mention of a lecture for the start of one", () => {
    expect(parseSectionMarker("Recap of lecture 3")).toBeNull();
    expect(parseSectionMarker("Lecture 3 was about heat engines.")).toBeNull();
    expect(parseSectionMarker("Topic civil engineering")).toBeNull();
    expect(parseSectionMarker("Entropy always increases")).toBeNull();
  });

  it("divides a fourteen-lecture pack into its fourteen lectures", () => {
    const pages = lecturePack();
    const { sections, pageSectionKeys } = detectSourceOutline(pages);

    expect(sections).toHaveLength(14);
    expect(sections[3]).toMatchObject({
      key: "lecture:4",
      label: "Lecture 4: Entropy",
      pageStart: 26,
      pageEnd: 33,
    });
    // The contents slide lists every lecture but starts none of them.
    expect(pageSectionKeys[0]).toBeUndefined();
    expect(pageSectionKeys.at(-1)).toBe("lecture:14");
  });

  it("keeps a recap slide inside the lecture it appears in", () => {
    const pages: OutlinePage[] = [
      { pageNumber: 1, text: "Lecture 1: Heat\n\nBody" },
      { pageNumber: 2, text: "Lecture 2: Work\n\nBody" },
      { pageNumber: 3, text: "Lecture 3: Entropy\n\nBody" },
      { pageNumber: 4, text: "Lecture 2 - recap\n\nThe first law again." },
      { pageNumber: 5, text: "More entropy" },
    ];
    const { sections, pageSectionKeys } = detectSourceOutline(pages);
    expect(sections.map((section) => section.number)).toEqual([1, 2, 3]);
    expect(pageSectionKeys).toEqual(["lecture:1", "lecture:2", "lecture:3", "lecture:3", "lecture:3"]);
    expect(sections[2]).toMatchObject({ pageStart: 3, pageEnd: 5 });
  });

  it("uses the division the source numbers most when it names two", () => {
    const pages: OutlinePage[] = [1, 2, 3, 4].map((lecture) => ({
      pageNumber: lecture,
      text: `Week ${Math.ceil(lecture / 2)} · Lecture ${lecture}: Part ${lecture}\n\nBody`,
    }));
    const { sections } = detectSourceOutline(pages);
    expect(sections.map((section) => section.key)).toEqual([
      "lecture:1", "lecture:2", "lecture:3", "lecture:4",
    ]);
  });

  it("falls back to a document's top-level headings when nothing is numbered", () => {
    const { sections } = detectSourceOutline([
      { heading: "Photosynthesis", headingLevel: 1, text: "Photosynthesis\n\nLight reactions." },
      { heading: "Light reactions", headingLevel: 2, text: "Light reactions\n\nDetail." },
      { heading: "Respiration", headingLevel: 1, text: "Respiration\n\nGlycolysis." },
    ]);
    expect(sections.map((section) => section.label)).toEqual(["Photosynthesis", "Respiration"]);
  });

  it("finds no divisions in a source without any", () => {
    expect(detectSourceOutline([{ pageNumber: 1, text: "Just some notes." }]).sections).toEqual([]);
  });

  it("never lets a passage run from one lecture into the next", () => {
    const outline = outlineFor(lecturePack());
    const lecture4 = outline.sections[3];
    const lecture5 = outline.sections[4];
    expect(lecture4.chunkEnd).toBeLessThan(lecture5.chunkStart);
    const chunks = chunkSourcePages(lecturePack().map((page, index) => ({
      ...page,
      sectionKey: detectSourceOutline(lecturePack()).pageSectionKeys[index],
    })));
    for (const chunk of chunks) {
      const lectures = new Set([...chunk.text.matchAll(/Lecture (\d+) material/g)].map((match) => match[1]));
      expect(lectures.size).toBeLessThanOrEqual(1);
    }
  });
});

describe("what the student is pointing at", () => {
  it("reads the ways students name part of their material", () => {
    expect(findSourceReferences("In lecture 4, why does entropy increase?").sections).toEqual([
      { kind: "lecture", number: 4 },
    ]);
    expect(findSourceReferences("compare lectures 3 and 5").sections).toEqual([
      { kind: "lecture", number: 3 },
      { kind: "lecture", number: 5 },
    ]);
    expect(findSourceReferences("summarise weeks 2-4").sections).toEqual([
      { kind: "week", number: 2 },
      { kind: "week", number: 3 },
      { kind: "week", number: 4 },
    ]);
    expect(findSourceReferences("what was in L4?").sections).toEqual([{ kind: "lecture", number: 4 }]);
    expect(findSourceReferences("the fourth lecture").sections).toEqual([{ kind: "lecture", number: 4 }]);
    expect(findSourceReferences("the 2nd chapter").sections).toEqual([{ kind: "chapter", number: 2 }]);
    expect(findSourceReferences("explain slides 12-15 and p. 30").pages).toEqual([
      { start: 12, end: 15 },
      { start: 30, end: 30 },
    ]);
  });

  it("finds nothing in a question that names no part", () => {
    expect(findSourceReferences("Why does entropy always increase?")).toEqual({ sections: [], pages: [] });
    // Lower-case "l4" is not the shorthand.
    expect(findSourceReferences("the l4 vertebra").sections).toEqual([]);
  });

  it("matches a folder's separate lecture files by their titles", () => {
    const references = findSourceReferences("what did lecture 4 say about entropy?");
    expect(sourceTitleMatchesReferences("Lecture 4 - Entropy.pdf", references)).toBe(true);
    expect(sourceTitleMatchesReferences("Lec04_slides", references)).toBe(true);
    expect(sourceTitleMatchesReferences("L4 Thermodynamics", references)).toBe(true);
    expect(sourceTitleMatchesReferences("Lecture 14 - Revision", references)).toBe(false);
    expect(sourceTitleMatchesReferences("Week 4 notes", references)).toBe(false);
  });
});

describe("resolving a question against a pack", () => {
  const outline = outlineFor(lecturePack());

  it("reads the lecture the student names, in order", () => {
    const targets = resolveOutlineTargets(
      outline,
      findSourceReferences("In lecture 4, why does entropy increase?"),
      "In lecture 4, why does entropy increase?"
    );
    const lecture4 = outline.sections[3];
    expect(targets.via).toBe("named");
    expect(targets.sections.map((section) => section.label)).toEqual(["Lecture 4: Entropy"]);
    expect(targets.chunkIndexes[0]).toBe(lecture4.chunkStart);
    expect(targets.chunkIndexes.at(-1)).toBe(lecture4.chunkEnd);
  });

  it("says when the student names a lecture the pack does not have", () => {
    const targets = resolveOutlineTargets(outline, findSourceReferences("lecture 15"), "lecture 15");
    expect(targets.chunkIndexes).toEqual([]);
    expect(targets.missing).toEqual([{ kind: "lecture", number: 15 }]);
    expect(formatSourceOutline(outline, targets)).toContain(
      "The student mentioned Lecture 15, which this source does not contain. It runs from Lecture 1 to Lecture 14."
    );
  });

  it("reads the passages on the pages the student names", () => {
    const targets = resolveOutlineTargets(outline, findSourceReferences("explain slide 28"), "explain slide 28");
    expect(targets.via).toBe("pages");
    for (const index of targets.chunkIndexes) {
      expect(outline.chunkPageStarts[index]).toBeLessThanOrEqual(28);
      expect(outline.chunkPageEnds[index]).toBeGreaterThanOrEqual(28);
    }
    expect(targets.chunkIndexes.length).toBeGreaterThan(0);
  });

  it("reads a lecture the question is plainly about, by its title", () => {
    const question = "How does the Maxwell-Boltzmann distribution change with temperature?";
    expect(matchSectionsByTitle(outline.sections, question).map((section) => section.number)).toEqual([10]);
    const targets = resolveOutlineTargets(outline, findSourceReferences(question), question);
    expect(targets.via).toBe("title");
    expect(targets.sections[0].label).toBe("Lecture 10: Maxwell-Boltzmann distribution");
  });

  it("does not read a lecture by title for a related source, or on a loose match", () => {
    const question = "How does the Maxwell-Boltzmann distribution change?";
    expect(
      resolveOutlineTargets(outline, findSourceReferences(question), question, { allowTitleMatch: false }).via
    ).toBe("none");
    // Both lectures are about what the question asks.
    expect(
      matchSectionsByTitle(outline.sections, "Why is heat not the same as temperature?").map(
        (section) => section.title
      )
    ).toEqual(["Temperature", "Heat and work"]);
    expect(matchSectionsByTitle(outline.sections, "What changes when a gas is compressed?")).toEqual([]);
  });

  it("lists the contents for Tutor and marks the part asked about", () => {
    const targets = resolveOutlineTargets(outline, findSourceReferences("lecture 4"), "lecture 4");
    const text = formatSourceOutline(outline, targets);
    expect(text).toContain("- Lecture 4: Entropy (pp. 26–33)  <- asked about");
    expect(text).toContain("- Lecture 14: Revision");
    expect(text).toContain("The student asked about Lecture 4: Entropy");
  });

  it("reads a stored outline back, and refuses one that is not", () => {
    const stored = JSON.parse(JSON.stringify(outline));
    expect(normalizeSourceOutline("pack", stored)).toEqual(outline);
    expect(normalizeSourceOutline("pack", null)).toBeNull();
    expect(normalizeSourceOutline("pack", { sections: [{ kind: "nonsense" }] })?.sections).toEqual([]);
  });
});

describe("the search for a turn", () => {
  it("searches a follow-up together with the question it follows, keeping its lecture", () => {
    const plan = buildSourceRetrievalQuery({
      message: "can you explain that more simply?",
      history: [
        { role: "user", text: "In lecture 4, why does entropy increase in an irreversible process?" },
        { role: "model", text: "Because..." },
      ],
    });
    expect(plan.followUp).toBe(true);
    expect(plan.query).toContain("irreversible process");
    expect(plan.references.sections).toEqual([{ kind: "lecture", number: 4 }]);
  });

  it("searches a new question on its own", () => {
    const plan = buildSourceRetrievalQuery({
      message: "Now I want to understand how a refrigerator moves heat from cold to hot.",
      history: [{ role: "user", text: "In lecture 4, why does entropy increase?" }],
    });
    expect(plan.followUp).toBe(false);
    expect(plan.query).not.toContain("lecture 4");
    expect(plan.references.sections).toEqual([]);
  });

  it("lets a lecture named now replace the one named before", () => {
    const plan = buildSourceRetrievalQuery({
      message: "and what about lecture 5?",
      history: [{ role: "user", text: "Summarise lecture 4" }],
    });
    expect(plan.references.sections).toEqual([{ kind: "lecture", number: 5 }]);
  });
});
