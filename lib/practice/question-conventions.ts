import type { PracticePaperAssessmentProfile } from "@/lib/practice/practice-papers";
import { paperHouseStyle, type PaperHouseStyleId } from "@/lib/practice/paper-house-style";

/**
 * How examiners expect each kind of question to be answered.
 *
 * A mark scheme says what earns marks on one question. It rarely says the
 * things every examiner of that board already knows about that kind of
 * question: that an AQA Geography 9-marker cannot reach its top level without
 * a supported judgement, that an Edexcel History "explain why" needs knowledge
 * beyond its two stimulus points, that feature-spotting in an English language
 * question caps at "some understanding", that an SQA History "how fully"
 * answer earns most of its marks from what the source leaves out. A marker
 * without that practice marks the words in front of it and misses the shape
 * the answer was meant to have; a generator without it writes questions no
 * board would print.
 *
 * So each entry names one kind of question -- a board, a subject, a tariff, a
 * command word -- and says what a full answer does, how examiners decide its
 * marks, and how answers usually lose them. It is examiner practice, never a
 * replacement for the scheme: wherever the two differ, the scheme decides.
 *
 * Tariffs and splits are stated only where the board publishes them and they
 * are certain (AQA's 9 + 3 SPaG, 16 + 4 SPaG, AO5 24 + AO6 16; SQA's essay grid,
 * read from its 2022 marking instructions). Everything else is phrased as the
 * practice of the command word, which holds across boards.
 */

export type QuestionLevel = "gcse" | "alevel" | "scottish" | "other";

export type QuestionConvention = {
  id: string;
  /** Leave unset for practice that holds across boards. */
  board?: PaperHouseStyleId;
  subject: RegExp;
  level?: QuestionLevel;
  /** Exact tariffs this applies to. */
  marks?: readonly number[];
  /** The smallest tariff this applies to, where exact tariffs would be too narrow. */
  minMarks?: number;
  /** The largest, for short kinds such as describing a figure. */
  maxMarks?: number;
  /** Words in the question that identify the kind: command words, stems. */
  prompt?: RegExp;
  title: string;
  /** What a full-mark answer does. */
  answerShape: string;
  /** How examiners decide the mark. */
  examinerRules: readonly string[];
  /** The commonest ways answers lose marks here, for feedback. */
  pitfalls: readonly string[];
};

const ENGLISH_LANGUAGE = /english language/i;
const ENGLISH_LITERATURE = /english literature|english lit\b/i;
const HISTORY = /\bhistory\b/i;
const GEOGRAPHY = /\bgeography\b/i;
const ECONOMICS = /\beconomics\b/i;
const BUSINESS = /\bbusiness\b/i;
const PSYCHOLOGY = /\bpsychology\b/i;
const SOCIOLOGY = /\bsociology\b/i;
const RELIGIOUS = /religious|\brs\b|philosophy and ethics/i;
const SCIENCE = /\b(biology|chemistry|physics|science|trilogy|synergy)\b/i;
const ANY = /./;

const EVALUATIVE = /\b(evaluate|assess|to what extent|how far|discuss|justify|how valid|do you agree)\b/i;

export const QUESTION_CONVENTIONS: readonly QuestionConvention[] = [
  // ---------------------------------------------------------------- AQA GCSE English Language (8700)
  {
    id: "aqa-gcse-eng-lang-language",
    board: "aqa",
    subject: ENGLISH_LANGUAGE,
    level: "gcse",
    marks: [8, 12],
    prompt: /how does the writer use language/i,
    title: "AQA English Language: language analysis (Paper 1 Q2, 8 marks; Paper 2 Q3, 12 marks)",
    answerShape:
      "Analyses how specific language choices -- words and phrases, techniques, sentence forms -- create effects, using short, well-chosen quotations and subject terminology that serves the point being made.",
    examinerRules: [
      "The top level is 'detailed and perceptive analysis' of effects; 'clear explanation' of effects is the level below; commenting on effects without explaining them is lower still.",
      "Naming a technique earns nothing on its own: credit goes to what the choice does and how. Feature-spotting with thin comment stays at 'some understanding' however many features are named.",
      "A few well-analysed examples outrank many surface ones; depth decides the level, not coverage.",
      "Comments on structure are not credited in this question.",
    ],
    pitfalls: [
      "Naming techniques ('the writer uses a metaphor') without saying what effect the specific words create.",
      "Generic effects ('it makes the reader want to read on') that could be said of any text.",
      "Long quotations, where one word or phrase analysed closely would do more.",
    ],
  },
  {
    id: "aqa-gcse-eng-lang-structure",
    board: "aqa",
    subject: ENGLISH_LANGUAGE,
    level: "gcse",
    marks: [8],
    prompt: /structure|structured|focus your attention|changes this focus/i,
    title: "AQA English Language: structure (Paper 1 Q3, 8 marks)",
    answerShape:
      "Tracks how the whole text is built -- what the opening focuses on, how and why the focus shifts, how the ending relates to the start -- and explains the effect of those choices on the reader.",
    examinerRules: [
      "Structure means the organisation of the whole text and its parts: openings, shifts in focus, perspective, time, repetition of motifs, endings. Sentence-level structure counts only where it serves this.",
      "Analysis of language features earns nothing here.",
      "The top level analyses the effects of structural choices perceptively across the whole text; describing what happens in order is summary, not analysis, and stays low.",
    ],
    pitfalls: [
      "Retelling the extract in order instead of analysing why it is ordered that way.",
      "Analysing words and imagery, which belongs to the language question.",
      "Covering only the opening and never the shift or the ending.",
    ],
  },
  {
    id: "aqa-gcse-eng-lang-evaluation",
    board: "aqa",
    subject: ENGLISH_LANGUAGE,
    level: "gcse",
    marks: [20],
    prompt: /to what extent do you agree|evaluate/i,
    title: "AQA English Language: critical evaluation (Paper 1 Q4, 20 marks)",
    answerShape:
      "Engages directly with the statement, says how far the student agrees, and evaluates how the writer's methods create the impressions discussed, supported by judicious references.",
    examinerRules: [
      "The top level is 'perceptive, detailed critical evaluation': it evaluates effects, explains the writer's methods convincingly and develops a considered response to the statement.",
      "An answer that analyses methods without engaging with the statement, or agrees without examining methods, does not reach the top levels.",
      "The student's own interpretation is credited where it is supported by the text.",
    ],
    pitfalls: [
      "Ignoring the statement and writing a language analysis.",
      "Agreeing in a sentence and never evaluating how the writer achieves the effect.",
    ],
  },
  {
    id: "aqa-gcse-eng-lang-summary",
    board: "aqa",
    subject: ENGLISH_LANGUAGE,
    level: "gcse",
    marks: [8],
    prompt: /summary of the differences|summary of the similarities|write a summary/i,
    title: "AQA English Language: synthesis summary (Paper 2 Q2, 8 marks)",
    answerShape:
      "Makes clear inferences about the differences (or similarities) the question names, drawing evidence from both sources and synthesising them into points of comparison.",
    examinerRules: [
      "Credit is for inferences and synthesis across both sources; the top level is perceptive inference with judicious references from both texts.",
      "Language analysis is not credited in this question.",
      "An answer drawing on one source only cannot reach the upper levels.",
    ],
    pitfalls: [
      "Analysing language instead of inferring meaning.",
      "Writing about each source separately with no comparison.",
      "Quoting without saying what the quotation shows.",
    ],
  },
  {
    id: "aqa-gcse-eng-lang-compare",
    board: "aqa",
    subject: ENGLISH_LANGUAGE,
    level: "gcse",
    marks: [16],
    prompt: /compare how the writers|different perspectives|compare/i,
    title: "AQA English Language: comparing perspectives (Paper 2 Q4, 16 marks)",
    answerShape:
      "Compares the writers' ideas and perspectives and analyses how their methods convey them, with references from both sources and comparison sustained through the answer.",
    examinerRules: [
      "The top level compares ideas and perspectives perceptively and analyses how the writers' methods convey them.",
      "Both the perspectives and the methods are needed; either alone caps the level.",
      "Comparison must be explicit and sustained, not two separate accounts.",
    ],
    pitfalls: [
      "Comparing what happens in each source rather than the writers' attitudes.",
      "Leaving methods out entirely, or analysing methods with no link to perspective.",
    ],
  },
  {
    id: "aqa-gcse-eng-lang-writing",
    board: "aqa",
    subject: ENGLISH_LANGUAGE,
    level: "gcse",
    marks: [40],
    title: "AQA English Language: extended writing (Q5, 40 marks)",
    answerShape:
      "A complete piece matched to form, purpose and audience: crafted structure, deliberate vocabulary and varied sentences, controlled paragraphs, and accurate spelling and punctuation.",
    examinerRules: [
      "Content and organisation (AO5) is 24 marks and technical accuracy (AO6) is 16; they are judged separately and added.",
      "Content and organisation rewards tone, style and register matched to purpose and audience, and structural features used for effect; ambition is rewarded even where accuracy slips.",
      "Technical accuracy rewards sentence demarcation, a range of punctuation, varied sentence forms, spelling of ambitious vocabulary and Standard English.",
    ],
    pitfalls: [
      "Ignoring the stated form or audience (a letter with no letter conventions, a speech with no address to its audience).",
      "An unplanned piece that runs out of structure halfway through.",
      "Comma splicing and unmarked sentence boundaries, which hold technical accuracy down.",
    ],
  },
  // ---------------------------------------------------------------- AQA GCSE English Literature (8702)
  {
    id: "aqa-gcse-eng-lit-essay",
    board: "aqa",
    subject: ENGLISH_LITERATURE,
    level: "gcse",
    marks: [30, 34],
    title: "AQA English Literature: essay (30 marks, +4 for spelling, punctuation and grammar on Shakespeare and the modern text)",
    answerShape:
      "A critical, conceptualised argument answering the question, supported by well-chosen references, analysing the writer's methods and their effects, with context woven into the argument.",
    examinerRules: [
      "AO1 (response and references), AO2 (methods and effects) and AO3 (context) are judged together in levels; the top level is a critical, exploratory, conceptualised response.",
      "Context earns credit only where it illuminates the text and the question; bolted-on history does not.",
      "Where 4 marks are awarded for spelling, punctuation and grammar (AO4) they are judged separately.",
    ],
    pitfalls: [
      "Retelling the plot instead of arguing a view.",
      "Paragraphs of context unconnected to the question.",
      "Writing about the extract only, where the question asks about the whole text.",
    ],
  },
  // ---------------------------------------------------------------- A-level English Literature essays
  {
    id: "alevel-eng-lit-essay",
    subject: ENGLISH_LITERATURE,
    level: "alevel",
    minMarks: 20,
    title: "A-level English Literature essay (typically 25 marks)",
    answerShape:
      "An argued response that debates the proposition, grounded in close analysis of methods, moving between the extract (where set) and the whole text, and engaging with context and with other readings.",
    examinerRules: [
      "The assessment objectives are judged together: a coherent argument (AO1), analysis of how meanings are shaped (AO2), significance of contexts (AO3), connections across texts where asked (AO4), and different interpretations (AO5).",
      "Where the question says 'starting with this extract' or 'in the play as a whole', an answer confined to the extract cannot reach the top levels.",
      "The question's proposition must be debated -- agreed with, qualified or challenged -- not simply illustrated.",
      "Top levels are for perceptive, critical, well-integrated argument; a sound answer that lists methods reaches the middle levels.",
    ],
    pitfalls: [
      "Illustrating the proposition without testing it.",
      "Staying inside the extract when the question asks about the whole text.",
      "Critics quoted as decoration rather than argued with.",
    ],
  },
  // ---------------------------------------------------------------- History
  {
    id: "aqa-gcse-history-16",
    board: "aqa",
    subject: HISTORY,
    level: "gcse",
    marks: [16, 20],
    prompt: /how far do you agree|how far|to what extent/i,
    title: "AQA GCSE History: 'How far do you agree?' (16 marks, +4 for spelling, punctuation and grammar)",
    answerShape:
      "Explains the stated factor and at least one other factor with precise supporting knowledge, then reaches a substantiated judgement about their relative importance.",
    examinerRules: [
      "Four levels: the top level is a complex explanation of the stated factor and other factors, with a sustained judgement.",
      "An answer that covers only the stated factor cannot reach the top levels.",
      "Knowledge must be precise and used to support explanation; description alone stays in the lower levels.",
      "The 4 marks for spelling, punctuation and grammar and specialist terms are judged separately.",
    ],
    pitfalls: [
      "Writing only about the factor in the question.",
      "Describing events without explaining how they caused the outcome.",
      "A conclusion that restates the essay instead of weighing the factors.",
    ],
  },
  {
    id: "pearson-gcse-history-describe-two",
    board: "pearson",
    subject: HISTORY,
    level: "gcse",
    marks: [4],
    prompt: /describe two features/i,
    title: "Edexcel GCSE History: 'Describe two features' (4 marks)",
    answerShape: "Two features, each identified and then supported with one specific detail.",
    examinerRules: [
      "Each feature earns 1 mark for identifying it and 1 for supporting information: 2 + 2.",
      "Explanation is not needed; accuracy and specificity are.",
    ],
    pitfalls: ["Two features with no supporting detail.", "Two points that are the same feature restated."],
  },
  {
    id: "pearson-gcse-history-explain-why",
    board: "pearson",
    subject: HISTORY,
    level: "gcse",
    marks: [12],
    prompt: /explain why/i,
    title: "Edexcel GCSE History: 'Explain why' (12 marks)",
    answerShape:
      "Explains several causes, each developed with accurate knowledge and linked to the outcome; uses the stimulus points and goes beyond them.",
    examinerRules: [
      "The top levels need analytical explanation of causes, with knowledge that goes beyond the stimulus points.",
      "An answer using only the stimulus points is capped below the top level.",
      "Narrative without causal explanation stays in the lower levels.",
    ],
    pitfalls: ["Using only the two stimulus bullets.", "Describing what happened without saying why it led to the outcome."],
  },
  {
    id: "pearson-gcse-history-how-far",
    board: "pearson",
    subject: HISTORY,
    level: "gcse",
    marks: [16, 20],
    prompt: /how far do you agree/i,
    title: "Edexcel GCSE History: 'How far do you agree?' (16 marks, +4 for spelling, punctuation and grammar)",
    answerShape:
      "Explains the case for and against the statement with accurate knowledge beyond the stimulus points, then reaches a judgement with a clear criterion.",
    examinerRules: [
      "The top level needs analytical explanation, knowledge beyond the stimulus points, and an overall judgement justified by a stated criterion.",
      "A one-sided answer, or one confined to the stimulus points, cannot reach the top level.",
    ],
    pitfalls: ["A judgement asserted without a reason.", "Only the stimulus points, with no knowledge of the student's own."],
  },
  {
    id: "any-history-source-utility",
    subject: HISTORY,
    minMarks: 4,
    prompt: /how useful|usefulness/i,
    title: "History: usefulness of a source",
    answerShape:
      "Judges usefulness for the stated enquiry using the source's content, its provenance (author, date, purpose, audience, nature) and the student's own contextual knowledge.",
    examinerRules: [
      "Usefulness is judged for the enquiry named in the question, not in general.",
      "Content and provenance are both needed; the top levels test the source's content against contextual knowledge.",
      "Generic provenance ('it is biased so it is not useful') earns little; the effect of provenance on this source's usefulness must be explained.",
    ],
    pitfalls: [
      "Describing the source instead of judging it.",
      "Calling a source unreliable because it is biased, without saying why that limits its use for this enquiry.",
    ],
  },
  {
    id: "sqa-history-essay",
    board: "sqa",
    subject: HISTORY,
    marks: [22],
    title: "SQA Higher History essay (22 marks)",
    answerShape:
      "An introduction setting out context and factors, paragraphs of developed knowledge each with analysis and evaluation, and a conclusion giving a relative overall judgement with reasons.",
    examinerRules: [
      "Marked on a grid, not a level: historical context 3, use of knowledge 6, analysis 6, evaluation 4, conclusion 3.",
      "Context needs two points of background and the key factors, connected to the line of argument, for 3.",
      "A knowledge mark needs a relevant point that is developed and used to answer the question; a point repeated earns nothing twice.",
      "The conclusion earns its 3 only with a relative judgement between factors and a reason for it.",
    ],
    pitfalls: [
      "Paragraphs of knowledge with no analysis linking them to the question.",
      "A conclusion that summarises instead of ranking the factors.",
      "An introduction with factors but no background.",
    ],
  },
  {
    id: "sqa-history-how-fully",
    board: "sqa",
    subject: HISTORY,
    marks: [10],
    prompt: /how fully/i,
    title: "SQA Higher History: 'How fully does Source … explain …' (10 marks)",
    answerShape:
      "Interprets what the source shows, then uses recalled knowledge to show what it leaves out, and judges how fully it explains the issue.",
    examinerRules: [
      "At most 4 marks for points interpreted from the source (interpreted, not copied), at most 7 for points of significant omission from recall.",
      "An answer that makes no judgement is capped at 2.",
    ],
    pitfalls: ["Copying the source instead of interpreting it.", "No omissions from the student's own knowledge.", "No judgement on how fully."],
  },
  {
    id: "sqa-history-differing-interpretations",
    board: "sqa",
    subject: HISTORY,
    marks: [10],
    prompt: /differing interpretations|how much do sources/i,
    title: "SQA Higher History: 'How much do Sources … reveal about differing interpretations' (10 marks)",
    answerShape:
      "States the overall viewpoint of each source, interprets the points each makes, and uses recalled knowledge to assess what they reveal about the differing interpretations.",
    examinerRules: [
      "Each source's overall viewpoint is credited, then interpreted points from each source, then relevant recalled knowledge.",
      "Points must be interpreted, not copied.",
    ],
    pitfalls: ["No overall viewpoint for a source.", "Recall that is not connected to the interpretations."],
  },
  {
    id: "sqa-history-usefulness",
    board: "sqa",
    subject: HISTORY,
    marks: [8],
    prompt: /evaluate the usefulness/i,
    title: "SQA Higher History: 'Evaluate the usefulness of Source …' (8 marks)",
    answerShape:
      "Evaluates the source's usefulness through its author, type, purpose and timing, the content it offers, and what significant points it omits.",
    examinerRules: [
      "Credit comes from provenance comments (author, type, purpose, timing), interpreted content, and significant omission from recall.",
      "Each comment must be evaluative: how it affects usefulness, not simply what it is.",
    ],
    pitfalls: ["Stating the author and date without saying how they affect usefulness.", "No omissions."],
  },
  {
    id: "sqa-history-explain-reasons",
    board: "sqa",
    subject: HISTORY,
    marks: [8],
    prompt: /explain the reasons/i,
    title: "SQA Higher History: 'Explain the reasons' (8 marks)",
    answerShape: "A number of key reasons, each made plain by showing connections or causal relationships.",
    examinerRules: ["Reasons need to be explained, not listed; the student does not need to evaluate or prioritise them."],
    pitfalls: ["A list of events with no causal link to the outcome."],
  },
  // ---------------------------------------------------------------- Geography
  {
    id: "aqa-gcse-geography-9",
    board: "aqa",
    subject: GEOGRAPHY,
    level: "gcse",
    marks: [9, 12],
    title: "AQA GCSE Geography: 9-mark extended answer (+3 for spelling, punctuation and grammar where shown)",
    answerShape:
      "A developed, balanced argument that uses place-specific detail from a named example or case study where asked, and ends in a conclusion that answers the question and is supported by the argument.",
    examinerRules: [
      "Three levels: 1-3, 4-6, 7-9. Level 3 needs thorough, detailed and well-developed points and a clear, supported judgement.",
      "An 'assess', 'evaluate', 'discuss' or 'to what extent' question cannot reach Level 3 without a conclusion that weighs the evidence.",
      "Where a case study or example is asked for, generic points without place-specific detail -- names, figures, dates -- are capped below Level 3.",
      "Where a figure is referenced, it must be used.",
      "The 3 marks for spelling, punctuation and grammar and specialist terms are judged separately where the question carries them.",
    ],
    pitfalls: [
      "No conclusion, or a conclusion that does not answer 'to what extent'.",
      "A case study with no facts: 'lots of people were affected' instead of numbers and places.",
      "One-sided answers to an 'evaluate' question.",
    ],
  },
  {
    id: "aqa-gcse-geography-6",
    board: "aqa",
    subject: GEOGRAPHY,
    level: "gcse",
    marks: [6],
    title: "AQA GCSE Geography: 6-mark answer",
    answerShape: "Two or three well-developed points, each extended with reasons or evidence, and a judgement where the command word asks for one.",
    examinerRules: [
      "Three levels: 1-2, 3-4, 5-6. The top level needs thorough, developed points; where the command word is evaluative, a supported judgement.",
      "Where a figure is referenced, the answer must use evidence from it.",
    ],
    pitfalls: ["Several undeveloped points instead of a few developed ones.", "Ignoring the figure."],
  },
  {
    id: "aqa-gcse-geography-4",
    board: "aqa",
    subject: GEOGRAPHY,
    level: "gcse",
    marks: [4],
    prompt: /explain|suggest/i,
    title: "AQA GCSE Geography: 4-mark 'explain' or 'suggest'",
    answerShape: "Two developed points, or one point developed into an extended chain of reasoning ('because… which means… so…').",
    examinerRules: [
      "Two levels: 1-2 for basic points, 3-4 for clear, developed explanation.",
      "A list of undeveloped points stays in Level 1 however long it is.",
    ],
    pitfalls: ["Four one-word reasons.", "Describing instead of explaining."],
  },
  {
    id: "any-geography-describe-figure",
    subject: GEOGRAPHY,
    maxMarks: 4,
    prompt: /\bdescribe\b.*\b(figure|map|graph|distribution|pattern|trend)|\b(figure|map|graph)\b.*\bdescribe\b/i,
    title: "Geography: describing a figure",
    answerShape: "States the overall pattern or trend, supports it with specific data read from the figure (with units), and notes any anomaly.",
    examinerRules: [
      "Credit goes to accurate description with evidence from the figure; reasons are not required and earn nothing in a 'describe' question.",
      "Quoted data must be read correctly, with units.",
    ],
    pitfalls: ["Explaining why instead of describing what.", "No figures quoted from the resource.", "Missing the anomaly."],
  },
  // ---------------------------------------------------------------- Economics and Business
  {
    id: "aqa-alevel-economics-25",
    board: "aqa",
    subject: ECONOMICS,
    level: "alevel",
    marks: [25],
    title: "AQA A-level Economics: 25-mark evaluative essay",
    answerShape:
      "Defines the key terms, applies them to the context, builds developed chains of analysis -- with correctly labelled diagrams where they help -- and evaluates throughout, reaching a supported judgement.",
    examinerRules: [
      "Five levels: 1-5, 6-10, 11-15, 16-20, 21-25. The top levels need well-developed analysis and well-focused, supported evaluation leading to a justified conclusion.",
      "Evaluation is more than 'however': it weighs magnitude, time frame, assumptions, who is affected and what the outcome depends on.",
      "A diagram earns credit when it is accurate, fully labelled and explained in the text; an unexplained diagram adds little.",
      "Where data or an extract is provided, the answer must use it.",
    ],
    pitfalls: [
      "Analysis that stops after one step ('prices rise') instead of following the chain to the outcome.",
      "A conclusion that sits on the fence without saying what the answer depends on.",
      "Diagrams with unlabelled axes or unexplained shifts.",
    ],
  },
  {
    id: "aqa-alevel-economics-15",
    board: "aqa",
    subject: ECONOMICS,
    level: "alevel",
    marks: [15],
    title: "AQA A-level Economics: 15-mark analytical essay",
    answerShape: "Explains the issue with accurate knowledge, applied to the context, through developed chains of analysis, using a diagram where it helps.",
    examinerRules: [
      "Rewards knowledge, application and analysis; evaluation is not required for full marks.",
      "Depth of analysis decides the level: logical, developed chains of reasoning at the top.",
    ],
    pitfalls: ["Spending the answer on evaluation that earns nothing here while the analysis stays shallow."],
  },
  {
    id: "any-economics-extended",
    subject: ECONOMICS,
    minMarks: 8,
    title: "Economics: extended answer",
    answerShape:
      "Knowledge of the relevant concepts, applied to the context or data given, analysed through developed chains of reasoning; where the command word is evaluative, evaluation leading to a judgement.",
    examinerRules: [
      "Knowledge, application and analysis are rewarded together; where the scheme gives evaluation marks separately they need developed evaluation, not a stock phrase.",
      "Application means using the case, extract or data provided, not general knowledge.",
      "Diagrams earn credit when accurate, labelled and referred to in the text.",
    ],
    pitfalls: [
      "Theory with no reference to the extract or data.",
      "One-step analysis that never reaches the outcome asked about.",
      "Evaluation that only says 'it depends' without saying on what.",
    ],
  },
  {
    id: "any-business-extended",
    subject: BUSINESS,
    minMarks: 6,
    title: "Business: extended answer",
    answerShape:
      "Uses the case study throughout, develops chains of reasoning about the business's situation, and -- where the command word asks for a decision or evaluation -- reaches a justified recommendation.",
    examinerRules: [
      "Application to the named business and its data is essential; generic answers are capped low.",
      "Analysis needs connected chains of reasoning, not listed points.",
      "'Justify', 'evaluate' and 'recommend' require a decision with a reason that weighs the alternatives.",
    ],
    pitfalls: ["Answering about businesses in general.", "A recommendation that does not say why it beats the alternative."],
  },
  // ---------------------------------------------------------------- Psychology and Sociology
  {
    id: "aqa-alevel-psychology-16",
    board: "aqa",
    subject: PSYCHOLOGY,
    level: "alevel",
    marks: [16],
    title: "AQA A-level Psychology: 16-mark extended answer",
    answerShape:
      "Accurate, detailed description (AO1) and effective evaluation (AO3), each evaluation point identified, evidenced, explained and linked back to the theory; application to the stem where there is one.",
    examinerRules: [
      "Four levels: 1-4, 5-8, 9-12, 13-16. For 'discuss' and 'outline and evaluate' the split is 6 marks description and 10 evaluation.",
      "Evaluation earns credit when it is explained -- why the point is a strength or limitation and what it means for the theory -- not merely stated.",
      "Where the question refers to a scenario, answers that ignore it lose the application marks.",
    ],
    pitfalls: [
      "Long description with thin evaluation, when evaluation carries most of the marks.",
      "Evaluation points stated but not explained ('this lacks ecological validity').",
      "Ignoring the scenario in the stem.",
    ],
  },
  {
    id: "any-sociology-item",
    subject: SOCIOLOGY,
    minMarks: 10,
    prompt: /applying material from item/i,
    title: "Sociology: 'Applying material from Item …'",
    answerShape: "Uses the item's hooks explicitly, develops sociological arguments and evidence from them, and -- for evaluate questions -- weighs competing views to a conclusion.",
    examinerRules: [
      "The top band requires explicit, developed use of the item.",
      "Arguments must be developed with sociological concepts, studies or evidence.",
    ],
    pitfalls: ["Never referring to the item.", "Listing sociologists without developing their arguments."],
  },
  // ---------------------------------------------------------------- Religious Studies
  {
    id: "aqa-gcse-rs-12",
    board: "aqa",
    subject: RELIGIOUS,
    level: "gcse",
    marks: [12, 15],
    prompt: /evaluate this statement/i,
    title: "AQA GCSE Religious Studies: 'Evaluate this statement' (12 marks, +3 for spelling, punctuation and grammar where shown)",
    answerShape:
      "Reasoned arguments for and against the statement, including religious arguments with references to teaching, developed into logical chains, and a justified conclusion.",
    examinerRules: [
      "The top level needs well-argued perspectives on both sides, logical chains of reasoning, relevant religious teaching, and a reasoned judgement.",
      "An answer without religious arguments cannot reach the top levels.",
    ],
    pitfalls: ["No religious teaching.", "A conclusion that picks a side without a reason."],
  },
  {
    id: "aqa-gcse-rs-contrasting",
    board: "aqa",
    subject: RELIGIOUS,
    level: "gcse",
    marks: [4, 5],
    prompt: /explain two/i,
    title: "AQA GCSE Religious Studies: 'Explain two' (4 or 5 marks)",
    answerShape: "Two beliefs or ways, each stated and then developed; for 5 marks, a reference to sacred writings or another source of religious teaching.",
    examinerRules: [
      "Each point earns 1 for a simple explanation and 2 for a detailed one.",
      "In the 5-mark version the fifth mark needs a relevant reference to scripture or religious teaching.",
    ],
    pitfalls: ["Two points that are not contrasting where the question asks for contrasting beliefs.", "No source of authority on the 5-mark question."],
  },
  // ---------------------------------------------------------------- Sciences
  {
    id: "any-gcse-science-6",
    subject: SCIENCE,
    level: "gcse",
    marks: [6],
    title: "GCSE science: 6-mark extended response",
    answerShape:
      "A coherent, logically ordered answer that covers the key scientific points in the indicative content, with correct terminology; for a method, steps in order with the variables controlled and measurements stated.",
    examinerRules: [
      "Three levels: 1-2, 3-4, 5-6, judged on the scientific content and how coherently it is linked, using the indicative content as a guide, not a checklist.",
      "'Describe a method' needs a sequence that could be followed: equipment, what is measured and how, what is kept the same, repeats.",
      "'Evaluate' and 'compare' need both sides -- advantages and disadvantages, similarities and differences -- and an evaluation needs a justified conclusion.",
      "'Explain' needs reasons linked by cause and effect, not a list of facts.",
    ],
    pitfalls: [
      "Listing facts without linking cause to effect.",
      "A method that misses control variables or how the measurement is taken.",
      "One-sided comparisons.",
    ],
  },
  {
    id: "sqa-science-open",
    board: "sqa",
    subject: SCIENCE,
    marks: [3],
    prompt: /using your knowledge of (chemistry|physics|biology)/i,
    title: "SQA open-ended question (3 marks)",
    answerShape: "Shows understanding of the science behind the situation: the principles involved, a relationship or equation, and their application to the problem.",
    examinerRules: [
      "3 for good understanding, 2 for reasonable, 1 for limited, 0 for none or for restating the question.",
      "The answer does not need to be excellent or complete for 3: good comprehension and a logically correct response to the problem earns it.",
      "Any valid approach is credited; there is no required list of points.",
    ],
    pitfalls: ["Restating information from the question.", "Correct facts that never address the problem posed."],
  },
  // ---------------------------------------------------------------- Across boards, by command word
  {
    id: "any-evaluative-extended",
    subject: ANY,
    minMarks: 6,
    prompt: EVALUATIVE,
    title: "Extended evaluative answer",
    answerShape: "Develops more than one side or factor, weighs them, and ends with a judgement that answers the question and is supported by the argument.",
    examinerRules: [
      "The top level needs a supported judgement; an answer without one is capped below it, however good the rest.",
      "Balance is needed where the question invites it; weighing is needed where it asks 'how far' or 'to what extent'.",
    ],
    pitfalls: ["No conclusion.", "A conclusion that is not supported by what came before."],
  },
];

export type QuestionConventionContext = {
  profile?: Partial<PracticePaperAssessmentProfile>;
  title?: string;
  question: { prompt: string; marks: number };
};

/** GCSE, A-level or Scottish, read from how the paper describes itself. */
export function questionLevel(profile?: Partial<PracticePaperAssessmentProfile>, title = ""): QuestionLevel {
  const described = [profile?.studyLevel, profile?.qualificationOrModule, profile?.specificationOrCourse, title].filter(Boolean).join(" ");
  // GCSE and A-level first: "GCSE Physics (Higher)" is a tier, not a Scottish Higher.
  if (/\b(gcse|igcse|level 1\/level 2)\b/i.test(described)) return "gcse";
  if (/\b(a[- ]?level|as[- ]level|ial|international a level|pre-u)\b/i.test(described)) return "alevel";
  if (/\b(national [45]|advanced higher|higher)\b/i.test(described)) return "scottish";
  return "other";
}

/**
 * The convention for one question, most specific first: a board's own rule for
 * that tariff and wording beats practice that holds across boards.
 */
export function questionConventionFor(context: QuestionConventionContext): QuestionConvention | null {
  const { profile, title = "", question } = context;
  const board = paperHouseStyle(profile).id;
  const level = questionLevel(profile, title);
  const subjectText = [profile?.qualificationOrModule, profile?.specificationOrCourse, title].filter(Boolean).join(" ");
  const marks = Math.round(question.marks);
  let best: { convention: QuestionConvention; score: number } | null = null;
  for (const convention of QUESTION_CONVENTIONS) {
    if (convention.board && convention.board !== board) continue;
    if (!convention.subject.test(subjectText)) continue;
    if (convention.level && convention.level !== level) continue;
    if (convention.marks && !convention.marks.includes(marks)) continue;
    if (convention.minMarks !== undefined && marks < convention.minMarks) continue;
    if (convention.maxMarks !== undefined && marks > convention.maxMarks) continue;
    if (convention.prompt && !convention.prompt.test(question.prompt)) continue;
    const score =
      (convention.board ? 8 : 0) +
      (convention.prompt ? 4 : 0) +
      (convention.marks ? 2 : 0) +
      (convention.level ? 1 : 0) +
      (convention.subject === ANY ? 0 : 1);
    if (!best || score > best.score) best = { convention, score };
  }
  return best?.convention ?? null;
}

/**
 * The kinds of question a board sets for a course, for the paper designer.
 *
 * Only practice specific to the subject: a designer told that evaluative
 * answers need judgements has learnt nothing about which questions this board
 * actually prints.
 */
export function questionConventionsForCourse(input: {
  board: string;
  course: string;
  level?: string;
}): QuestionConvention[] {
  const profile = { awardingBodyOrInstitution: input.board, qualificationOrModule: input.course, studyLevel: input.level ?? "" };
  const board = paperHouseStyle(profile).id;
  const level = questionLevel(profile);
  return QUESTION_CONVENTIONS.filter(
    (convention) =>
      convention.subject !== ANY &&
      (!convention.board || convention.board === board) &&
      (!convention.level || convention.level === level) &&
      convention.subject.test(input.course)
  );
}

/** The convention as the marker and the scheme writer read it. */
export function describeQuestionConvention(convention: QuestionConvention) {
  return [
    `${convention.title}.`,
    `A full answer: ${convention.answerShape}`,
    `How examiners mark it: ${convention.examinerRules.join(" ")}`,
    `Where answers usually lose marks: ${convention.pitfalls.join(" ")}`,
  ].join("\n");
}
