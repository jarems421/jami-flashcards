import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import AiResponseRenderer from "@/components/ai/AiResponseRenderer";
import {
  extractTutorGraphs,
  parseAssistantGraphSpec,
  placeTutorGraphs,
  readTutorGraphSpecs,
} from "@/lib/ai/assistant-graph";
import { parseJamiAssistantModelAnswer } from "@/lib/ai/jami-assistant";

describe("parseAssistantGraphSpec", () => {
  it("reads the functions, points and ranges the Tutor names", () => {
    const graph = parseAssistantGraphSpec(
      JSON.stringify({
        title: "y = x² − 4",
        x: [-5, 5],
        y: [-6, 10],
        functions: ["x^2 - 4", { expression: "2x", label: "tangent" }],
        points: [[2, 0], { x: -2, y: 0 }],
      })
    );
    expect(graph).not.toBeNull();
    expect(graph!.view).toEqual({ xMin: -5, xMax: 5, yMin: -6, yMax: 10 });
    expect(graph!.title).toBe("y = x² − 4");
    expect(graph!.series.map((entry) => entry.kind)).toEqual(["function", "function", "points"]);
    expect(graph!.series[1]).toMatchObject({ expression: "2x", label: "tangent" });
    const points = graph!.series[2];
    expect(points.kind === "points" && points.points).toEqual([
      { x: 2, y: 0 },
      { x: -2, y: 0 },
    ]);
  });

  it("fits the y range when the Tutor leaves it out, and reads trig in degrees when told", () => {
    const graph = parseAssistantGraphSpec(JSON.stringify({ x: [0, 360], functions: ["sin x"], angles: "degrees" }));
    expect(graph!.series[0]).toMatchObject({ angleUnit: "degrees" });
    expect(graph!.view.yMin).toBeLessThanOrEqual(-1);
    expect(graph!.view.yMax).toBeGreaterThanOrEqual(1);
    expect(graph!.view.yMax).toBeLessThan(3);
  });

  it("leaves off a function it cannot read, and refuses a graph with nothing to draw", () => {
    const graph = parseAssistantGraphSpec(JSON.stringify({ functions: ["x^2", "y = alert(1)"] }));
    expect(graph!.series).toHaveLength(1);
    expect(parseAssistantGraphSpec(JSON.stringify({ functions: ["alert(1)"] }))).toBeNull();
    expect(parseAssistantGraphSpec("{not json")).toBeNull();
    expect(parseAssistantGraphSpec("[1, 2]")).toBeNull();
  });
});

describe("a graph in a Tutor answer", () => {
  const html = (content: string) => renderToString(<AiResponseRenderer content={content} />);

  it("is plotted from its functions", () => {
    const out = html('Here it is:\n\n```graph\n{"x":[-5,5],"y":[-6,10],"functions":["x^2 - 4"]}\n```\n');
    expect(out).toContain("graph of y = x^2 - 4");
    expect(out).toContain("<path");
    expect(out).toContain("Here it is");
    // No notebook to add it to outside a notebook's Tutor.
    expect(out).not.toContain("Add to page");
  });

  it("shows a block that is not a graph as the code it was", () => {
    const out = html("```graph\n{broken\n```\n");
    expect(out).toContain("<pre");
    expect(out).toContain("{broken");
  });
});

describe("graphs in a Tutor reply", () => {
  it("reads graphs from the graphs field, as strings or objects, and drops the rest", () => {
    expect(
      readTutorGraphSpecs([
        '{"functions":["x^2"]}',
        { functions: ["2x"], x: [0, 5] },
        "```graph\n{\"functions\":[\"x^3\"]}\n```",
        '{"functions":["alert(1)"]}',
        "not json",
      ])
    ).toEqual(['{"functions":["x^2"]}', '{"functions":["2x"],"x":[0,5]}', '{"functions":["x^3"]}']);
  });

  it("lifts out a graph block the worker model wrote into the answer with a broken fence", () => {
    const extracted = extractTutorGraphs(
      'graph\n{"x":[-2,6],"functions":["x^2 - 4*x + 3"]}\n``n\nThe graph shows roots at $x = 1$ and $x = 3$.'
    );
    expect(extracted.graphs).toEqual(['{"x":[-2,6],"functions":["x^2 - 4*x + 3"]}']);
    expect(extracted.answer).toBe("The graph shows roots at $x = 1$ and $x = 3$.");
  });

  it("leaves text that only mentions a graph alone", () => {
    const text = "Sketch the graph\nand label the roots {carefully}.";
    expect(extractTutorGraphs(text)).toEqual({ answer: text, graphs: [] });
  });

  it("draws each graph where it was marked, and an unmarked one first", () => {
    const spec = '{"functions":["x^2"]}';
    expect(placeTutorGraphs("Here it is:\n[graph 1]\nRoots at 0.", [spec])).toBe(
      "Here it is:\n\n```graph\n" + spec + "\n```\n\nRoots at 0."
    );
    expect(placeTutorGraphs("Roots at 0.", [spec])).toBe("```graph\n" + spec + "\n```\n\nRoots at 0.");
    expect(placeTutorGraphs("Look at [graph 2] here.", [])).toBe("Look at  here.");
  });

  it("parses the reply the worker actually sent: a copy of the answer before the JSON", () => {
    const raw =
      'graph\n{"title":"y = x^2 - 4x + 3","x":[-2,6],"functions":["x^2 - 4x + 3"]}\n``The curve is a parabola.\n\n' +
      JSON.stringify({
        answer: 'graph\n{"x":[-2,6],"functions":["x^2 - 4x + 3"]}\n``n\nThe curve is a parabola.',
        sourceRefs: [],
        usedCurrentContext: false,
        usedGeneralKnowledge: true,
        usedWebResearch: false,
      });
    const parsed = parseJamiAssistantModelAnswer(raw, []);
    expect(parsed).not.toBeNull();
    expect(parsed!.answer).toBe("The curve is a parabola.");
    expect(parsed!.graphs).toEqual(['{"x":[-2,6],"functions":["x^2 - 4x + 3"]}']);
  });
});
