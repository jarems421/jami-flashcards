import { describe, expect, it } from "vitest";
import {
  diagramType,
  extractTutorDiagrams,
  MAX_TUTOR_DIAGRAMS,
  placeTutorDiagrams,
  readTutorDiagramSpecs,
  renderTutorDiagram,
  separateOverlapping,
} from "@/lib/ai/tutor-diagram";
import { readTutorDiagramReply } from "@/lib/ai/assistant-illustrations";
import { parseAssistantIllustration, parseJamiAssistantModelAnswer } from "@/lib/ai/jami-assistant";
import { sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";

/**
 * Diagrams the Tutor describes and code draws.
 *
 * Freehand, models got the facts right and the layout wrong: labels over the
 * title and off the edge, a water cycle with no arrows, a "parallel" circuit
 * whose lamps sat outside the loop. These pin the layout down, since the
 * layout of a diagram is most of what it says.
 */

const render = (spec: unknown) => renderTutorDiagram(JSON.stringify(spec));

function drawn(spec: unknown) {
  const result = render(spec);
  if (!result.ok) throw new Error(`expected a diagram, got: ${result.reason}`);
  return result.svg;
}

function viewBox(svg: string) {
  const [, , width, height] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(/\s+/).map(Number);
  return { width, height };
}

function texts(svg: string) {
  return [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)<\/text>/g)].map(
    ([, x, y, anchor, text]) => ({ x: Number(x), y: Number(y), anchor, text })
  );
}

const leaf = {
  type: "labelled",
  title: "Cross-section of a leaf",
  drawing:
    '<svg viewBox="0 0 400 300"><rect x="0" y="0" width="400" height="10" fill="#fef3c7"/><rect x="0" y="10" width="400" height="100" fill="#dcfce7"/><rect x="0" y="110" width="400" height="150" fill="#f0fdf4"/><rect x="0" y="260" width="400" height="40" fill="#e0f2fe"/><text x="5" y="5">Stray model text</text></svg>',
  labels: [
    { text: "Waxy cuticle", x: 300, y: 5 },
    { text: "Upper epidermis", x: 320, y: 12 },
    { text: "Palisade mesophyll", x: 60, y: 60 },
    { text: "Spongy mesophyll", x: 60, y: 180 },
    { text: "Air space", x: 250, y: 190 },
    { text: "Lower epidermis", x: 60, y: 280 },
    { text: "Stoma", x: 250, y: 290 },
  ],
  arrows: [{ from: [200, 290], to: [200, 200], color: "#2563eb" }],
};

describe("renderTutorDiagram", () => {
  it("draws every type as SVG that passes the paper diagram allowlist unchanged", () => {
    const specs = [
      leaf,
      { type: "cycle", title: "Water", nodes: ["Sea", "Clouds", "Land"] },
      { type: "flow", title: "Macbeth", nodes: ["Soldier", "Prophecy", "Murder", "Tyrant"] },
      { type: "circuit", title: "One lamp", loop: [{ kind: "cell" }, { kind: "lamp" }] },
    ];
    for (const spec of specs) {
      const svg = drawn(spec);
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+">/);
      const again = sanitizeSvgDiagram(svg, { maxLength: 120_000 });
      expect(again.ok && again.svg).toBe(svg);
    }
  });

  it("starts with a white ground, so dark ink never lands on a dark page", () => {
    expect(drawn(leaf)).toMatch(/^<svg[^>]*><rect x="0" y="0" width="\d+" height="\d+" fill="#ffffff"\/>/);
  });

  it("escapes every label, so a label can never become markup", () => {
    const svg = drawn({ type: "cycle", nodes: ["<script>alert(1)</script>", "A & B", "C > D"] });
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("A &amp; B");
    expect(svg).toContain("C &gt; D");
  });

  describe("labelled", () => {
    it("drops the model's own text and sets each label beside the drawing", () => {
      const svg = drawn(leaf);
      expect(svg).not.toContain("Stray model text");
      const labels = texts(svg).filter((item) => leaf.labels.some((label) => label.text === item.text));
      expect(labels.map((item) => item.text).sort()).toEqual(leaf.labels.map((label) => label.text).sort());
      // Left-hand labels end at the left column, right-hand ones start at the right.
      expect(labels.filter((item) => item.anchor === "end").every((item) => item.x < 300)).toBe(true);
      expect(labels.filter((item) => item.anchor === "start").every((item) => item.x > 660)).toBe(true);
    });

    it("never lets two labels in a column overlap, or any leave the frame", () => {
      const crowded = {
        ...leaf,
        labels: Array.from({ length: 12 }, (_, index) => ({ text: `Part ${index + 1}`, x: 350, y: 5 + index })),
      };
      const svg = drawn(crowded);
      const { width, height } = viewBox(svg);
      const right = texts(svg).filter((item) => /^Part \d+$/.test(item.text)).sort((a, b) => a.y - b.y);
      expect(right).toHaveLength(12);
      for (let index = 1; index < right.length; index += 1) {
        expect(right[index].y - right[index - 1].y).toBeGreaterThanOrEqual(40);
      }
      for (const item of right) {
        expect(item.y).toBeGreaterThan(0);
        expect(item.y).toBeLessThan(height);
        expect(item.x + item.text.length * 17 * 0.56).toBeLessThan(width);
      }
    });

    it("draws each flow arrow with its own head, in the colour asked for", () => {
      expect(drawn(leaf)).toContain('fill="#2563eb"');
    });

    describe("named parts", () => {
      const heart = {
        type: "labelled",
        viewBox: "0 0 400 300",
        parts: [
          { label: "Right atrium", fill: "#93c5fd", shape: '<rect x="40" y="40" width="120" height="80" fill="#fca5a5"/>' },
          { label: "Right ventricle", fill: "#93c5fd", shape: '<path d="M40 140 l120 0 l0 100 l-120 0 z"/>' },
          { label: "Left atrium", fill: "#fca5a5", shape: '<circle cx="300" cy="80" r="40"/><text x="0" y="0">stray</text>' },
        ],
        arrows: [{ from: "Right atrium", to: "Right ventricle", color: "#2563eb" }],
      };
      // Each drawn leader line, as (start, end) in page coordinates.
      const leaders = (svg: string) =>
        [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#475569" stroke-width="1.5"\/>/g)].map(
          ([, x1, y1, x2, y2]) => ({ from: { x: Number(x1), y: Number(y1) }, to: { x: Number(x2), y: Number(y2) } })
        );

      it("points each label at the middle of its own part, however the shape is written", () => {
        const svg = drawn(heart);
        const ends = leaders(svg).map((line) => line.to);
        // viewBox 400x300 scaled into the 440-wide middle area: scale 1.1, origin (260, 40).
        const at = (x: number, y: number) => ({ x: 260 + x * 1.1, y: 40 + y * 1.1 });
        for (const expected of [at(100, 80), at(100, 190), at(300, 80)]) {
          expect(ends.some((point) => Math.abs(point.x - expected.x) < 1 && Math.abs(point.y - expected.y) < 1)).toBe(true);
        }
      });

      it("fills each part with the colour it declares, over any the shape carried", () => {
        const svg = drawn(heart);
        expect(svg).toContain('<g fill="#93c5fd"');
        expect(svg).toContain('<g fill="#fca5a5"');
        expect(svg).not.toMatch(/<rect x="40" y="40" width="120" height="80" fill=/);
        expect(svg).not.toContain("stray");
      });

      it("runs an arrow from one named part to the next, the way it was given", () => {
        const svg = drawn(heart);
        const head = /<polygon points="([\d.]+),([\d.]+) [^"]*" fill="#2563eb"\/>/.exec(svg);
        expect(head).not.toBeNull();
        // Heading down from the atrium into the ventricle, stopping short of its middle.
        expect(Number(head?.[2])).toBeGreaterThan(40 + 80 * 1.1);
        expect(Number(head?.[2])).toBeLessThan(40 + 190 * 1.1);
      });

      it("gives a small part inside a larger one its own point, so two labels never share a spot", () => {
        const svg = drawn({
          type: "labelled",
          viewBox: "0 0 400 300",
          parts: [
            { label: "Spongy mesophyll", fill: "#dcfce7", rect: [0, 100, 400, 120] },
            { label: "Air space", fill: "#ffffff", ellipse: [200, 160, 40, 20] },
          ],
        });
        const ends = leaders(svg).map((line) => line.to);
        expect(ends).toHaveLength(2);
        expect(Math.hypot(ends[0].x - ends[1].x, ends[0].y - ends[1].y)).toBeGreaterThan(40);
        // Both still inside the spongy layer's band, which runs 100-220 in the viewBox.
        for (const point of ends) {
          expect(point.y).toBeGreaterThan(40 + 100 * 1.1);
          expect(point.y).toBeLessThan(40 + 220 * 1.1);
        }
      });

      it("draws parts given as plain numbers, with no SVG markup to escape", () => {
        const svg = drawn({
          type: "labelled",
          viewBox: "0 0 200 200",
          outline: [{ path: "M 10 10 L 190 10 L 190 190 L 10 190 Z" }],
          parts: [
            { label: "Box", rect: [20, 20, 60, 40] },
            { label: "Disc", circle: [140, 50, 20] },
            { label: "Oval", ellipse: [60, 140, 30, 15] },
            { label: "Tri", polygon: [[120, 170], [180, 170], [150, 120]] },
            { label: "Blob", path: "M 100 100 l 20 0 l 0 20 z" },
          ],
        });
        for (const element of ["<rect", "<circle", "<ellipse", "<polygon", "<path"]) expect(svg).toContain(element);
        expect(leaders(svg)).toHaveLength(5);
      });

      it("refuses a part with no label, no shape, or a shape whose middle is unknown", () => {
        expect(render({ ...heart, parts: [{ label: "Aorta" }] }).ok).toBe(false);
        expect(render({ ...heart, parts: [{ shape: '<rect x="0" y="0" width="5" height="5"/>' }] }).ok).toBe(false);
        expect(
          render({ ...heart, parts: [{ label: "Moved", shape: '<rect x="0" y="0" width="5" height="5" transform="rotate(45)"/>' }] }).ok
        ).toBe(false);
        expect(
          render({ ...heart, parts: [{ label: "Moved", point: [2, 2], shape: '<rect x="0" y="0" width="5" height="5" transform="rotate(45)"/>' }] }).ok
        ).toBe(true);
      });
    });

    it("refuses a drawing with no viewBox, no shapes or no labels", () => {
      expect(render({ ...leaf, drawing: '<svg><rect x="0" y="0" width="1" height="1"/></svg>' }).ok).toBe(false);
      expect(render({ ...leaf, drawing: '<svg viewBox="0 0 10 10"><text>only words</text></svg>' }).ok).toBe(false);
      expect(render({ ...leaf, labels: [] }).ok).toBe(false);
    });
  });

  describe("cycle and flow", () => {
    const arrowheads = (svg: string) => (svg.match(/<polygon points=/g) ?? []).length;

    it("closes a cycle given no edges, one arrow per stage", () => {
      expect(arrowheads(drawn({ type: "cycle", nodes: ["A", "B", "C", "D"] }))).toBe(4);
    });

    it("chains a flow given no edges, one arrow between each pair", () => {
      expect(arrowheads(drawn({ type: "flow", nodes: ["A", "B", "C", "D"] }))).toBe(3);
    });

    it("joins stages by id or by label, and labels the arrows", () => {
      const svg = drawn({
        type: "cycle",
        nodes: [{ id: "sea", label: "Sea" }, { id: "clouds", label: "Clouds" }],
        edges: [{ from: "sea", to: "Clouds", label: "Evaporation" }],
      });
      expect(arrowheads(svg)).toBe(1);
      expect(svg).toContain(">Evaporation</text>");
    });

    it("refuses one stage, too many stages, or two stages with the same id", () => {
      expect(render({ type: "cycle", nodes: ["Alone"] }).ok).toBe(false);
      expect(render({ type: "flow", nodes: Array.from({ length: 13 }, (_, index) => `Step ${index}`) }).ok).toBe(false);
      expect(render({ type: "flow", nodes: [{ id: "a", label: "A" }, { id: "a", label: "B" }] }).ok).toBe(false);
    });
  });

  describe("circuit", () => {
    const junctions = (svg: string) => (svg.match(/<circle [^>]*r="4.5"/g) ?? []).length;

    it("draws two lamps in parallel as two branches joined at both ends", () => {
      const svg = drawn({
        type: "circuit",
        loop: [{ kind: "cell" }, { parallel: [[{ kind: "lamp", label: "L1" }], [{ kind: "lamp", label: "L2" }]] }],
      });
      expect(junctions(svg)).toBe(4);
      expect(svg).toContain(">L1</text>");
      expect(svg).toContain(">L2</text>");
    });

    it("draws series circuits with no junctions", () => {
      expect(junctions(drawn({ type: "circuit", loop: ["cell", "lamp", "lamp"] }))).toBe(0);
    });

    it("sets circuits side by side, each under its own heading", () => {
      const svg = drawn({
        type: "circuit",
        circuits: [
          { title: "Series", loop: ["cell", "lamp", "lamp"] },
          { title: "Parallel", loop: ["cell", { parallel: [["lamp"], ["lamp"]] }] },
        ],
      });
      expect(svg).toContain(">Series</text>");
      expect(svg).toContain(">Parallel</text>");
      expect((svg.match(/<g transform="translate/g) ?? []).length).toBe(2);
    });

    it("accepts what people also call the parts", () => {
      expect(render({ type: "circuit", loop: ["battery", "bulb", "light bulb", "rheostat"] }).ok).toBe(true);
    });

    it("refuses a circuit with no supply, an unknown part, or branches inside branches", () => {
      expect(render({ type: "circuit", loop: ["lamp", "resistor"] }).ok).toBe(false);
      expect(render({ type: "circuit", loop: ["cell", "flux capacitor"] }).ok).toBe(false);
      expect(
        render({ type: "circuit", loop: ["cell", { parallel: [["lamp"], [{ parallel: [["lamp"], ["lamp"]] }]] }] }).ok
      ).toBe(false);
    });
  });

  describe("arrows on the same path", () => {
    const at = (x: number, y: number) => ({ x, y });
    const gap = (a: { from: { x: number; y: number } }, b: { from: { x: number; y: number } }) =>
      Math.hypot(a.from.x - b.from.x, a.from.y - b.from.y);

    it("sets apart two arrows that would read as one, whichever way they point", () => {
      for (const [a, b] of [
        [{ from: at(100, 100), to: at(100, 300) }, { from: at(102, 380), to: at(101, 150) }],
        [{ from: at(100, 100), to: at(400, 100) }, { from: at(350, 104), to: at(150, 102) }],
      ]) {
        const [first, second] = separateOverlapping([
          { ...a, stroke: "#dc2626" },
          { ...b, stroke: "#dc2626" },
        ]);
        // Moved 9 each, opposite ways: the lines end up about 18 apart.
        const offsetFirst = gap(first, { from: a.from });
        const offsetSecond = gap(second, { from: b.from });
        expect(offsetFirst).toBeCloseTo(9, 0);
        expect(offsetSecond).toBeCloseTo(9, 0);
        const firstSide = (first.from.x - a.from.x) + (first.from.y - a.from.y);
        const secondSide = (second.from.x - b.from.x) + (second.from.y - b.from.y);
        expect(Math.sign(firstSide)).toBe(-Math.sign(secondSide));
      }
    });

    it("leaves arrows alone that only meet, cross or run side by side at a distance", () => {
      const segments = [
        { from: at(0, 0), to: at(0, 100), stroke: "#000" },
        { from: at(0, 100), to: at(100, 100), stroke: "#000" },
        { from: at(50, 0), to: at(50, 100), stroke: "#000" },
      ];
      expect(separateOverlapping(segments)).toEqual(segments);
    });
  });

  it("reads a spec's type from its content when the type was left out", () => {
    expect(diagramType({ circuits: [] })).toBe("circuit");
    expect(diagramType({ loop: [] })).toBe("circuit");
    expect(diagramType({ parts: [] })).toBe("labelled");
    expect(diagramType({ nodes: [] })).toBe("flow");
    expect(diagramType({ type: "labeled" })).toBe("labelled");
    expect(diagramType({ type: "venn", nodes: [] })).toBeNull();
    expect(diagramType({})).toBeNull();
  });

  it("refuses anything that is not one of the four types, or not JSON", () => {
    expect(render({ type: "venn", sets: [] }).ok).toBe(false);
    expect(renderTutorDiagram("{not json").ok).toBe(false);
    expect(renderTutorDiagram("").ok).toBe(false);
  });
});

describe("diagrams in a Tutor answer", () => {
  const cycle = JSON.stringify({ type: "cycle", title: "Water", nodes: ["Sea", "Clouds", "Land"] });
  const flow = JSON.stringify({ type: "flow", nodes: ["A", "B"] });

  it("draws each diagram where its marker is, as a fenced svg block", () => {
    const answer = placeTutorDiagrams("Here is the cycle.\n\n[diagram 1]\n\nEvaporation comes first.", [cycle]);
    expect(answer).toMatch(/^Here is the cycle\.\n\n```svg\n<svg[\s\S]*<\/svg>\n```\n\nEvaporation comes first\.$/);
  });

  it("puts an unmarked diagram first and removes a marker with nothing behind it", () => {
    const answer = placeTutorDiagrams("Text. [diagram 2]", [cycle]);
    expect(answer.startsWith("```svg\n<svg")).toBe(true);
    expect(answer).not.toContain("[diagram");
  });

  it("keeps only diagrams that draw, once each, and no more than the limit", () => {
    const specs = readTutorDiagramSpecs([
      cycle,
      JSON.parse(cycle),
      "{not json",
      { type: "venn" },
      flow,
      JSON.stringify({ type: "flow", nodes: ["C", "D"] }),
      JSON.stringify({ type: "flow", nodes: ["E", "F"] }),
    ]);
    expect(specs).toHaveLength(MAX_TUTOR_DIAGRAMS);
    expect(specs[0]).toBe(JSON.stringify(JSON.parse(cycle)));
  });

  it("lifts a diagram block written into the answer text", () => {
    const lifted = extractTutorDiagrams("Look:\n```diagram\n" + cycle + "\n```\nDone.");
    expect(lifted.diagrams).toEqual([cycle]);
    expect(lifted.answer).toBe("Look:\n\nDone.");
  });

  it("reads the diagrams field from the model's answer", () => {
    const parsed = parseJamiAssistantModelAnswer(
      JSON.stringify({
        answer: "The cycle:\n[diagram 1]",
        sourceRefs: [],
        usedCurrentContext: false,
        usedGeneralKnowledge: true,
        diagrams: [cycle],
      }),
      []
    );
    expect(parsed?.diagrams).toEqual([cycle]);
  });

  it("accepts an answer that is only a diagram", () => {
    const parsed = parseJamiAssistantModelAnswer(
      JSON.stringify({ answer: "", sourceRefs: [], usedCurrentContext: false, usedGeneralKnowledge: true, diagrams: [cycle] }),
      []
    );
    expect(parsed?.diagrams).toHaveLength(1);
  });
});

describe("Show this visually", () => {
  it("draws a diagram reply, with its title as the caption", () => {
    const reply = readTutorDiagramReply(
      JSON.stringify({ kind: "diagram", altText: "The water cycle.", diagram: JSON.parse('{"type":"cycle","title":"Water","nodes":["Sea","Clouds"]}') })
    );
    expect(reply).toMatchObject({ kind: "diagram", title: "Water", altText: "The water cycle." });
  });

  it("passes a photo request through with what it should show", () => {
    expect(readTutorDiagramReply('{"kind":"photo","altText":"A rainforest canopy."}')).toEqual({
      kind: "photo",
      altText: "A rainforest canopy.",
    });
  });

  it("reads a correct diagram however loosely the model wrapped it", () => {
    // Trailing prose after the object.
    expect(
      readTutorDiagramReply(
        '{"kind":"diagram","altText":"A","diagram":{"type":"flow","nodes":["A","B"]}}\n``Note: arrows show order.'
      ).kind
    ).toBe("diagram");
    // The diagram sent bare, its type given as its kind.
    expect(readTutorDiagramReply('{"kind":"flow","title":"Arc","nodes":["A","B"]}')).toMatchObject({
      kind: "diagram",
      title: "Arc",
    });
    // The type left out.
    expect(
      readTutorDiagramReply('{"kind":"diagram","altText":"C","diagram":{"loop":["cell","lamp"]}}').kind
    ).toBe("diagram");
  });

  it("says why a reply cannot be drawn, so it can be asked for again", () => {
    expect(readTutorDiagramReply("not json")).toMatchObject({ kind: "invalid" });
    const circuit = readTutorDiagramReply(
      JSON.stringify({ kind: "diagram", altText: "x", diagram: { type: "circuit", loop: ["lamp"] } })
    );
    expect(circuit).toEqual({ kind: "invalid", reason: "a circuit needs a cell or battery" });
  });

  it("stores a diagram visual as sanitized SVG, and still reads pictures saved before diagrams", () => {
    const svg = drawn({ type: "flow", nodes: ["A", "B"] });
    expect(
      parseAssistantIllustration({ kind: "diagram", id: "d1", svg, altText: "A to B", caption: "Flow", createdAt: 5 })
    ).toEqual({ kind: "diagram", id: "d1", svg, altText: "A to B", caption: "Flow", createdAt: 5 });
    expect(
      parseAssistantIllustration({ kind: "diagram", id: "d2", svg: "<svg><script>x</script></svg>", altText: "a", caption: "b" })
    ).toBeNull();
    expect(
      parseAssistantIllustration({
        id: "img1",
        storagePath: "users/u/assistantImages/img1/illustration.png",
        mimeType: "image/png",
        width: 800,
        height: 600,
        altText: "A leaf",
        caption: "A leaf",
        createdAt: 1,
      })
    ).toMatchObject({ id: "img1", storagePath: "users/u/assistantImages/img1/illustration.png" });
  });
});
