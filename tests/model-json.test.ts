import { describe, expect, it } from "vitest";

import katex from "katex";

import {
  closeUnbalancedJson,
  ESCAPE_EATEN_LATEX,
  repairModelJsonBackslashes,
  repairModelLatex,
  restoreEscapeEatenLatex,
} from "@/lib/ai/model-json";
import { extractStreamingAnswer } from "@/lib/ai/streaming-answer";
import { parseJamiAssistantModelAnswer } from "@/lib/ai/jami-assistant";

const parse = (raw: string) =>
  JSON.parse(repairModelJsonBackslashes(raw)) as { a: string };

describe("repairModelJsonBackslashes", () => {
  it("recovers the observed degrees-Celsius corruption", () => {
    // Seen in the app: rendered as "20 extoextC" because \t became a tab.
    const raw = String.raw`{"a":"between $20^\text{o}\text{C}$ and $35^\text{o}\text{C}$"}`;
    expect(parse(raw).a).toBe(
      String.raw`between $20^\text{o}\text{C}$ and $35^\text{o}\text{C}$`
    );
  });

  it("keeps commands whose first letter is a JSON escape", () => {
    for (const command of [
      "text",
      "times",
      "theta",
      "tan",
      "frac",
      "forall",
      "beta",
      "binom",
      "bar",
      "rightarrow",
      "rho",
    ]) {
      const raw = `{"a":"\\${command}{x}"}`;
      expect(parse(raw).a, command).toBe(`\\${command}{x}`);
    }
  });

  it("rescues commands that made the document unparseable", () => {
    for (const command of ["sqrt", "cdot", "pi", "alpha", "vec", "lambda", "hat"]) {
      const raw = `{"a":"\\${command}{x}"}`;
      expect(() => JSON.parse(raw)).toThrow();
      expect(parse(raw).a, command).toBe(`\\${command}{x}`);
    }
  });

  it("leaves genuine paragraph breaks alone", () => {
    const raw = String.raw`{"a":"First para.\n\nThe second one.\n\nnext up"}`;
    expect(parse(raw).a).toBe("First para.\n\nThe second one.\n\nnext up");
  });

  it("leaves real tabs and newlines that are not commands alone", () => {
    const raw = String.raw`{"a":"col\t| col\r\nend"}`;
    expect(parse(raw).a).toBe("col\t| col\r\nend");
  });

  it("recovers n-commands that cannot be read as prose", () => {
    const raw = String.raw`{"a":"$a \neq b$ and $\nabla f$"}`;
    expect(parse(raw).a).toBe(String.raw`$a \neq b$ and $\nabla f$`);
  });

  it("is idempotent on correctly escaped output", () => {
    const raw = String.raw`{"a":"$\\frac{dy}{dx} = \\sqrt{x}$\n\nDone."}`;
    const once = repairModelJsonBackslashes(raw);
    expect(once).toBe(raw);
    expect(repairModelJsonBackslashes(once)).toBe(raw);
    expect((JSON.parse(once) as { a: string }).a).toBe(
      "$\\frac{dy}{dx} = \\sqrt{x}$\n\nDone."
    );
  });

  it("preserves unicode escapes", () => {
    expect(parse(String.raw`{"a":"caf\u00e9"}`).a).toBe("café");
  });

  it("leaves text with no backslashes untouched", () => {
    const raw = '{"a":"plain answer"}';
    expect(repairModelJsonBackslashes(raw)).toBe(raw);
  });
});

describe("closeUnbalancedJson", () => {
  it("closes what a reply left open at its end", () => {
    expect(JSON.parse(closeUnbalancedJson('{"a":{"b":["x"]}'))).toEqual({ a: { b: ["x"] } });
  });

  it("puts right the last closers when they are the wrong kind or order", () => {
    // Both seen from the lesson writer: a list closed as an object, and the pair swapped.
    expect(JSON.parse(closeUnbalancedJson('{"a":{"b":["x"}}}'))).toEqual({ a: { b: ["x"] } });
    expect(JSON.parse(closeUnbalancedJson('{"a":{"b":["x"}]}'))).toEqual({ a: { b: ["x"] } });
  });

  it("ignores brackets inside strings, and escaped quotes", () => {
    const raw = String.raw`{"a":"a } and a \" and a {","b":[1`;
    expect(JSON.parse(closeUnbalancedJson(raw))).toEqual({ a: 'a } and a " and a {', b: [1] });
    const latex = String.raw`{"a":"$\\frac{1}{2}$"}`;
    expect(closeUnbalancedJson(latex)).toBe(latex);
  });

  it("leaves complete JSON, a reply cut off inside a string, and a mistake in the middle alone", () => {
    expect(closeUnbalancedJson('{"a":1}\n')).toBe('{"a":1}\n');
    expect(closeUnbalancedJson('{"a":"half]}')).toBe('{"a":"half]}');
    expect(closeUnbalancedJson('{"a":[1},"b":2}')).toBe('{"a":[1},"b":2}');
  });
});

describe("restoreEscapeEatenLatex", () => {
  const renders = (latex: string) => {
    try {
      katex.renderToString(latex, { throwOnError: true });
      return true;
    } catch {
      return false;
    }
  };

  it("puts back the letter the worker dropped", () => {
    // Seen in a moles lesson: "mass $=$ moles $\imes M_r$".
    expect(restoreEscapeEatenLatex(String.raw`mass $=$ moles $\imes M_r$`)).toBe(String.raw`mass $=$ moles $\times M_r$`);
    expect(restoreEscapeEatenLatex(String.raw`$\rac{1}{2}$ and $\ext{m}$`)).toBe(String.raw`$\frac{1}{2}$ and $\text{m}$`);
  });

  it("repairs only what is broken: every entry is a real command, and its truncation is not", () => {
    for (const [eaten, command] of Object.entries(ESCAPE_EATEN_LATEX)) {
      // Two arguments, so \frac and \binom have what they need.
      expect(renders(`\\${command}{x}{y}`), command).toBe(true);
      expect(renders(`\\${eaten}{x}{y}`), eaten).toBe(false);
    }
  });

  it("leaves real commands and longer names alone", () => {
    const text = String.raw`$\eta + \beta \times \text{s} \tanh x \neq \anything$`;
    expect(restoreEscapeEatenLatex(text)).toBe(text);
  });

  it("moves a Greek unit out of \\text, where KaTeX cannot draw it", () => {
    // Seen seven times in one Ohm's law lesson.
    const cases: [string, string][] = [
      [String.raw`R = 12\text{ \Omega}`, String.raw`R = 12\,\Omega`],
      [String.raw`2\text{ k\Omega}`, String.raw`2\,\text{k}\Omega`],
      [String.raw`3\text{ \mu m}`, String.raw`3\,\mu\text{m}`],
    ];
    for (const [written, meant] of cases) {
      expect(renders(written)).toBe(false);
      expect(repairModelLatex(written)).toBe(meant);
      expect(renders(meant)).toBe(true);
    }
    expect(repairModelLatex(String.raw`5\,\text{m s}^{-1}`)).toBe(String.raw`5\,\text{m s}^{-1}`);
  });
});

describe("streaming and parsing seams", () => {
  it("streams unescaped LaTeX without control characters leaking through", () => {
    const buffer = String.raw`{"answer":"The optimum is $20^\text{o}\text{C}$ and`;
    const answer = extractStreamingAnswer(buffer);
    expect(answer).toContain(String.raw`\text{o}`);
    expect(answer).not.toMatch(/[\t\f\b]/);
  });

  it("no longer drops a finished answer that used \\sqrt", () => {
    const raw = String.raw`{"answer":"Use $\sqrt{x}$ here.","sourceRefs":[],"usedCurrentContext":true,"usedGeneralKnowledge":false}`;
    expect(JSON.parse.bind(null, raw)).toThrow();

    const parsed = parseJamiAssistantModelAnswer(raw, []);
    expect(parsed).not.toBeNull();
    expect(parsed?.answer).toBe(String.raw`Use $\sqrt{x}$ here.`);
  });
});
