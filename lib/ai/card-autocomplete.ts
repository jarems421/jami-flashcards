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

type CleanGeneratedStudyTextOptions = {
  stripLeadingLabel?: boolean;
};

const SUPERSCRIPT_CHARS: Record<string, string> = {
  "0": "\u2070",
  "1": "\u00b9",
  "2": "\u00b2",
  "3": "\u00b3",
  "4": "\u2074",
  "5": "\u2075",
  "6": "\u2076",
  "7": "\u2077",
  "8": "\u2078",
  "9": "\u2079",
  "+": "\u207a",
  "-": "\u207b",
  "=": "\u207c",
  "(": "\u207d",
  ")": "\u207e",
  n: "\u207f",
  i: "\u2071",
};

const SUBSCRIPT_CHARS: Record<string, string> = {
  "0": "\u2080",
  "1": "\u2081",
  "2": "\u2082",
  "3": "\u2083",
  "4": "\u2084",
  "5": "\u2085",
  "6": "\u2086",
  "7": "\u2087",
  "8": "\u2088",
  "9": "\u2089",
  "+": "\u208a",
  "-": "\u208b",
  "=": "\u208c",
  "(": "\u208d",
  ")": "\u208e",
  a: "\u2090",
  e: "\u2091",
  h: "\u2095",
  i: "\u1d62",
  j: "\u2c7c",
  k: "\u2096",
  l: "\u2097",
  m: "\u2098",
  n: "\u2099",
  o: "\u2092",
  p: "\u209a",
  r: "\u1d63",
  s: "\u209b",
  t: "\u209c",
  u: "\u1d64",
  v: "\u1d65",
  x: "\u2093",
};

const LATEX_SYMBOL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\\times\b/g, "\u00b7"],
  [/\\cdot\b/g, "\u00b7"],
  [/\\div\b/g, "\u00f7"],
  [/\\pm\b/g, "\u00b1"],
  [/\\mp\b/g, "\u2213"],
  [/\\leq?\b/g, "\u2264"],
  [/\\geq?\b/g, "\u2265"],
  [/\\neq\b/g, "\u2260"],
  [/\\approx\b/g, "\u2248"],
  [/\\sim\b/g, "\u223c"],
  [/\\propto\b/g, "\u221d"],
  [/\\infty\b/g, "\u221e"],
  [/\\degree\b/g, "\u00b0"],
  [/\\circ\b/g, "\u00b0"],
  [/\\to\b/g, "\u2192"],
  [/\\rightarrow\b/g, "\u2192"],
  [/\\leftarrow\b/g, "\u2190"],
  [/\\leftrightarrow\b/g, "\u2194"],
  [/\\implies\b/g, "\u21d2"],
  [/\\iff\b/g, "\u21d4"],
  [/\\pi\b/g, "\u03c0"],
  [/\\theta\b/g, "\u03b8"],
  [/\\alpha\b/g, "\u03b1"],
  [/\\beta\b/g, "\u03b2"],
  [/\\gamma\b/g, "\u03b3"],
  [/\\delta\b/g, "\u03b4"],
  [/\\epsilon\b/g, "\u03b5"],
  [/\\zeta\b/g, "\u03b6"],
  [/\\eta\b/g, "\u03b7"],
  [/\\iota\b/g, "\u03b9"],
  [/\\kappa\b/g, "\u03ba"],
  [/\\lambda\b/g, "\u03bb"],
  [/\\mu\b/g, "\u03bc"],
  [/\\nu\b/g, "\u03bd"],
  [/\\xi\b/g, "\u03be"],
  [/\\rho\b/g, "\u03c1"],
  [/\\sigma\b/g, "\u03c3"],
  [/\\tau\b/g, "\u03c4"],
  [/\\phi\b/g, "\u03c6"],
  [/\\varphi\b/g, "\u03d5"],
  [/\\chi\b/g, "\u03c7"],
  [/\\psi\b/g, "\u03c8"],
  [/\\omega\b/g, "\u03c9"],
  [/\\Delta\b/g, "\u0394"],
  [/\\Gamma\b/g, "\u0393"],
  [/\\Lambda\b/g, "\u039b"],
  [/\\Omega\b/g, "\u03a9"],
  [/\\Theta\b/g, "\u0398"],
  [/\\Sigma\b/g, "\u03a3"],
  [/\\sum\b/g, "\u03a3"],
  [/\\prod\b/g, "\u03a0"],
  [/\\int\b/g, "\u222b"],
  [/\\partial\b/g, "\u2202"],
  [/\\nabla\b/g, "\u2207"],
  [/\\sin\b/g, "sin"],
  [/\\cos\b/g, "cos"],
  [/\\tan\b/g, "tan"],
  [/\\log\b/g, "log"],
  [/\\ln\b/g, "ln"],
];

const HTML_ENTITY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/&le;/gi, "\u2264"],
  [/&ge;/gi, "\u2265"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&ne;/gi, "\u2260"],
  [/&times;/gi, "\u00b7"],
  [/&pi;/gi, "\u03c0"],
  [/&theta;/gi, "\u03b8"],
  [/&alpha;/gi, "\u03b1"],
  [/&beta;/gi, "\u03b2"],
  [/&gamma;/gi, "\u03b3"],
  [/&delta;/gi, "\u03b4"],
  [/&sigma;/gi, "\u03c3"],
  [/&lambda;/gi, "\u03bb"],
  [/&mu;/gi, "\u03bc"],
];

const COMMON_WORD_SYMBOL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bpi\b/gi, "\u03c0"],
  [/\btheta\b/gi, "\u03b8"],
  [/\balpha\b/gi, "\u03b1"],
  [/\bbeta\b/gi, "\u03b2"],
  [/\bgamma\b/gi, "\u03b3"],
  [/\bdelta\b/gi, "\u03b4"],
  [/\bepsilon\b/gi, "\u03b5"],
  [/\bzeta\b/gi, "\u03b6"],
  [/\beta\b/gi, "\u03b7"],
  [/\biota\b/gi, "\u03b9"],
  [/\bkappa\b/gi, "\u03ba"],
  [/\bnu\b/gi, "\u03bd"],
  [/\bxi\b/gi, "\u03be"],
  [/\brho\b/gi, "\u03c1"],
  [/\btau\b/gi, "\u03c4"],
  [/\bphi\b/gi, "\u03c6"],
  [/\bvarphi\b/gi, "\u03d5"],
  [/\bchi\b/gi, "\u03c7"],
  [/\bpsi\b/gi, "\u03c8"],
  [/\bomega\b/gi, "\u03c9"],
  [/\bDelta\b/g, "\u0394"],
  [/\bGamma\b/g, "\u0393"],
  [/\bLambda\b/g, "\u039b"],
  [/\bOmega\b/g, "\u03a9"],
  [/\bTheta\b/g, "\u0398"],
  [/\bSigma\b/g, "\u03a3"],
  [/\bsigma\b/gi, "\u03c3"],
  [/\blambda\b/gi, "\u03bb"],
  [/\bmu\b/gi, "\u03bc"],
  [/\binfinity\b/gi, "\u221e"],
  [/\bdegree\b/gi, "\u00b0"],
];

function decodeLiteralUnicodeEscapes(text: string) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
}

function toSuperscript(value: string) {
  return value
    .split("")
    .map((char) => SUPERSCRIPT_CHARS[char] ?? char)
    .join("");
}

function toSubscript(value: string) {
  return value
    .split("")
    .map((char) => SUBSCRIPT_CHARS[char] ?? char)
    .join("");
}

function stripLatexMathDelimiters(text: string) {
  return text
    .replace(/\$\$([\s\S]+?)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\\\(([\s\S]+?)\\\)/g, "$1")
    .replace(/\\\[([\s\S]+?)\\\]/g, "$1");
}

function normalizeMarkdownSyntax(text: string) {
  return text
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*]\s+$/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, "$1$2");
}

function normalizeLatexStructures(text: string) {
  let next = text
    .replace(/\\sqrt\{([^{}]+)\}/g, "\u221a($1)")
    .replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, "root $1($2)");

  for (let index = 0; index < 6; index += 1) {
    const replaced = next.replace(
      /\\frac\{((?:[^{}]|\{[^{}]*\})+)\}\{((?:[^{}]|\{[^{}]*\})+)\}/g,
      "($1)/($2)"
    );

    if (replaced === next) {
      break;
    }

    next = replaced;
  }

  return next
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/\\operatorname\{([^{}]+)\}/g, "$1")
    .replace(/\\mathrm\{([^{}]+)\}/g, "$1")
    .replace(/\\mathbf\{([^{}]+)\}/g, "$1")
    .replace(/\\mathit\{([^{}]+)\}/g, "$1")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\quad/g, " ")
    .replace(/\\qquad/g, " ")
    .replace(/\\,/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\([()[\]{}])/g, "$1");
}

function normalizeSubscriptNotation(text: string) {
  return text
    .replace(
      /([A-Za-z])_\{([A-Za-z0-9+\-=()]{1,6})\}/g,
      (_match, base: string, subscript: string) => {
        const converted = toSubscript(subscript);
        return converted === subscript ? `${base} ${subscript}` : `${base}${converted}`;
      }
    )
    .replace(
      /([A-Za-z])_([A-Za-z0-9+\-=()]{1,3})\b/g,
      (_match, base: string, subscript: string) => {
        const converted = toSubscript(subscript);
        return converted === subscript ? `${base} ${subscript}` : `${base}${converted}`;
      }
    )
    .replace(/([A-Za-z])_([A-Za-z][A-Za-z0-9]{2,})\b/g, "$1 $2");
}

function normalizeMathOperators(text: string) {
  return text
    .replace(/\s*<->\s*/g, " \u2194 ")
    .replace(/\s*->\s*/g, " \u2192 ")
    .replace(/\s*<-\s*/g, " \u2190 ")
    .replace(/\bcbrt\(([^()]+)\)/gi, "\u221b($1)")
    .replace(/\bsqrt\(([^()]+)\)/gi, "\u221a($1)")
    .replace(/([A-Za-z0-9)\]])\*\*([+\-]?\d+(?:\.\d+)?(?:e[+\-]?\d+)?)\b/gi, "$1^$2")
    .replace(/([A-Za-z0-9)\]])\*\*\{([+\-]?\d+(?:\.\d+)?(?:e[+\-]?\d+)?)\}/gi, "$1^{$2}")
    .replace(/([A-Za-z0-9)\]])\*\*([+\-]?\d{1,3})\b/g, (_match, base: string, exponent: string) => `${base}${toSuperscript(exponent)}`)
    .replace(/([A-Za-z0-9)\]])\^([+\-]?\d{1,3})\b/g, (_match, base: string, exponent: string) => `${base}${toSuperscript(exponent)}`)
    .replace(/([A-Za-z0-9)\]])\^\{([+\-]?\d{1,3})\}/g, (_match, base: string, exponent: string) => `${base}${toSuperscript(exponent)}`)
    .replace(/([0-9A-Za-z)\]])\s*\*\s*([0-9A-Za-z([])/g, "$1 \u00b7 $2")
    .replace(/(\d)\s*\(/g, "$1 \u00b7 (")
    .replace(/\)\s*\(/g, ") \u00b7 (")
    .replace(/(\d)\s*([A-Za-z\u0370-\u03ff])(?![A-Za-z])/g, (_match, value: string, symbol: string, offset: number, source: string) => {
      const nextChar = source[offset + _match.length] ?? "";
      if ((symbol === "e" || symbol === "E") && /[0-9+\-]/.test(nextChar)) {
        return `${value}${symbol}`;
      }
      return `${value} \u00b7 ${symbol}`;
    })
    .replace(/<=(?!=)/g, "\u2264")
    .replace(/>=(?!=)/g, "\u2265")
    .replace(/!=/g, "\u2260")
    .replace(/\+-/g, "\u00b1");
}

export function normalizeMathNotation(text: string) {
  let next = decodeLiteralUnicodeEscapes(text);
  next = stripLatexMathDelimiters(next);
  next = normalizeLatexStructures(next);

  LATEX_SYMBOL_REPLACEMENTS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });
  HTML_ENTITY_REPLACEMENTS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });
  COMMON_WORD_SYMBOL_REPLACEMENTS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });

  next = normalizeMathOperators(next);
  next = normalizeSubscriptNotation(next);

  return next
    .replace(/\$/g, "")
    .replace(/\\([A-Za-z]+)\b/g, "$1")
    .replace(/\\+/g, "")
    .replace(/_/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanGeneratedStudyText(
  text: string,
  options: CleanGeneratedStudyTextOptions = {}
) {
  let next = normalizeMarkdownSyntax(text);
  next = normalizeMathNotation(next);

  if (options.stripLeadingLabel) {
    next = next.replace(/^(answer|back|explanation|result)\s*:\s*/i, "");
  }

  return next.trim();
}

export function cleanGeneratedCardBack(text: string) {
  return cleanGeneratedStudyText(text, { stripLeadingLabel: true });
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
    /[=+\-*/^\u221a\u03c0\u03b8\u0394\u03a3\u222b\u2264\u2265<>]/.test(front) ||
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
- Use real symbols where they are clearer: \u00b7, \u00f7, \u00b1, \u221a, \u03c0, \u03b8, \u0394, \u2264, \u2265.
- Avoid raw LaTeX. Do not write backslashes, dollar signs, or underscores like "\\frac", "$x$", or "x_1".
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
- Prefer readable plain text maths, e.g. "x = (-b \u00b1 \u221a(b\u00b2 - 4ac)) / 2a".
- Use Unicode symbols for common notation, not LaTeX, broken character codes, HTML entities, or weird substitutions.
- Never output visible backslashes, dollar-delimited maths, or underscore subscripts; write x\u2081, a\u2099, \u03c0, \u221a(x), and \u00b7 instead.
- For complex expressions, use compact plain text with clear brackets if Unicode would be unclear.
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
