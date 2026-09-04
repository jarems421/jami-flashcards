import { describe, expect, it } from "vitest";
import { splitAssistantAnswerAtDiagram } from "@/lib/ai/assistant-answer-layout";

const SKETCH = "```svg\n<svg viewBox=\"0 0 10 10\"><line x1=\"0\" y1=\"0\" x2=\"9\" y2=\"9\"/></svg>\n```";

describe("placing an illustration in an answer", () => {
  it("leaves an answer alone when it never drew anything", () => {
    const layout = splitAssistantAnswerAtDiagram("Here is the working.");

    expect(layout).toEqual({
      before: "Here is the working.",
      after: "",
      replacedDiagram: false,
    });
  });

  it("takes the sketch out and keeps the text either side of it", () => {
    const layout = splitAssistantAnswerAtDiagram(
      `A ladder leans on a wall.\n\n${SKETCH}\n\nTaking moments about A gives 97 N.`
    );

    expect(layout.replacedDiagram).toBe(true);
    expect(layout.before).toBe("A ladder leans on a wall.");
    expect(layout.after).toBe("Taking moments about A gives 97 N.");
    expect(layout.before).not.toContain("<svg");
    expect(layout.after).not.toContain("<svg");
  });

  it("removes a second sketch rather than leaving it behind", () => {
    const layout = splitAssistantAnswerAtDiagram(
      `First.\n\n${SKETCH}\n\nMiddle.\n\n${SKETCH}\n\nLast.`
    );

    expect(layout.before).toBe("First.");
    expect(layout.after).toContain("Middle.");
    expect(layout.after).toContain("Last.");
    expect(layout.after).not.toContain("<svg");
  });

  it("handles an answer that is nothing but a sketch", () => {
    const layout = splitAssistantAnswerAtDiagram(SKETCH);

    expect(layout.replacedDiagram).toBe(true);
    expect(layout.before).toBe("");
    expect(layout.after).toBe("");
  });

  it("does not touch a fenced block in another language", () => {
    const code = "```python\nprint('svg')\n```";
    const layout = splitAssistantAnswerAtDiagram(`Before.\n\n${code}\n\nAfter.`);

    expect(layout.replacedDiagram).toBe(false);
    expect(layout.before).toContain("print('svg')");
  });
});
