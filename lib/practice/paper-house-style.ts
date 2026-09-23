import type { PracticePaperAssessmentProfile } from "@/lib/practice/practice-papers";

/**
 * How each exam board prints its papers, so a generated paper looks like the
 * paper the student will sit rather than a worksheet.
 *
 * Only the conventions are kept here -- where the marks go, what the margins
 * say, how answer lines are ruled -- read off real scripts in the exam corpus.
 * No board's logo, paper codes, copyright lines or wording beyond these
 * standard instructions is reproduced, and every cover still says the paper is
 * Jami's and not an official one.
 */

export type PaperHouseStyleId = "aqa" | "pearson" | "ocr" | "sqa" | "wjec" | "ccea" | "cambridge" | "generic";

export type PaperHouseStyle = {
  id: PaperHouseStyleId;
  /**
   * How a question's marks are printed and where.
   * - `words`: "[2 marks]" under the question, before the answer space (AQA).
   * - `parenthesised`: "(2)" under the question (Pearson).
   * - `bracketed-before`: "[2]" under the question (WJEC, Eduqas).
   * - `bracketed-after`: "[2]" at the end of the last answer line (OCR, Cambridge).
   * - `column`: the number alone, in a marks column in the right margin (SQA).
   */
  tariff: "words" | "parenthesised" | "bracketed-before" | "bracketed-after" | "column";
  /**
   * What the page reserves beside the answer space.
   * - `box`: a ruled column on the right headed "Do not write outside the box" (AQA).
   * - `hatched`: "DO NOT WRITE IN THIS AREA" down both edges (Pearson).
   * - `marks-column`: a MARKS column and "DO NOT WRITE IN THIS MARGIN" on the right (SQA).
   * - `examiner-column`: an "Examiner only" column on the right (WJEC, Eduqas, CCEA).
   */
  margin: "box" | "hatched" | "marks-column" | "examiner-column" | "none";
  answerLines: "solid" | "dotted";
  /** "(Total for Question 1 = 6 marks)" after a question's last part (Pearson). */
  questionTotals: boolean;
  /** Printed at the foot of every page but the last. */
  turnOver: string;
  pageNumber: "top" | "bottom";
  /** Whether a later part prints only its own letter, "(b)", as most boards do; AQA repeats the full number. */
  repeatQuestionNumber: boolean;
  /** AQA's question numbers sit in boxes, one digit to a box. */
  boxedNumbers: boolean;
  /** SQA puts a full stop after a question number: "2.". */
  numberStop: boolean;
  sectionHeading: "title" | "capitals";
  cover: "aqa" | "pearson" | "ocr" | "sqa" | "wjec" | "cambridge" | "generic";
  endOfPaper: string;
};

const STYLES: Record<PaperHouseStyleId, PaperHouseStyle> = {
  aqa: {
    id: "aqa",
    tariff: "words",
    margin: "box",
    answerLines: "solid",
    questionTotals: false,
    turnOver: "Turn over ►",
    pageNumber: "top",
    repeatQuestionNumber: true,
    boxedNumbers: true,
    numberStop: false,
    sectionHeading: "title",
    cover: "aqa",
    endOfPaper: "END OF QUESTIONS",
  },
  pearson: {
    id: "pearson",
    tariff: "parenthesised",
    margin: "hatched",
    answerLines: "dotted",
    questionTotals: true,
    turnOver: "Turn over ►",
    pageNumber: "bottom",
    repeatQuestionNumber: false,
    boxedNumbers: false,
    numberStop: false,
    sectionHeading: "capitals",
    cover: "pearson",
    endOfPaper: "TOTAL FOR PAPER IS {total} MARKS",
  },
  ocr: {
    id: "ocr",
    tariff: "bracketed-after",
    margin: "none",
    answerLines: "dotted",
    questionTotals: false,
    turnOver: "Turn over",
    pageNumber: "bottom",
    repeatQuestionNumber: false,
    boxedNumbers: false,
    numberStop: false,
    sectionHeading: "capitals",
    cover: "ocr",
    endOfPaper: "END OF QUESTION PAPER",
  },
  sqa: {
    id: "sqa",
    tariff: "column",
    margin: "marks-column",
    answerLines: "solid",
    questionTotals: false,
    turnOver: "[Turn over",
    pageNumber: "bottom",
    repeatQuestionNumber: false,
    boxedNumbers: false,
    numberStop: true,
    sectionHeading: "capitals",
    cover: "sqa",
    endOfPaper: "[END OF QUESTION PAPER]",
  },
  wjec: {
    id: "wjec",
    tariff: "bracketed-before",
    margin: "examiner-column",
    answerLines: "dotted",
    questionTotals: false,
    turnOver: "Turn over.",
    pageNumber: "bottom",
    repeatQuestionNumber: false,
    boxedNumbers: false,
    numberStop: false,
    sectionHeading: "capitals",
    cover: "wjec",
    endOfPaper: "END OF PAPER",
  },
  // Northern Ireland's papers share WJEC's furniture: the examiner's column, the capitalised headings.
  ccea: {
    id: "ccea",
    tariff: "bracketed-before",
    margin: "examiner-column",
    answerLines: "dotted",
    questionTotals: false,
    turnOver: "[Turn over",
    pageNumber: "bottom",
    repeatQuestionNumber: false,
    boxedNumbers: false,
    numberStop: false,
    sectionHeading: "capitals",
    cover: "wjec",
    endOfPaper: "THIS IS THE END OF THE QUESTION PAPER",
  },
  cambridge: {
    id: "cambridge",
    tariff: "bracketed-after",
    margin: "none",
    answerLines: "dotted",
    questionTotals: false,
    turnOver: "[Turn over",
    pageNumber: "top",
    repeatQuestionNumber: false,
    boxedNumbers: false,
    numberStop: false,
    sectionHeading: "capitals",
    cover: "cambridge",
    endOfPaper: "END OF QUESTION PAPER",
  },
  generic: {
    id: "generic",
    tariff: "words",
    margin: "none",
    answerLines: "dotted",
    questionTotals: false,
    turnOver: "Turn over",
    pageNumber: "bottom",
    repeatQuestionNumber: true,
    boxedNumbers: false,
    numberStop: false,
    sectionHeading: "title",
    cover: "generic",
    endOfPaper: "END OF QUESTIONS",
  },
};

const BOARDS: Array<[RegExp, PaperHouseStyleId]> = [
  [/\baqa\b/i, "aqa"],
  [/\b(pearson|edexcel)\b/i, "pearson"],
  [/\bocr\b|oxford cambridge and rsa/i, "ocr"],
  [/\bsqa\b|qualifications scotland|scottish qualifications/i, "sqa"],
  [/\b(wjec|eduqas)\b/i, "wjec"],
  [/\bccea\b|council for the curriculum/i, "ccea"],
  [/\b(caie|cie|cambridge (assessment )?international|cambridge igcse|igcse cambridge)\b/i, "cambridge"],
];

/** The board whose papers this one should look like, or a plain house style when none is known. */
export function paperHouseStyle(
  profile: Partial<PracticePaperAssessmentProfile> | undefined
): PaperHouseStyle {
  const described = [profile?.awardingBodyOrInstitution, profile?.specificationOrCourse, profile?.qualificationOrModule]
    .filter(Boolean)
    .join(" ");
  // The awarding body wins over a course name that happens to mention another board.
  for (const text of [profile?.awardingBodyOrInstitution ?? "", described]) {
    for (const [pattern, id] of BOARDS) if (pattern.test(text)) return STYLES[id];
  }
  return STYLES.generic;
}

export function paperHouseStyleById(id: PaperHouseStyleId): PaperHouseStyle {
  return STYLES[id];
}

/** A question label taken apart: the question it belongs to, and which part of it this is. */
export type PaperQuestionNumber = {
  /** "1" for "01.2", "Question 1" or "1(b)(ii)"; null when the label is not numbered. */
  base: string | null;
  /** "2" for "01.2" (AQA numbers its parts), "(b)(ii)" for "1(b)(ii)", "" for a question with no parts. */
  part: string;
  numericPart: boolean;
  label: string;
};

export function parsePaperQuestionNumber(label: string): PaperQuestionNumber {
  const cleaned = label.replace(/^\s*(question|q)\s*/i, "").trim();
  const match = cleaned.match(/^0*(\d{1,3})\s*(.*)$/);
  if (!match) return { base: null, part: "", numericPart: false, label: cleaned || label };
  const base = match[1];
  const rest = match[2].trim();
  if (!rest) return { base, part: "", numericPart: false, label: cleaned };
  const numeric = rest.match(/^[.:]\s*0*(\d{1,2})$/);
  if (numeric) return { base, part: numeric[1], numericPart: true, label: cleaned };
  const letters = rest.match(/^\(?([a-z])\)?(?:\s*\(?([ivx]+)\)?)?$/i);
  if (letters) {
    const part = `(${letters[1].toLowerCase()})${letters[2] ? ` (${letters[2].toLowerCase()})` : ""}`;
    return { base, part, numericPart: false, label: cleaned };
  }
  if (/^(\([a-z0-9]+\)\s*)+$/i.test(rest)) {
    return { base, part: rest.replace(/\)\s*\(/g, ") ("), numericPart: false, label: cleaned };
  }
  return { base: null, part: "", numericPart: false, label: cleaned };
}

/**
 * The question number as this board would print it beside the question.
 *
 * AQA boxes each digit, and its caller draws the boxes; everyone else prints
 * the number on a question's first part and only the part's own letter on the
 * parts after it, the way "1 (a)" is followed by "(b)".
 */
export function printedQuestionNumber(
  style: PaperHouseStyle,
  number: PaperQuestionNumber,
  firstOfQuestion: boolean
): string {
  if (number.base === null) return number.label;
  if (style.boxedNumbers) {
    const base = number.base.padStart(2, "0");
    return number.numericPart ? `${base}.${number.part}` : number.part ? `${base} ${number.part}` : base;
  }
  // A numbered part stays numbered: the booklet and the marking screen must name the same question.
  if (number.numericPart) return `${number.base}.${number.part}`;
  const base = `${number.base}${style.numberStop ? "." : ""}`;
  if (!number.part) return base;
  if (!firstOfQuestion && !style.repeatQuestionNumber) return number.part;
  return `${base} ${number.part}`;
}

/** The marks as this board prints them, or null where the marks go in a column instead. */
export function printedTariff(style: PaperHouseStyle, marks: number): string {
  switch (style.tariff) {
    case "words":
      return `[${marks} ${marks === 1 ? "mark" : "marks"}]`;
    case "parenthesised":
      return `(${marks})`;
    case "column":
      return String(marks);
    default:
      return `[${marks}]`;
  }
}

/**
 * A prompt without the marks the generator wrote into it.
 *
 * The booklet prints each question's marks the board's way, and a prompt
 * ending "(5 marks)" then showed them twice -- "(5 marks)" in the question and
 * "(5)" beneath it. Only a trailing tariff equal to the question's own marks is
 * removed; any other number in brackets is part of the question.
 */
export function promptWithoutTariff(prompt: string, marks: number) {
  const trailing = /\s*[([]\s*(\d+)\s*(?:marks?)?\s*[)\]]\s*$/i.exec(prompt);
  return trailing && Number(trailing[1]) === marks ? prompt.slice(0, trailing.index).trimEnd() : prompt;
}

/** Pearson's running total after a question's last part. */
export function printedQuestionTotal(questionNumber: string, marks: number, maths: boolean) {
  return maths
    ? `(Total for Question ${questionNumber} is ${marks} ${marks === 1 ? "mark" : "marks"})`
    : `(Total for Question ${questionNumber} = ${marks} ${marks === 1 ? "mark" : "marks"})`;
}

export function printedEndOfPaper(style: PaperHouseStyle, totalMarks: number) {
  return style.endOfPaper.replace("{total}", String(totalMarks));
}

/** "Section A: Reading" as the board heads it. */
export function printedSectionHeading(style: PaperHouseStyle, section: string) {
  const heading = /^section\b/i.test(section) ? section : `Section ${section}`;
  return style.sectionHeading === "capitals"
    ? heading.replace(/^section\s+(\S+)/i, (_, letter: string) => `SECTION ${letter.toUpperCase()}`)
    : heading.replace(/^section\b/i, "Section");
}

/** "1 hour 45 minutes", the way a cover gives the time. */
export function printedDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [
    hours > 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "",
    rest > 0 ? `${rest} ${rest === 1 ? "minute" : "minutes"}` : "",
  ].filter(Boolean);
  return parts.join(" ") || `${minutes} minutes`;
}
