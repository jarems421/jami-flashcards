export const CARD_BACK_AUTOCOMPLETE_STYLES = [
  "auto",
  "definition",
  "equation",
  "explanation",
  "steps",
  "example",
  "compare",
] as const;

export type CardBackAutocompleteStyle =
  (typeof CARD_BACK_AUTOCOMPLETE_STYLES)[number];

type SubjectHint =
  | "maths"
  | "science"
  | "language"
  | "humanities"
  | "general";

type SubjectInput = {
  front: string;
  deckName?: string;
  tags?: string[];
  style: CardBackAutocompleteStyle;
};

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

const SIMPLE_LATEX_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\\times\b/g, "×"],
  [/\\cdot\b/g, "·"],
  [/\\div\b/g, "÷"],
  [/\\pm\b/g, "±"],
  [/\\leq?\b/g, "≤"],
  [/\\geq?\b/g, "≥"],
  [/\\neq\b/g, "≠"],
  [/\\approx\b/g, "≈"],
  [/\\propto\b/g, "∝"],
  [/\\infty\b/g, "∞"],
  [/\\degree\b/g, "°"],
  [/\\pi\b/g, "π"],
  [/\\theta\b/g, "θ"],
  [/\\alpha\b/g, "α"],
  [/\\beta\b/g, "β"],
  [/\\gamma\b/g, "γ"],
  [/\\lambda\b/g, "λ"],
  [/\\mu\b/g, "μ"],
  [/\\Delta\b/g, "Δ"],
  [/\\Sigma\b/g, "Σ"],
  [/\\sum\b/g, "Σ"],
  [/\\int\b/g, "∫"],
  [/\\partial\b/g, "∂"],
];

const COMMON_WORD_SYMBOL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bpi\b/gi, "π"],
  [/\btheta\b/gi, "θ"],
  [/\balpha\b/gi, "α"],
  [/\bbeta\b/gi, "β"],
  [/\bgamma\b/gi, "γ"],
  [/\blambda\b/gi, "λ"],
  [/\bdelta\b/gi, "δ"],
];

function decodeLiteralUnicodeEscapes(text: string) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
}

function toSuperscript(value: string) {
  return value
    .split("")
    .map((digit) => SUPERSCRIPT_DIGITS[digit] ?? digit)
    .join("");
}

export function normalizeMathNotation(text: string) {
  let next = decodeLiteralUnicodeEscapes(text);

  SIMPLE_LATEX_REPLACEMENTS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });
  COMMON_WORD_SYMBOL_REPLACEMENTS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });

  next = next
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/([A-Za-z0-9)\]])\^([0-9]{1,3})\b/g, (_match, base: string, exponent: string) => `${base}${toSuperscript(exponent)}`)
    .replace(/([A-Za-z0-9)\]])\^\{([0-9]{1,3})\}/g, (_match, base: string, exponent: string) => `${base}${toSuperscript(exponent)}`)
    .replace(/<=(?!=)/g, "≤")
    .replace(/>=(?!=)/g, "≥")
    .replace(/\+-/g, "±")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");

  return next;
}

export function cleanGeneratedCardBack(text: string) {
  return normalizeMathNotation(text)
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^(answer|back)\s*:\s*/i, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[-*]\s*$/gm, "")
    .trim();
}

export function isCardBackAutocompleteStyle(
  value: unknown
): value is CardBackAutocompleteStyle {
  return (
    typeof value === "string" &&
    CARD_BACK_AUTOCOMPLETE_STYLES.includes(value as CardBackAutocompleteStyle)
  );
}

export function detectCardBackSubject({
  front,
  deckName,
  tags = [],
  style,
}: SubjectInput): SubjectHint {
  const haystack = [front, deckName, ...tags].join(" ").toLowerCase();

  if (
    style === "equation" ||
    /[=+\-*/^√πθΔΣ∫≤≥<>]/.test(front) ||
    /\b(math|maths|algebra|geometry|calculus|trig|trigonometry|equation|formula|solve|differentiate|integrate|gradient|probability|statistics|mechanics)\b/.test(haystack)
  ) {
    return "maths";
  }

  if (
    /\b(physics|chemistry|biology|science|force|energy|molecule|atom|cell|enzyme|reaction|voltage|current|mass|acceleration|wave)\b/.test(haystack)
  ) {
    return "science";
  }

  if (
    /\b(language|english|french|spanish|german|latin|grammar|vocab|vocabulary|translate|tense|noun|verb|adjective)\b/.test(haystack)
  ) {
    return "language";
  }

  if (
    /\b(history|geography|economics|politics|law|sociology|psychology|religion|philosophy)\b/.test(haystack)
  ) {
    return "humanities";
  }

  return "general";
}

export function getStylePrompt(style: CardBackAutocompleteStyle) {
  switch (style) {
    case "definition":
      return `Definition-focused:
- Start with the clearest definition or identity.
- Include the minimum context needed to distinguish it from similar terms.
- Avoid long paragraphs.`;
    case "equation":
      return `Maths/formula-focused:
- Put the key formula, identity, or final result first.
- Use real symbols where they are clearer: ×, ÷, ±, √, π, θ, Δ, ≤, ≥.
- Define every variable briefly.
- Include units, domains, or conditions if they matter.
- If a derivation is needed, show only the essential steps.`;
    case "explanation":
      return `Explanation-focused:
- Explain the idea in plain language.
- Use cause/effect or intuition where helpful.
- Keep it compact enough to review quickly.`;
    case "steps":
      return `Process/steps-focused:
- Use a short numbered or line-broken sequence.
- Make each step actionable and memorable.
- Do not add unnecessary theory.`;
    case "example":
      return `Example-focused:
- Give the answer plus one concise example.
- Make the example concrete and easy to review.
- Avoid turning the back into a full lesson.`;
    case "compare":
      return `Comparison-focused:
- State the key distinction from the closest confusing idea.
- Use "X is..., while Y is..." if useful.
- Keep the contrast sharp and testable.`;
    case "auto":
    default:
      return `Auto-detect the best flashcard back style:
- If the front asks "what is/define", write a definition.
- If it contains symbols, numbers, units, or asks "calculate/solve", write a formula or worked result.
- If it asks "why/how", write a short explanation.
- If it asks for a method/process, write concise steps.
- If it asks for differences, write a compact comparison.`;
  }
}

export function getSubjectPrompt(subject: SubjectHint) {
  switch (subject) {
    case "maths":
      return `Maths accuracy rules:
- Preserve the variables and notation used on the front unless a standard symbol is clearly better.
- Prefer readable plain text maths, e.g. "x = (-b ± √(b² - 4ac)) / 2a".
- Use Unicode symbols for common notation, not broken character codes, HTML entities, or weird substitutions.
- For complex expressions, use compact LaTeX-style plain text only if Unicode would be unclear.
- Do not invent extra cases, constants, or methods unless the card asks for them.
- Sanity-check signs, powers, brackets, and units before answering.`;
    case "science":
      return `Science accuracy rules:
- Include the exact law/process/definition first.
- Define symbols and units for equations.
- Mention conditions or common exceptions only when they affect correctness.
- Do not overstate causal claims.`;
    case "language":
      return `Language-card rules:
- Give the translation, grammar rule, or usage pattern first.
- Include gender, tense, register, or one tiny example only if useful.
- Avoid long explanations unless the front asks for one.`;
    case "humanities":
      return `Humanities accuracy rules:
- Answer with the key fact, concept, or distinction first.
- Include dates, names, or context only when needed to make the answer testable.
- Avoid vague filler.`;
    case "general":
    default:
      return `General accuracy rules:
- Use the deck name, tags, and nearby cards to infer level and format.
- If the front is under-specified, make the smallest reasonable assumption and state it briefly.
- Do not add decorative facts that make the card harder to review.`;
  }
}
