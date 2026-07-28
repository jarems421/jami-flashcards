import { describe, expect, it } from "vitest";

import { repairModelJsonBackslashes } from "@/lib/ai/model-json";
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
