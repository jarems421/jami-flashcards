/**
 * What the ingestion model is asked for, and the rules it must follow.
 *
 * Kept apart from the ingestion service so the extraction contract can be read
 * and tested on its own. The service pulls in pdf.js, a native canvas and the
 * Firebase admin SDK; none of that has any bearing on whether the rules still
 * say the right thing, and a prompt that cannot be asserted on is a prompt
 * that silently drifts.
 */
import { servableExamSpecificationConcepts } from "@/lib/practice/exam-specification-concepts";
import { servableExamSpecificationTopics } from "@/lib/practice/exam-specification-topics";

/*
 * The response shape, as one valid JSON document.
 *
 * Two mistakes have been made here already and both cost a live run. First the
 * schema was `{"marking":"additive|pointPool|...",...}` -- a regime name and an
 * ellipsis -- and a real Edexcel paper came back with all 28 questions correct
 * and not one awardable mark point, because nothing said what a point is.
 * Then the field names were added but a sentence of instructions was glued on
 * the end of the object, which put prose inside the JSON example and dropped
 * extraction to zero questions.
 *
 * So: the example is a single valid JSON value and nothing else, built with
 * JSON.stringify so it cannot drift out of shape, and every instruction lives
 * in the prose after it.
 */
export const QUESTION_EXAMPLE = JSON.stringify({
  identity: { specificationId: "", componentCode: "", year: 0, series: "", paperReference: "" },
  questions: [{
    questionNumber: "3(a)",
    label: "Question 3 (a)",
    prompt: "the complete candidate-visible wording",
    marks: 3,
    questionPage: 1,
    schemePage: 1,
    difficulty: "easy|medium|hard",
    topicIds: [],
    conceptIds: [],
    commandWord: "",
  }],
}, null, 2);

export const SCHEME_EXAMPLE = JSON.stringify({
  schemes: [{
    questionNumber: "3(a)",
    schemeText: "the exact paired scheme text as printed",
    exampleAnswer: "an answer that would score full marks",
    markSchemeItem: {
      marking: "additive|pointPool|banded|weightedTraits|competency",
      answer: "the full correct answer",
      acceptableAlternatives: ["other wordings the scheme allows"],
      commonMistakes: ["what the scheme explicitly rejects"],
      awardable: 2,
      points: [{
        id: "m1",
        marks: 1,
        code: "M",
        text: "exactly what earns this mark, worded as the scheme words it",
        dep: [],
        ft: false,
        essentialTerms: [],
        allow: [],
        reject: [],
        expected: "the value or expression expected, for a quantitative mark",
      }],
      bands: [{ id: "L1", label: "Level 1", minMarks: 1, maxMarks: 2, descriptor: "band descriptor" }],
      traits: [{
        id: "AO1",
        label: "AO1",
        maxMarks: 6,
        bands: [{ id: "b1", label: "Level 1", minMarks: 1, maxMarks: 3, descriptor: "band descriptor" }],
      }],
    },
  }],
}, null, 2);

export const QUESTION_RULES = [
  "Return one JSON object of exactly that shape and nothing else.",
  "Include every question on the paper, including ones that depend on a figure.",
  "Use the exact question labels and tariffs printed on the paper.",
  "questionPage is the page the question is printed on; schemePage is the page of the mark scheme document that marks it.",
].join(" ");

/**
 * The topic ids this paper's specification actually names.
 *
 * Without this the model was asked for `topicIds` and never told what they
 * were, so it invented plausible-looking strings and `filterCanonicalTopicIds`
 * dropped every one of them -- which is why every question in the corpus is
 * stored with an empty list. A closed list costs nothing to send and is the
 * difference between the field working and the field being theatre.
 *
 * A specification with no checked catalogue says so plainly and asks for none,
 * rather than inviting guesses that are going to be discarded anyway.
 */
export function topicRulesFor(specificationId: string) {
  const catalogue = servableExamSpecificationTopics(specificationId);
  if (!catalogue) {
    return "Leave topicIds as an empty array: this specification has no checked topic list.";
  }
  const list = catalogue.topics.map((topic) => `${topic.id} (${topic.label})`).join("; ");
  return [
    "For topicIds choose only from this list, using the id exactly as written:",
    `${list}.`,
    "Give one or two ids per question, whichever the question genuinely tests.",
    "Never invent an id, and leave the array empty rather than guess.",
  ].join(" ");
}

/**
 * The concept ids this paper's specification names, one grain finer than its
 * topics and on the same terms: a closed, checked list or nothing at all.
 */
export function conceptRulesFor(specificationId: string) {
  const concepts = servableExamSpecificationConcepts(specificationId);
  if (concepts.length === 0) {
    return "Leave conceptIds as an empty array: this specification has no checked concept list.";
  }
  const list = concepts.map((concept) => `${concept.id} (${concept.label})`).join("; ");
  return [
    "For conceptIds choose only from this list, using the id exactly as written:",
    `${list}.`,
    "Give one or two ids per question, whichever the question genuinely tests.",
    "Never invent an id, and leave the array empty rather than guess.",
  ].join(" ");
}

/**
 * What the command word is.
 *
 * Copied, never inferred: extraction keeps it only when the question prints
 * it, so anything the model reasoned its way to would only be thrown away.
 */
export const COMMAND_WORD_RULES = [
  "commandWord is the command word or phrase the question's instruction opens with, copied exactly as printed: for example Calculate, Describe, Explain, Show that or Work out.",
  "Take it from the part being asked, not from a stem shared by several parts.",
  "Leave it as an empty string when the question gives no such instruction.",
].join(" ");

/*
 * What a scheme is allowed to lose on the way in: nothing.
 *
 * These rules used to say "for additive marking the points must add up to the
 * question tariff", which reads as an instruction to make the arithmetic come
 * out. Given 8300/1H question 9 -- "make two different criticisms of her
 * sketch", two marks, three criticisms AQA will accept -- the only way to obey
 * it is to drop one, and extraction did: two points, summing to two, passing
 * every check below. A student who gave the third criticism would have been
 * marked wrong against a scheme that accepts it.
 *
 * Nothing downstream can recover a point that was never extracted. The
 * normaliser reads three equal independent points on a two-mark question as a
 * pool of two, and the validator holds a real mismatch for review -- but both
 * only ever see what the model chose to write, which is why that conversion
 * has never once fired on the 101 schemes ingested so far.
 *
 * So the rules now ask for the scheme as printed, name the shapes that make a
 * total legitimately differ from its tariff, and leave a mismatch to be
 * reviewed rather than quietly resolved here.
 */
export const SCHEME_RULES = [
  "Return one JSON object of exactly that shape and nothing else.",
  "Use \"points\" for additive and pointPool marking, \"bands\" for banded marking, and \"traits\" for a question marked on separate weighted assessment objectives. Omit whichever do not apply.",
  "Write down every creditworthy point the scheme prints. Never drop, merge or shrink one to make a total match the tariff.",
  "Additive marking is for a scheme whose points are earned alongside one another, and its points add up to the tariff. awardable does not apply.",
  "pointPool marking is for a scheme offering more creditworthy points than the tariff can award: \"any two from\", or a question asking for two criticisms printed beside a list of three the scheme accepts. Give every listed point at equal value and set awardable to how many of them a student may be credited.",
  "Where the scheme allows a different route to the same mark, keep it in that point's own text and allow list. An alternative method is not an extra point.",
  "Where a mark can be earned only if another was earned, name the other point's id in dep.",
  "A mark printed in brackets after another, as in \"B2 for 4x + 3 (B1 for 4x or 3)\", is partial credit within that mark, not an extra one: write the bracketed condition as a point worth its own marks, then a point worth only the remaining marks for the full condition whose dep names the first, so the points add up to the tariff.",
  "If your points do not add up to the tariff and the question is not a pool, leave them exactly as the scheme prints them. Do not adjust the points or the tariff to make them agree.",
  "An essay or extended answer marked by levels is banded or weighted traits, never additive: its level descriptors are alternatives a whole answer is placed in, so never list them as points that add up to the tariff.",
  "Banded marking is one band per level, each carrying the mark range the scheme prints for it. The bands must meet without gaps or overlaps and cover every mark from 0 to the tariff, so include the scheme's own nothing-worthy-of-credit band, or add a band of 0 marks where the scheme starts its lowest level above 0.",
  "weightedTraits is for a scheme that marks separate assessment objectives, each with its own levels and its own maximum: AQA English Language question 5 prints 24 marks for content and organisation beside 16 marks for technical accuracy, and a modern languages writing question marks content separately from quality of language. Give one trait per objective, each with bands covering 0 to that objective's maximum, and the objectives' maxima must add up to the question's tariff.",
  "Read the tariff the question paper prints, including one printed as a sum: \"(24 marks for content and organisation, 16 marks for technical accuracy)\" beside \"[40 marks]\" is a 40-mark question of two traits, not a 24-mark one.",
  "Every question must carry at least one point, band or trait.",
  "code is M for method, A for accuracy, B for an independent mark, C for communication.",
  "Give one entry for each question number you were asked about, and no others.",
].join(" ");
