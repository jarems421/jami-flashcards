/**
 * The books and poems a literature student is actually studying.
 *
 * An English Literature paper is not one paper to the student sitting it. It
 * prints a question on every set text the specification offers -- six
 * Shakespeare plays, seven 19th-century novels -- and the student answers the
 * one on theirs. Drawing them a question on Jane Eyre when they studied
 * Macbeth is not a hard question; it is an unanswerable one.
 *
 * So a set text is a choice like a tier: a question carries the text it
 * belongs to, a folder's course carries the texts its student studies, and a
 * question whose text nobody chose is not theirs to practise. A question with
 * no set text at all -- unseen poetry, where there is nothing to have studied
 * -- belongs to everyone, exactly as an untiered question does.
 *
 * Nothing here is a topic. The skill being examined is the same whichever text
 * a student answers on, so these do not narrow what a student is practising,
 * only which questions can be put in front of them.
 */

export type ExamSetText = {
  /** Stable across versions: questions are stored against it. */
  id: string;
  /** The title, as the board lists it. */
  label: string;
  author?: string;
  /** The choice this text belongs to, which is how the paper groups them. */
  choice: string;
  /** The paper it is answered on, as the board numbers it. */
  componentCode: string;
  /** What the board says about its availability, where it says anything. */
  note?: string;
};

export type ExamSetTextCatalogue = {
  specificationId: string;
  version: number;
  /**
   * Checked against the published specification by a person. An unchecked list
   * offers a student nothing, the same as no list: a picker naming texts the
   * board does not set is worse than asking nobody.
   */
  verified: boolean;
  source: string;
  texts: readonly ExamSetText[];
};

function texts(
  specificationId: string,
  componentCode: string,
  choice: string,
  entries: ReadonlyArray<readonly [title: string, author?: string, note?: string]>
): ExamSetText[] {
  return entries.map(([label, author, note]) => ({
    id: `aqa-${specificationId}-${label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`,
    label,
    ...(author ? { author } : {}),
    choice,
    componentCode,
    ...(note ? { note } : {}),
  }));
}

export const EXAM_SET_TEXT_CATALOGUES: readonly ExamSetTextCatalogue[] = [
  {
    specificationId: "8702",
    version: 1,
    verified: true,
    source:
      "AQA GCSE English Literature (8702) specification sections 3.1.1, 3.1.2, 3.2.1 and 3.2.2, read " +
      "from the published PDF on 2026-09-16. Unseen poetry (3.2.3) sets no text and so has none here. " +
      "Read against the specification and accepted by the owner on 2026-09-17.",
    texts: [
      ...texts("8702", "1", "Shakespeare", [
        ["Macbeth"],
        ["Romeo and Juliet"],
        ["The Tempest"],
        ["The Merchant of Venice"],
        ["Much Ado About Nothing"],
        ["Julius Caesar"],
      ]),
      ...texts("8702", "1", "The 19th-century novel", [
        ["The Strange Case of Dr Jekyll and Mr Hyde", "Robert Louis Stevenson"],
        ["A Christmas Carol", "Charles Dickens"],
        ["Great Expectations", "Charles Dickens"],
        ["Jane Eyre", "Charlotte Brontë"],
        ["Frankenstein", "Mary Shelley"],
        ["Pride and Prejudice", "Jane Austen"],
        ["The Sign of Four", "Sir Arthur Conan Doyle"],
      ]),
      ...texts("8702", "2", "Modern texts", [
        ["An Inspector Calls", "JB Priestley"],
        ["Blood Brothers", "Willy Russell"],
        ["The History Boys", "Alan Bennett", "Last exam 2024"],
        ["DNA", "Dennis Kelly"],
        ["The Curious Incident of the Dog in the Night-Time", "Simon Stephens", "Last exam 2024"],
        ["A Taste of Honey", "Shelagh Delaney"],
        ["Princess & The Hustler", "Chinonyerem Odimba", "First exam 2025"],
        ["Leave Taking", "Winsome Pinnock", "First exam 2025"],
        ["Lord of the Flies", "William Golding"],
        ["Telling Tales", "AQA Anthology"],
        ["Animal Farm", "George Orwell"],
        ["Never Let Me Go", "Kazuo Ishiguro", "Last exam 2024"],
        ["Anita and Me", "Meera Syal"],
        ["Pigeon English", "Stephen Kelman"],
        ["My Name is Leon", "Kit de Waal", "First exam 2025"],
      ]),
      ...texts("8702", "2", "Poetry anthology", [
        ["Love and Relationships"],
        ["Power and Conflict"],
        ["Worlds and Lives", undefined, "First exam 2025"],
      ]),
    ],
  },
];

export function examSetTextCatalogue(specificationId: string) {
  return EXAM_SET_TEXT_CATALOGUES.find((catalogue) => catalogue.specificationId === specificationId);
}

/** The texts a student may be offered: only from a checked list. */
export function servableExamSetTexts(specificationId: string): readonly ExamSetText[] {
  const catalogue = examSetTextCatalogue(specificationId);
  return catalogue?.verified ? catalogue.texts : [];
}

/** Whether this course sets texts at all, which is what decides whether to ask. */
export function specificationSetsTexts(specificationId: string) {
  return servableExamSetTexts(specificationId).length > 0;
}

/**
 * The ids a student's course may claim, separated from the ones it invented.
 *
 * The same treatment topics get, and for the same reason: an id the catalogue
 * does not hold is not a near miss to be corrected, it is a text this course
 * does not set.
 */
export function filterCanonicalSetTextIds(specificationId: string, ids: readonly string[]) {
  const known = new Set(servableExamSetTexts(specificationId).map((text) => text.id));
  const setTextIds: string[] = [];
  const rejected: string[] = [];
  for (const id of ids) {
    if (known.has(id) && !setTextIds.includes(id)) setTextIds.push(id);
    else if (!known.has(id)) rejected.push(id);
  }
  return { setTextIds, rejected };
}

/** Punctuation and case differ between a paper's header and a specification's table. */
function comparable(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The set text a question's own heading names.
 *
 * A Literature paper prints it above the question -- "Arthur Conan Doyle: The
 * Sign of Four", "Macbeth" -- so the text is read from the paper rather than
 * guessed from the wording. Matched against the catalogue, because a title
 * read loosely is a question filed under a text that does not exist.
 */
export function matchSetTextIn(
  candidates: readonly ExamSetText[],
  printed: string
): ExamSetText | undefined {
  const needle = comparable(printed);
  if (!needle) return undefined;
  const exact = candidates.find((text) => comparable(text.label) === needle);
  if (exact) return exact;
  // "Arthur Conan Doyle: The Sign of Four" carries the author as well as the title.
  return candidates.find((text) => {
    const title = comparable(text.label);
    return title.length >= 4 && needle.includes(title);
  });
}

/** The same, against the texts this course may actually offer. */
export function matchExamSetText(specificationId: string, printed: string): ExamSetText | undefined {
  return matchSetTextIn(servableExamSetTexts(specificationId), printed);
}

/**
 * The one text a passage names, or nothing.
 *
 * `matchSetTextIn` reads a heading, where whatever it finds is the answer. This
 * reads a body of text that was never meant to name one thing -- a question's
 * wording, or a whole region of a page -- and there the first match is not
 * good enough. A page carrying two titles is a page that does not say which
 * question is about which, and filing the question under either would hide it
 * from half the students who study it. Silence is recoverable; a wrong text is
 * not, because nobody would think to look for it.
 */
export function uniqueSetTextIn(
  candidates: readonly ExamSetText[],
  passage: string
): ExamSetText | undefined {
  const needle = comparable(passage);
  if (!needle) return undefined;
  const found = candidates.filter((text) => {
    const title = comparable(text.label);
    return title.length >= 4 && needle.includes(title);
  });
  if (found.length === 1) return found[0];
  /*
   * Several titles, but all of them the same text: the catalogue can hold one
   * work under more than one entry when two components set it, and that is not
   * an ambiguity about which book the question is about.
   */
  const labels = new Set(found.map((text) => comparable(text.label)));
  return labels.size === 1 ? found[0] : undefined;
}

/** The same, against the texts this course may actually offer. */
export function uniqueExamSetText(specificationId: string, passage: string) {
  return uniqueSetTextIn(servableExamSetTexts(specificationId), passage);
}
