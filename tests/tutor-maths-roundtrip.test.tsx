import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import AiResponseRenderer from "@/components/ai/AiResponseRenderer";
import { parseJamiAssistantModelAnswer } from "@/lib/ai/jami-assistant";
import { extractStreamingAnswer } from "@/lib/ai/streaming-answer";

/*
 * Tutor answers with the maths students actually meet, sent through the whole
 * path -- the model's JSON, the parse, the stream and the renderer -- in every
 * way a model has been seen to escape it. Each must render exactly as the
 * correctly escaped answer does, with nothing raw or red on the page.
 */
const CORPUS: string[] = [
  "**Question 1**\n\nSolve $\\frac{2x+1}{3} = \\frac{x-4}{2}$.\n\n(a) Show that $x = -14$. **[3 marks]**",
  "The area is $A = \\frac{1}{2}ab\\sin C$, so $A = \\frac{1}{2} \\times 5 \\times 7 \\times \\sin 40^\\circ \\approx 11.2\\text{ cm}^2$.",
  "Use $\\tan\\theta = \\frac{\\text{opp}}{\\text{adj}}$, so $\\theta = \\tan^{-1}\\left(\\frac{3}{4}\\right) = 36.9^\\circ$.",
  "Since $\\beta$ is the angle, $\\binom{5}{2} = 10$ and the answer is $\\boxed{10}$.",
  "$$\\int_{0}^{2} (3x^2 - 2x)\\,dx = \\left[x^3 - x^2\\right]_0^2 = 4$$",
  // A display after words on its line, which once printed "$$ 0 \times A" as written.
  "By the **right distributive law**, \\[0 \\times A = (0 + 0) \\times A = 0 \\times A + 0 \\times A\\].",
  "Speed: $v = f\\lambda$, so $\\lambda = \\frac{v}{f} = \\frac{340}{170} = 2\\text{ m}$.",
  "For a wave, $\\nu$ is frequency and $\\rho$ is density; $x \\neq 0$ and $y \\ne 3$.",
  "Note $\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}$ and $a \\notin B$.",
  "$$\\begin{pmatrix} 4 \\\\ -3 \\end{pmatrix} + \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} = \\begin{pmatrix} 5 \\\\ -1 \\end{pmatrix}$$",
  "$$\\begin{aligned} 2x + 3 &= 11 \\\\ 2x &= 8 \\\\ x &= 4 \\end{aligned}$$",
  "$$f(x) = \\begin{cases} x^2 & \\text{if } x \\geq 0 \\\\ -x & \\text{otherwise} \\end{cases}$$",
  "Therefore $\\therefore x = 3$ and in $\\triangle ABC$, $\\angle A = 40^\\circ$.",
  "The resistance is $R = 12\\,\\Omega$ and current $I = 3\\text{ A}$; $\\mu = 0.4$.",
  "Mean: $\\bar{x} = \\frac{\\sum x}{n}$, variance $\\sigma^2 = \\frac{\\sum x^2}{n} - \\bar{x}^2$.",
  "The vector $\\overrightarrow{AB} = \\mathbf{b} - \\mathbf{a}$ and $\\hat{\\mathbf{i}}$ is a unit vector.",
  "Differentiate: $\\frac{dy}{dx} = 6x^2 - 4x + 1$, then set $\\frac{dy}{dx} = 0$.",
  "$\\lim_{x \\to \\infty} \\frac{1}{x} = 0$ and $\\sum_{r=1}^{n} r = \\frac{n(n+1)}{2}$.",
  "Use $\\log_a b = \\frac{\\ln b}{\\ln a}$, and $e^{\\ln x} = x$.",
  "Quadratic formula: $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$.",
  "$$\\Delta H = \\sum \\Delta H_f(\\text{products}) - \\sum \\Delta H_f(\\text{reactants})$$",
  "Equilibrium: $\\text{N}_2 + 3\\text{H}_2 \\rightleftharpoons 2\\text{NH}_3$, so $K_c = \\frac{[\\text{NH}_3]^2}{[\\text{N}_2][\\text{H}_2]^3}$.",
  "$x \\in \\mathbb{R}$, $A \\cup B$, $A \\cap B = \\emptyset$, $A \\subset B$, $\\forall x$.",
  "So $a \\equiv 3 \\pmod 7$ and $y \\propto x^2$, $p \\approx 0.25$.",
  "The partial derivative $\\frac{\\partial f}{\\partial x} = 2xy$.",
  "Increase by $15\\%$: $1.15 \\times 80 = 92$.",
  "| Step | Working |\n|---|---|\n| 1 | $2x + 3 = 11$ |\n| 2 | $x = \\frac{8}{2} = 4$ |",
  "1. Expand: $(x+3)(x-2) = x^2 + x - 6$\n2. Set to zero: $x^2 + x - 6 = 0$\n3. Factorise: $x = 2$ or $x = -3$",
  "Momentum $p = mv$, kinetic energy $E_k = \\frac{1}{2}mv^2 = \\frac{p^2}{2m}$.",
  "Resolve: $F\\cos 30^\\circ = 10$, so $F = \\frac{10}{\\cos 30^\\circ} = 11.5\\text{ N}$.",
  "$\\tau = Fr\\sin\\theta$ and $\\omega = \\frac{2\\pi}{T}$.",
  "Use $\\underline{a} \\cdot \\underline{b} = |a||b|\\cos\\theta$, and $\\uparrow$ is positive.",
  "Since $\\neg p$ and $3 \\nmid 7$, and $a \\not\\equiv b$.",
  "Gradient $m = \\frac{y_2 - y_1}{x_2 - x_1} = \\frac{7 - 3}{4 - 2} = 2$.",
  "Simplify $\\sqrt{50} = 5\\sqrt{2}$ and $\\sqrt[3]{27} = 3$.",
  "Probability: $P(A \\mid B) = \\frac{P(A \\cap B)}{P(B)}$.",
  "Kinematics: $s = ut + \\tfrac{1}{2}at^2$ and $v^2 = u^2 + 2as$.",
  "Inline display: the result is \\[x = \\frac{-3 \\pm \\sqrt{17}}{4}\\] which is irrational.",
  "Use \\(\\sin^2\\theta + \\cos^2\\theta = 1\\) here.",
  "Area under curve: $\\int_{1}^{e} \\frac{1}{x}\\,dx = \\ln e - \\ln 1 = 1$.",
  "The **remainder** is $r \\geq 0$ and $q \\leq 5$, with $\\Rightarrow$ and $\\Leftrightarrow$.",
  "Matrix $\\mathbf{M} = \\begin{bmatrix} 2 & 1 \\\\ 0 & 3 \\end{bmatrix}$, $\\det \\mathbf{M} = 6$.",
  "Newton: $F = ma$, so $a = \\frac{F}{m} = \\frac{12}{4} = 3\\text{ m s}^{-2}$.",
  "Temperature $20^{\\circ}\\text{C}$ and $\\theta_1 \\to \\theta_2$, $\\vec{v}$, $\\tilde{x}$.",
  "$$\\frac{d}{dx}\\left(\\frac{\\sin x}{x}\\right) = \\frac{x\\cos x - \\sin x}{x^2}$$",
  "Absolute value $|x - 3| < 2$ means $1 < x < 5$.",
  "Use the $\\text{nth}$ term $u_n = 3n + 2$, and the $\\textbf{key}$ step.",
  "Solve:\n\n$$x^2 = 4$$.",
  "Hence $$y = 3$$ as required.",
  "1. First $$x = 2$$\n2. Second",
  "SUVAT values:\nu = 0\nv = 12\ne.g. a ball dropped from rest",
];

/** The model writes LaTeX verbatim, escaping only quotes and newlines. */
function rawStringLiteral(text: string) {
  return `"${text.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function envelope(answerLiteral: string) {
  return `{"answer":${answerLiteral},"sourceRefs":[],"usedCurrentContext":true,"usedGeneralKnowledge":true,"usedWebResearch":false,"graphs":[],"diagrams":[],"studyMaterial":"none","studyMaterialFocus":""}`;
}

/** Each backslash run that starts a command escaped correctly or not, alternately. */
function mixedLiteral(text: string) {
  let flip = false;
  const body = text
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\u0000")
    .replace(/\\/g, () => {
      flip = !flip;
      return flip ? "\\\\" : "\\";
    })
    .replace(/\u0000/g, "\\n");
  return `"${body}"`;
}

const ENCODINGS: Record<string, (text: string) => string> = {
  correct: (text) => envelope(JSON.stringify(text)),
  single: (text) => envelope(rawStringLiteral(text)),
  doubled: (text) => envelope(JSON.stringify(text.replace(/\\/g, "\\\\"))),
  mixed: (text) => envelope(mixedLiteral(text)),
};

function render(content: string) {
  return renderToString(<AiResponseRenderer content={content} />);
}

function problems(html: string) {
  const found: string[] = [];
  if (html.includes("katex-error")) {
    const error = /class="katex-error"[^>]*title="([^"]*)"/.exec(html)?.[1];
    found.push(`katex-error: ${error ?? "?"}`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(html)) found.push("control-char");
  const outsideMath = html
    .replace(/<span class="katex[\s\S]*?<\/annotation>/g, "")
    .replace(/<[^>]+>/g, " ");
  if (/\\[a-zA-Z]{2,}/.test(outsideMath)) found.push(`raw-latex: ${/\\[a-zA-Z]{2,}/.exec(outsideMath)?.[0]}`);
  if (/\$/.test(outsideMath)) found.push("raw-dollar");
  return found;
}

/** What the client shows once every streamed delta has arrived. */
function streamedText(raw: string, chunk: number) {
  let buffer = "";
  let emitted = "";
  let client = "";
  for (let at = 0; at < raw.length; at += chunk) {
    buffer += raw.slice(at, at + chunk);
    const soFar = extractStreamingAnswer(buffer);
    if (soFar.length > emitted.length) {
      client += soFar.slice(emitted.length);
      emitted = soFar;
    }
  }
  return client;
}

describe("Tutor maths, end to end", () => {
  it("renders every answer cleanly when the model escapes it correctly", () => {
    const broken = CORPUS.flatMap((text) => {
      const issues = problems(render(text));
      return issues.length ? [`${text} -> ${issues.join(", ")}`] : [];
    });
    expect(broken).toEqual([]);
  });

  it.each(Object.keys(ENCODINGS))("renders the same maths when the model escapes it %s", (name) => {
    const broken = CORPUS.flatMap((text) => {
      const parsed = parseJamiAssistantModelAnswer(ENCODINGS[name](text), []);
      if (!parsed) return [`${text} -> did not parse`];
      const html = render(parsed.answer);
      const issues = problems(html);
      if (html !== render(text)) issues.push("renders differently");
      return issues.length ? [`${text} -> ${issues.join(", ")} (got ${JSON.stringify(parsed.answer)})`] : [];
    });
    expect(broken).toEqual([]);
  });

  it.each(Object.keys(ENCODINGS))("never streams a character it later takes back, escaped %s", (name) => {
    const broken = CORPUS.flatMap((text) => {
      const raw = ENCODINGS[name](text);
      const expected = extractStreamingAnswer(raw);
      return [1, 2, 3, 5, 7]
        .filter((chunk) => streamedText(raw, chunk) !== expected)
        .map((chunk) => `${text} -> wrong in chunks of ${chunk}`);
    });
    expect(broken).toEqual([]);
  });
});
