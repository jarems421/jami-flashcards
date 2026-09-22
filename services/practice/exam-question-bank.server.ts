import "server-only";

import { getAdminDb } from "@/services/firebase/admin";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";
import {
  EXAM_SESSION_MAX_QUESTIONS,
  examDocument,
  questionMatchesExamCourse,
  type ExamCourseSelection,
  examBoardAppliesTo,
  type ExamDifficulty,
  type ExamQuestion,
  type ExamSession,
  matchesCalculatorChoice,
  type ExamCalculatorChoice,
} from "@/lib/practice/exam-questions";
import { isExamQuestionServable } from "@/lib/practice/exam-question-rights";
import { examSubjectFromTitle } from "@/lib/practice/exam-course-names";
import { sameExamTier } from "@/lib/practice/exam-course-tiers";
import { examCoursePapers, matchesPaperChoice, withPaperCalculatorRules } from "@/lib/practice/exam-papers";
import {
  chooseExamQuestionGroups,
  examQuestionGroupKey,
  examQuestionIsComplete,
  groupExamQuestions,
  type ExamQuestionGroup,
} from "@/lib/practice/exam-question-groups";
import {
  filterCanonicalConceptIds,
  servableExamSpecificationConcepts,
} from "@/lib/practice/exam-specification-concepts";
import {
  filterCanonicalTopicIds,
  servableExamSpecificationTopics,
} from "@/lib/practice/exam-specification-topics";
import { normalizeQuestionAssets } from "@/lib/practice/practice-papers";
import { generateExamGapQuestions } from "@/services/practice/exam-gap-generation.server";
import { recoverExamDifficultyContributions } from "@/services/practice/exam-difficulty.server";
import { projectExamAttempt, projectExamSession, projectExamSessionQuestion } from "@/lib/practice/exam-projections";

/**
 * How far into the corpus a search will go.
 *
 * Tier, component and licence eligibility cannot be expressed as Firestore
 * filters -- a question with no tier is eligible for every tier, and a course
 * can list more components than an `in` query accepts -- so they are applied
 * after the read. Taking a single fixed window and filtering it therefore
 * missed every eligible question past the two hundredth, and reported a
 * shortage while the questions to fill it sat unread. Now the window is a page
 * and the search continues until it has what it was asked for.
 *
 * The page cap bounds a pathological case: a specification with thousands of
 * published questions and none eligible for this student's tier.
 */
const CANDIDATE_PAGE = 200;
const MAX_CANDIDATE_PAGES = 25;

function normalizeSubjectKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function mapQuestion(id: string, data: Record<string, unknown>): ExamQuestion | null {
  const marks = typeof data.marks === "number" ? Math.round(data.marks) : 0;
  const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
  if (!id || !prompt || marks < 1 || marks > 100) return null;
  return {
    ...(data as unknown as ExamQuestion),
    id,
    marks,
    prompt,
    label: typeof data.label === "string" ? data.label.slice(0, 120) : "Question",
    assets: normalizeQuestionAssets(data.assets),
    topicIds: Array.isArray(data.topicIds)
      ? data.topicIds.filter((item): item is string => typeof item === "string").slice(0, 40)
      : [],
    ...(Array.isArray(data.conceptIds)
      ? { conceptIds: data.conceptIds.filter((item): item is string => typeof item === "string").slice(0, 40) }
      : {}),
    selectionKey:
      typeof data.selectionKey === "number" && Number.isFinite(data.selectionKey)
        ? data.selectionKey
        : 0,
  };
}

function hasCurrentRights(question: ExamQuestion) {
  return isExamQuestionServable(question);
}

async function loadEligibleQuestions(input: {
  subjectKey: string;
  studyLevel: string;
  specificationId: string;
  course: ExamCourseSelection;
  difficulty: ExamDifficulty;
  topicIds: string[];
  /** One grain finer; a question matches a selected topic or a selected concept. */
  conceptIds: string[];
  /** Stop once this many usable whole questions have been found. */
  need: number;
  /**
   * Questions the student has already seen. They still count as eligible --
   * a repeat is better than a short session -- but finding one does not end
   * the search, so the unseen preference survives pagination.
   */
  seenIds?: ReadonlySet<string>;
  /** Which papers to draw from, in the terms a student thinks in. */
  calculator?: ExamCalculatorChoice;
  /** The course's papers to draw from, by `examPaperKey`; empty means all. */
  paperIds?: readonly string[];
  /** Each paper's stored parts, read once and shared across difficulties. */
  paperParts?: Map<string, Promise<ExamQuestion[]>>;
}) {
  const base = getAdminDb()
    .collection("examQuestions")
    .where("subjectKey", "==", input.subjectKey)
    .where("studyLevel", "==", input.studyLevel)
    .where("provenance.specificationId", "==", input.specificationId)
    .where("difficulty", "==", input.difficulty)
    .where("status", "==", "published")
    .orderBy("selectionKey", "asc");

  const eligible = (question: ExamQuestion) =>
    hasCurrentRights(question) &&
    questionMatchesExamCourse(question, input.course) &&
    matchesCalculatorChoice(question, input.calculator) &&
    matchesPaperChoice(question, input.paperIds ?? []);

  const paperParts = input.paperParts ?? new Map<string, Promise<ExamQuestion[]>>();
  const partsOfPaper = (paperId: string) => {
    let pending = paperParts.get(paperId);
    if (!pending) {
      pending = getAdminDb().collection("examQuestions").where("paperId", "==", paperId).get()
        .then((snapshot) => snapshot.docs
          .map((doc) => mapQuestion(doc.id, doc.data()))
          .filter((item): item is ExamQuestion => Boolean(item)));
      paperParts.set(paperId, pending);
    }
    return pending;
  };

  /*
   * A part found by the query stands for its whole question.
   *
   * The query is by difficulty, and a question is rated by its hardest part --
   * so the question is found through that part, and its easier siblings are
   * read from the same paper. Every part has to be servable, or none is: a
   * question held back for one faulty part is a question missing, but a (b)
   * served without its (a) is the thing this exists to stop.
   */
  const wholeQuestion = async (candidate: ExamQuestion) => {
    const key = examQuestionGroupKey(candidate);
    const parts = candidate.paperId
      ? (await partsOfPaper(candidate.paperId)).filter((part) => examQuestionGroupKey(part) === key)
      : [candidate];
    if (
      !parts.some((part) => part.id === candidate.id) ||
      !parts.every(eligible) ||
      // A part that was never stored cannot fail `eligible`, so its absence is checked too.
      !examQuestionIsComplete(parts)
    ) return null;
    return groupExamQuestions(parts)[0] ?? null;
  };

  const groups: ExamQuestionGroup<ExamQuestion>[] = [];
  const considered = new Set<string>();
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let exhausted = false;
  for (let page = 0; page < MAX_CANDIDATE_PAGES; page += 1) {
    const snapshot = await (cursor ? base.startAfter(cursor) : base).limit(CANDIDATE_PAGE).get();
    if (snapshot.empty) {
      exhausted = true;
      break;
    }
    cursor = snapshot.docs[snapshot.docs.length - 1];
    for (const doc of snapshot.docs) {
      const candidate = mapQuestion(doc.id, doc.data());
      if (!candidate || !eligible(candidate)) continue;
      const key = examQuestionGroupKey(candidate);
      if (considered.has(key)) continue;
      considered.add(key);
      const group = await wholeQuestion(candidate);
      if (!group || group.difficulty !== input.difficulty) continue;
      /*
       * A question is about a topic, or a concept, if any of its parts is. A
       * student can narrow to whole topics and to single concepts at once, so
       * matching either is enough.
       */
      if (
        (input.topicIds.length > 0 || input.conceptIds.length > 0) &&
        !group.parts.some(
          (part) =>
            input.topicIds.some((topicId) => part.topicIds.includes(topicId)) ||
            input.conceptIds.some((conceptId) => (part.conceptIds ?? []).includes(conceptId))
        )
      ) continue;
      groups.push(group);
    }
    if (snapshot.size < CANDIDATE_PAGE) {
      exhausted = true;
      break;
    }
    const usable = input.seenIds
      ? groups.filter((group) => !group.parts.some((part) => input.seenIds!.has(part.id))).length
      : groups.length;
    if (usable >= input.need) break;
  }
  return { groups, exhausted };
}

async function loadContext(uid: string, folderId: string) {
  const snapshot = await getAdminDb()
    .collection("users").doc(uid).collection("studyFolders").doc(folderId).get();
  if (!snapshot.exists) throw new ExamQuestionBankError("Folder not found.", 404, "folder_not_found");
  const folder = mapStudyFolderData(snapshot.id, snapshot.data() ?? {});
  if (!folder.studyLevel || !examBoardAppliesTo(folder.studyLevel)) {
    throw new ExamQuestionBankError("Past Paper Practice is for school qualifications.", 400, "unsupported_level");
  }
  /*
   * The course is what practice needs; the subject detail is the student's own
   * optional note. Requiring both refused a folder with a board, course and
   * tier as having no course until something was typed into that box -- and
   * typing "AQA Mathematics" there was the only way through.
   */
  if (!folder.examCourse) {
    throw new ExamQuestionBankError("Add this folder's exam course first.", 409, "course_required");
  }
  const catalogue = await getAdminDb().collection("examFormatCatalogue").where("board", "==", folder.examCourse.board).limit(300).get();
  const matches = catalogue.docs.map((doc) => doc.data()).filter((item) =>
    item.status === "current" && item.qualification === folder.examCourse!.qualification &&
    item.specificationCode === folder.examCourse!.specificationId);
  if (!matches.length || (matches.some((item) => item.tier) && !matches.some((item) => sameExamTier(item.tier, folder.examCourse!.tier)))) {
    throw new ExamQuestionBankError("Choose a current course and tier for this folder.", 409, "course_required");
  }
  /*
   * The subject the questions were actually filed under, which is the course's
   * and not the folder's.
   *
   * A folder's subject is whatever the student typed -- "gcse maths", "Maths",
   * "Mathematics Higher" -- and this used to key the question query off it
   * directly. Questions are filed under the subject printed on the paper, so a
   * folder reading "gcse maths" searched `gcse-maths` while all 101 published
   * AQA questions sat under `mathematics`. Nothing matched, and the student was
   * told their course needed more papers and offered generated questions
   * instead, which is the coverage-shortage path doing exactly what it should
   * with a query that could never have returned anything.
   *
   * The catalogue entry is the same source the ingestion manifest took its
   * subject from, so taking it from the course the folder actually selected is
   * what makes the two halves agree. The folder's own wording remains the
   * fallback, because a catalogue entry with no subject should not turn a
   * working folder into an empty one -- and where there is no wording either,
   * the course's own title with its board and qualification taken off.
   */
  const courseSubject = matches
    .map((item) => (typeof item.subject === "string" ? item.subject.trim() : ""))
    .find(Boolean);
  const subject =
    courseSubject ||
    folder.subject ||
    examSubjectFromTitle(folder.examCourse.specificationTitle) ||
    folder.examCourse.specificationTitle;
  return {
    folder,
    subject,
    subjectKey: normalizeSubjectKey(subject),
    papers: examCoursePapers(matches, folder.examCourse),
  };
}

export class ExamQuestionBankError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /** Set on a coverage shortage, so the caller can go looking for papers. */
    readonly course?: ExamCourseSelection,
    /** What the bank could actually supply, for the start-short offer. */
    readonly availableMix?: Record<ExamDifficulty, number>,
    /** How many of each tier were missing, for the generated-question offer. */
    readonly missingByDifficulty?: Partial<Record<ExamDifficulty, number>>
  ) {
    super(message);
  }
}

/**
 * The topics a student may filter on, checked against the specification.
 *
 * An id nobody recognises used to be accepted and then matched nothing, so a
 * stale bookmark or a typo produced a full coverage shortage and a card saying
 * this course needs more papers -- which was untrue, and unfixable by the
 * student, because nothing told them the topic was the problem.
 *
 * An empty selection is not a filter and needs no catalogue.
 */
function canonicalTopicIds(specificationId: string, topicIds: readonly string[]) {
  if (topicIds.length === 0) return [];
  const { topicIds: known, rejected } = filterCanonicalTopicIds(specificationId, topicIds);
  if (rejected.length > 0) {
    throw new ExamQuestionBankError(
      "Those topics are not on this course any more. Clear them and choose again.",
      400,
      "unknown_topics"
    );
  }
  return known;
}

/** Concepts are checked the same way, against the course's checked concept list. */
function canonicalConceptIds(specificationId: string, conceptIds: readonly string[]) {
  if (conceptIds.length === 0) return [];
  const { conceptIds: known, rejected } = filterCanonicalConceptIds(specificationId, conceptIds);
  if (rejected.length > 0) {
    throw new ExamQuestionBankError(
      "Those subtopics are not on this course any more. Clear them and choose again.",
      400,
      "unknown_concepts"
    );
  }
  return known;
}

/** Papers are checked the same way topics are, and for the same reason. */
function knownPaperIds(papers: ReadonlyArray<{ id: string }>, paperIds: readonly string[]) {
  if (paperIds.length === 0) return [];
  const known = new Set(papers.map((paper) => paper.id));
  if (paperIds.some((id) => !known.has(id))) {
    throw new ExamQuestionBankError(
      "That paper is not on this course any more. Choose again.",
      400,
      "unknown_papers"
    );
  }
  return [...new Set(paperIds)];
}

export async function getExamQuestionAvailability(input: {
  uid: string;
  folderId: string;
  topicIds?: string[];
  conceptIds?: string[];
  calculator?: ExamCalculatorChoice;
  paperIds?: string[];
}) {
  const { folder, subject, subjectKey, papers } = await loadContext(input.uid, input.folderId);
  const topicIds = canonicalTopicIds(folder.examCourse!.specificationId, input.topicIds ?? []);
  const conceptIds = canonicalConceptIds(folder.examCourse!.specificationId, input.conceptIds ?? []);
  const paperIds = knownPaperIds(papers, input.paperIds ?? []);
  /*
   * The whole count, not a session's worth.
   *
   * This stopped at twenty -- a session's maximum -- so every well-stocked
   * course read "20 ready" on every difficulty, which looked like a count and
   * was only the point the search gave up. Tier, component, licence and paper
   * eligibility are applied after the read, so an exact number needs the scan
   * anyway; it is bounded by the loader's page cap, and only a corpus past that
   * cap reports "at least".
   */
  const paperParts = new Map<string, Promise<ExamQuestion[]>>();
  const loadDifficulty = (difficulty: ExamDifficulty) => loadEligibleQuestions({
    subjectKey,
    studyLevel: folder.studyLevel!,
    specificationId: folder.examCourse!.specificationId,
    course: folder.examCourse!,
    difficulty,
    topicIds,
    conceptIds,
    need: Number.POSITIVE_INFINITY,
    paperIds,
    paperParts,
    ...(input.calculator ? { calculator: input.calculator } : {}),
  });
  /*
   * What each paper is, for the line under the picker.
   *
   * Read apart from the counts, because those are narrowed by the paper and
   * calculator already chosen -- and describing Paper 1 has to work while
   * Paper 3 is selected. Only the fields that say which paper a question came
   * from and whether a calculator was allowed are read.
   */
  const paperRules = getAdminDb().collection("examQuestions")
    .where("provenance.board", "==", folder.examCourse!.board)
    .where("provenance.specificationId", "==", folder.examCourse!.specificationId)
    .where("status", "==", "published")
    .select("calculatorAllowed", "provenance.componentTitle", "provenance.componentCode")
    .limit(2_000)
    .get()
    .then((snapshot) => snapshot.docs.map((doc) => doc.data() as Pick<ExamQuestion, "calculatorAllowed" | "provenance">))
    // A description is a nicety; failing to read one must not fail the counts.
    .catch(() => []);
  const [easy, medium, hard, ruleQuestions] = await Promise.all([
    loadDifficulty("easy"),
    loadDifficulty("medium"),
    loadDifficulty("hard"),
    paperRules,
  ]);
  /*
   * Topics come from the checked-in catalogue, not from the database.
   *
   * Nothing ever wrote the collection this used to read, so the drawer was
   * empty on every course -- and had anything written it, there was no check
   * that its entries were the specification's own. The catalogue is
   * owner-controlled and only served once a person has verified it against the
   * published document, so a course with no verified list offers no topics at
   * all rather than an invented one.
   */
  const catalogue = servableExamSpecificationTopics(folder.examCourse!.specificationId);
  const concepts = servableExamSpecificationConcepts(folder.examCourse!.specificationId);
  const topics = (catalogue?.topics ?? []).map((topic) => ({
    id: topic.id,
    label: topic.label,
    /** Which part of the course it belongs to, where the course has parts. */
    ...(topic.group ? { group: topic.group } : {}),
    /*
     * The finer concepts beneath it, from the checked list where there is one.
     * Offered whether or not the corpus holds a question on each yet: a
     * session narrowed past what exists says so and offers to fill the gap.
     */
    concepts: concepts
      .filter((concept) => concept.parentTopicId === topic.id)
      .map((concept) => ({ id: concept.id, label: concept.label })),
  }));
  return {
    folder: {
      id: folder.id,
      name: folder.name,
      subject,
      studyLevel: folder.studyLevel,
      course: folder.examCourse,
    },
    /** Whole questions, each counted once however many parts it has. */
    counts: {
      easy: easy.groups.length,
      medium: medium.groups.length,
      hard: hard.groups.length,
    },
    /** Whether each count is the whole truth or the point the page cap stopped it. */
    hasMore: {
      easy: !easy.exhausted && easy.groups.length > 0,
      medium: !medium.exhausted && medium.groups.length > 0,
      hard: !hard.exhausted && hard.groups.length > 0,
    },
    topics,
    topicIds,
    conceptIds,
    /** Offered as a choice only when there is more than one; each says what it is where that is known. */
    papers: withPaperCalculatorRules(papers, ruleQuestions),
    paperIds,
    /*
     * Whether this course's papers say anything about calculators.
     *
     * Read off the questions rather than the subject's name: a calculator rule
     * is printed on a paper's cover and recorded at ingestion, so a course with
     * none recorded is one where the question does not arise, whatever it is
     * called.
     */
    calculatorPolicyKnown: [easy, medium, hard].some(({ groups }) =>
      groups.some((group) => group.parts.some((part) => typeof part.calculatorAllowed === "boolean"))
    ),
  };
}

/**
 * How many whole questions the corpus can serve for each concept.
 *
 * Lives here, beside the eligibility rules, because that is the only place
 * that knows them: tier, component, licence and paper eligibility all apply,
 * and a count taken anywhere else would be a second, quietly different answer
 * to the same question.
 *
 * One scan grouped afterwards rather than one scan per concept. The rules are
 * applied by the loader either way, so asking once and counting what comes
 * back gives the same answer as asking sixty times, at a sixtieth of the cost.
 *
 * Counts whole questions, not parts, matching what a student would be given.
 * A question tagged with several concepts counts once for each -- this is
 * about whether there is anything to work with, not about how much evidence
 * it could produce.
 */
export async function getExamQuestionCountsByConcept(input: {
  uid: string;
  folderId: string;
}): Promise<{ byConcept: Record<string, number>; exhausted: boolean }> {
  const { folder, subjectKey, papers } = await loadContext(input.uid, input.folderId);
  const paperParts = new Map<string, Promise<ExamQuestion[]>>();
  const results = await Promise.all(
    (["easy", "medium", "hard"] as const).map((difficulty) =>
      loadEligibleQuestions({
        subjectKey,
        studyLevel: folder.studyLevel!,
        specificationId: folder.examCourse!.specificationId,
        course: folder.examCourse!,
        difficulty,
        topicIds: [],
        conceptIds: [],
        need: Number.POSITIVE_INFINITY,
        paperIds: knownPaperIds(papers, []),
        paperParts,
      })
    )
  );

  const byConcept: Record<string, number> = {};
  const seen = new Set<string>();
  let exhausted = false;
  for (const result of results) {
    if (!result.exhausted) exhausted = true;
    for (const group of result.groups) {
      // One question, however many parts it was split into.
      if (seen.has(group.key)) continue;
      seen.add(group.key);
      const concepts = new Set(group.parts.flatMap((part) => part.conceptIds ?? []));
      for (const conceptId of concepts) {
        byConcept[conceptId] = (byConcept[conceptId] ?? 0) + 1;
      }
    }
  }
  return { byConcept, exhausted };
}

export async function createExamSession(input: {
  uid: string;
  folderId: string;
  mix: Record<ExamDifficulty, number>;
  topicIds?: string[];
  conceptIds?: string[];
  originNotebookId?: string;
  allowGenerated?: boolean;
  useAvailableOnly?: boolean;
  calculator?: ExamCalculatorChoice;
  paperIds?: string[];
}) {
  const total = input.mix.easy + input.mix.medium + input.mix.hard;
  if (total < 1 || total > EXAM_SESSION_MAX_QUESTIONS) {
    throw new ExamQuestionBankError(`Choose between 1 and ${EXAM_SESSION_MAX_QUESTIONS} questions.`, 400, "invalid_mix");
  }
  const { folder, subject, subjectKey, papers } = await loadContext(input.uid, input.folderId);
  // Checked once, here, rather than trusted from the request. A narrowed
  // session built on an id nobody recognises is an empty session.
  const topicIds = canonicalTopicIds(folder.examCourse!.specificationId, input.topicIds ?? []);
  const conceptIds = canonicalConceptIds(folder.examCourse!.specificationId, input.conceptIds ?? []);
  const paperIds = knownPaperIds(papers, input.paperIds ?? []);
  const recent = await getAdminDb().collection("users").doc(input.uid)
    .collection("examAttempts").orderBy("updatedAt", "desc").limit(500).get();
  const recentIds = new Set(recent.docs.map((doc) => doc.data().questionId).filter((id): id is string => typeof id === "string"));
  const chosenGroups: ExamQuestionGroup<ExamQuestion>[] = [];
  const missing: Partial<Record<ExamDifficulty, number>> = {};
  let requestedMix = input.mix;
  const paperParts = new Map<string, Promise<ExamQuestion[]>>();
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    const wanted = input.mix[difficulty];
    if (!wanted) continue;
    const { groups: candidates } = await loadEligibleQuestions({
      subjectKey,
      studyLevel: folder.studyLevel!,
      specificationId: folder.examCourse!.specificationId,
      course: folder.examCourse!,
      difficulty,
      topicIds,
      conceptIds,
      need: wanted,
      seenIds: recentIds,
      paperIds,
      paperParts,
      ...(input.calculator ? { calculator: input.calculator } : {}),
    });
    const chosen = chooseExamQuestionGroups(candidates, wanted, recentIds);
    chosenGroups.push(...chosen);
    if (chosen.length < wanted) missing[difficulty] = wanted - chosen.length;
  }
  // The mix counts whole questions; the session lists their parts together, in order.
  const selected: ExamQuestion[] = chosenGroups.flatMap((group) => group.parts);
  const chosenOf = (difficulty: ExamDifficulty) =>
    chosenGroups.filter((group) => group.difficulty === difficulty).length;
  if (Object.keys(missing).length > 0) {
    if (input.allowGenerated) {
      selected.push(...await generateExamGapQuestions({ uid: input.uid, subject, subjectKey, studyLevel: folder.studyLevel!, course: folder.examCourse!, missing, topicIds, conceptIds }));
    } else if (input.useAvailableOnly && selected.length > 0) {
      // Starting short is a choice the student made, so the session records the
      // mix it actually holds rather than the one that was asked for.
      requestedMix = {
        easy: chosenOf("easy"),
        medium: chosenOf("medium"),
        hard: chosenOf("hard"),
      };
    } else {
      throw new ExamQuestionBankError(
        "There are not enough matching past-paper questions yet.",
        409,
        "coverage_gap",
        folder.examCourse!,
        {
          easy: Math.min(input.mix.easy, chosenOf("easy")),
          medium: Math.min(input.mix.medium, chosenOf("medium")),
          hard: Math.min(input.mix.hard, chosenOf("hard")),
        },
        missing
      );
    }
  }

  const db = getAdminDb();
  const sessionRef = db.collection("users").doc(input.uid).collection("examSessions").doc();
  const now = Date.now();
  const questions = selected.map((question, index) =>
    projectExamSessionQuestion(question, `${sessionRef.id}_${index + 1}_1`)
  );
  const session: ExamSession = {
    id: sessionRef.id,
    userId: input.uid,
    folderId: folder.id,
    folderName: folder.name,
    subject,
    studyLevel: folder.studyLevel!,
    course: folder.examCourse!,
    requestedMix,
    topicIds,
    conceptIds,
    questions,
    status: "active",
    currentQuestionId: questions[0]?.id,
    answeredCount: 0,
    awardedTotal: 0,
    assessedTotal: 0,
    maxTotal: questions.reduce((sum, question) => sum + question.marks, 0),
    originNotebookId: input.originNotebookId,
    createdAt: now,
    updatedAt: now,
  };
  const batch = db.batch();
  batch.set(sessionRef, examDocument(session));
  for (const question of questions) {
    const attemptRef = db.collection("users").doc(input.uid).collection("examAttempts").doc(question.attemptId);
    batch.set(attemptRef, {
      id: question.attemptId,
      userId: input.uid,
      sessionId: session.id,
      questionId: question.id,
      attemptNumber: 1,
      answerText: "",
      status: "draft",
      workingIncluded: false,
      reviewUsed: false,
      startedAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return session;
}

export async function getExamSession(uid: string, sessionId: string) {
  const db = getAdminDb();
  const [sessionSnapshot, attemptsSnapshot] = await Promise.all([
    db.collection("users").doc(uid).collection("examSessions").doc(sessionId).get(),
    db.collection("users").doc(uid).collection("examAttempts")
      .where("sessionId", "==", sessionId).orderBy("updatedAt", "desc").get(),
  ]);
  if (!sessionSnapshot.exists) throw new ExamQuestionBankError("Session not found.", 404, "session_not_found");
  const session = sessionSnapshot.data() as ExamSession;
  /*
   * Statistics are written after the marking transaction commits, so a request
   * that died in between left the attempt marked and uncounted. The attempts
   * are already loaded here, so noticing costs nothing, and recording one is
   * idempotent -- the normal case finds none and does no work at all.
   */
  await recoverExamDifficultyContributions({
    uid,
    studyLevel: session.studyLevel,
    attempts: attemptsSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  }).catch(() => undefined);
  return {
    session: projectExamSession(session),
    attempts: attemptsSnapshot.docs.map((doc) => projectExamAttempt(doc.id, doc.data())),
  };
}

/** One page of history. A hundred sessions is a term or two, not a limit. */
export const EXAM_SESSION_PAGE_SIZE = 40;

/**
 * A student's practice history, oldest reachable rather than cut off.
 *
 * This stopped at a hundred sessions with no way past them, so a student's
 * earlier work simply stopped existing once they had done enough of it. The
 * cursor is the last session's `updatedAt`, which is what the list is ordered
 * by, so paging cannot skip or repeat a session as new ones arrive.
 */
export async function listExamSessions(uid: string, folderId?: string, before?: number) {
  let query: FirebaseFirestore.Query = getAdminDb().collection("users").doc(uid).collection("examSessions");
  if (folderId) query = query.where("folderId", "==", folderId);
  query = query.orderBy("updatedAt", "desc");
  if (typeof before === "number" && Number.isFinite(before)) query = query.startAfter(before);
  const snapshot = await query.limit(EXAM_SESSION_PAGE_SIZE).get();
  const sessions = snapshot.docs.map((doc) => projectExamSession({ ...doc.data(), id: doc.id } as ExamSession));
  const last = sessions.at(-1) as { updatedAt?: number } | undefined;
  return {
    sessions,
    nextCursor:
      sessions.length === EXAM_SESSION_PAGE_SIZE && typeof last?.updatedAt === "number"
        ? last.updatedAt
        : null,
  };
}
