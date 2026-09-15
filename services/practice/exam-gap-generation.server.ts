import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { generateAiText } from "@/lib/ai/provider-router";
import { parseJsonObject } from "@/services/ai/practice-paper-generation.server";
import { normalizeMarkSchemeItem } from "@/lib/practice/mark-schemes";
import { examDocument, type ExamCourseSelection, type ExamDifficulty, type ExamQuestion, type ExamQuestionSecret } from "@/lib/practice/exam-questions";
import { getExamQuestionRights } from "@/lib/practice/exam-question-rights";
import type { StudyLevel } from "@/lib/profile/study-level";
import {
  conceptParentTopicIds,
  servableExamSpecificationConcepts,
} from "@/lib/practice/exam-specification-concepts";
import { examGeneratedQuestionRefs } from "@/services/practice/exam-evidence.server";

type Candidate = { prompt?: unknown; answer?: unknown; points?: unknown; difficulty?: unknown; topicIds?: unknown; conceptIds?: unknown };

/*
 * Sized from measured calls, because the old numbers were why this failed.
 *
 * On the supervisor at its usual reasoning, ten questions took 44.8 seconds
 * against a 45-second timeout -- so a batch either just made it or was aborted,
 * and the retry was left the five seconds remaining of a 50-second deadline.
 * Five questions took 26 seconds. Output ran to 7,211 tokens for ten, and a
 * call that reached the 8,000 cap came back truncated and unparseable.
 */
/** Questions one generation call is asked to write. */
const GAP_BATCH_SIZE = 5;
/** Batches in flight at once, so a fifty-question shortfall is not ten simultaneous calls. */
const GAP_BATCH_CONCURRENCY = 5;
/** One call's ceiling: several times the measured batch, well inside the whole budget. */
const GAP_CALL_TIMEOUT_MS = 120_000;
/** Everything the shortfall may take, inside the session route's 300 seconds. */
const GAP_GENERATION_BUDGET_MS = 150_000;
/** A call silent this long has stopped, not slowed. */
const GAP_STALL_TIMEOUT_MS = 30_000;
/** Room for reasoning and five full questions; eight thousand truncated ten. */
const GAP_MAX_OUTPUT_TOKENS = 16_000;

/**
 * Original stand-ins for the questions a thin bank could not supply.
 *
 * These are written under the student who asked for them, never into the
 * shared bank: they are unreviewed model output, and the course filter refuses
 * them on origin anyway, so a shared copy could only ever accumulate.
 */
export async function generateExamGapQuestions(input: {
  uid: string;
  subject: string;
  subjectKey: string;
  studyLevel: StudyLevel;
  course: ExamCourseSelection;
  missing: Partial<Record<ExamDifficulty, number>>;
  topicIds: string[];
  /** Concepts the session was narrowed to; a generated question may claim only these. */
  conceptIds?: string[];
}) {
  const requested = (Object.entries(input.missing) as Array<[ExamDifficulty, number | undefined]>).flatMap(([difficulty, count]) =>
    Array.from({ length: count ?? 0 }, () => ({ difficulty, marks: difficulty === "easy" ? 2 : difficulty === "medium" ? 4 : 6 }))
  );
  if (requested.length === 0) return [];
  /*
   * Small batches, a few at a time, against one shared deadline.
   *
   * One call used to write the whole shortfall, and even ten questions sat on
   * the edge of its timeout. A fifty-question session can be short by fifty, so
   * the work is split: each batch fits comfortably in its own call, a handful
   * run together, and the deadline belongs to the shortfall as a whole so a
   * retry inherits real time rather than whatever one call left behind.
   */
  const batches = Array.from({ length: Math.ceil(requested.length / GAP_BATCH_SIZE) }, (_unused, index) =>
    requested.slice(index * GAP_BATCH_SIZE, (index + 1) * GAP_BATCH_SIZE)
  );
  const deadlineAt = Date.now() + GAP_GENERATION_BUDGET_MS;
  const requestedConcepts = input.conceptIds ?? [];
  // Named as well as numbered, so the writer knows what "quadratic equations" is on this course.
  const targetConcepts = servableExamSpecificationConcepts(input.course.specificationId)
    .filter((concept) => requestedConcepts.includes(concept.id))
    .map((concept) => ({ id: concept.id, label: concept.label }));
  const writeBatch = async (batch: typeof requested) => {
    const response = await generateAiText({
      role: "supervisor",
      taskClass: "important",
      timeoutMs: GAP_CALL_TIMEOUT_MS,
      stallTimeoutMs: GAP_STALL_TIMEOUT_MS,
      deadlineAt,
      generationConfig: { temperature: 0.25, topP: 0.8, maxOutputTokens: GAP_MAX_OUTPUT_TOKENS },
      request: {
        systemInstruction: "You write original school exam practice questions. Never reproduce or claim to quote a past-paper question. Match the named current specification and return strict JSON only. Each point is one independently awardable mark and the number of points must equal marks.",
        contents: [{ role: "user", parts: [{ text: `Create exactly ${batch.length} original gap-filler questions for ${input.subject}. Course: ${input.course.specificationTitle} (${input.course.specificationId}), ${input.course.qualification}, ${input.course.board}${input.course.tier ? `, ${input.course.tier}` : ""}. Requested sequence: ${JSON.stringify(batch)}. Preferred canonical topic ids: ${JSON.stringify(input.topicIds)}.${targetConcepts.length > 0 ? ` Concepts to write for: ${JSON.stringify(targetConcepts)}.` : ""} Return {"questions":[{"difficulty":"easy|medium|hard","prompt":"...","answer":"complete example answer","points":["one mark point per string"],"topicIds":["only supplied ids when relevant"],"conceptIds":["only supplied concept ids when relevant"]}]}. No assets, citations or copyrighted wording.` }] }],
      },
    });
    const payload = parseJsonObject(response);
    const questions = Array.isArray(payload.questions) ? payload.questions as Candidate[] : [];
    if (questions.length !== batch.length) throw new Error("Gap-fill generation returned the wrong number of questions.");
    return questions;
  };
  const written: Candidate[][] = new Array(batches.length);
  let nextBatch = 0;
  await Promise.all(Array.from({ length: Math.min(GAP_BATCH_CONCURRENCY, batches.length) }, async () => {
    while (nextBatch < batches.length) {
      const index = nextBatch;
      nextBatch += 1;
      written[index] = await writeBatch(batches[index]!);
    }
  }));
  // In request order, so each question lines up with the difficulty it was asked for.
  const candidates = written.flat();
  const rights = getExamQuestionRights("jami-original", 1);
  if (!rights) throw new Error("Jami-created content rights are not configured.");
  const now = Date.now();
  const questions: Array<{ question: ExamQuestion; secret: ExamQuestionSecret }> = candidates.map((candidate, index) => {
    const expected = requested[index]!;
    const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim().slice(0, 30_000) : "";
    const answer = typeof candidate.answer === "string" ? candidate.answer.trim().slice(0, 8_000) : "";
    const rawPoints = Array.isArray(candidate.points) ? candidate.points.filter((point): point is string => typeof point === "string" && Boolean(point.trim())).slice(0, expected.marks) : [];
    if (!prompt || !answer || rawPoints.length !== expected.marks || candidate.difficulty !== expected.difficulty) throw new Error("A generated question failed structural checks.");
    const id = `jami_${randomUUID().replace(/-/g, "")}`;
    const markSchemeItem = normalizeMarkSchemeItem({
      questionId: id, maxMarks: expected.marks, marking: "additive", answer,
      acceptableAlternatives: [], commonMistakes: [],
      points: rawPoints.map((text, pointIndex) => ({ id: `${id}.m${pointIndex + 1}`, marks: 1, code: "B", text, dep: [], ft: false, essentialTerms: [], allow: [], reject: [] })),
    }, { id, marks: expected.marks });
    if (!markSchemeItem) throw new Error("A generated marking guide failed validation.");
    const sourceSha256 = createHash("sha256").update(`${prompt}\n${answer}\n${rawPoints.join("\n")}`).digest("hex");
    const conceptIds = Array.isArray(candidate.conceptIds) ? candidate.conceptIds.filter((item): item is string => typeof item === "string" && requestedConcepts.includes(item)).slice(0, 10) : [];
    // A concept's topic comes with it, so the question sits under its topic like an extracted one.
    const topicIds = Array.from(new Set([
      ...(Array.isArray(candidate.topicIds) ? candidate.topicIds.filter((item): item is string => typeof item === "string" && input.topicIds.includes(item)) : []),
      ...conceptParentTopicIds(input.course.specificationId, conceptIds),
    ])).slice(0, 10);
    const question: ExamQuestion = {
      id, paperId: `jami-gap-${input.course.specificationId}`, subject: input.subject, subjectKey: input.subjectKey,
      studyLevel: input.studyLevel, label: `Jami-created ${index + 1}`, prompt, marks: expected.marks, assets: [], topicIds, ...(conceptIds.length > 0 ? { conceptIds } : {}),
      tier: input.course.tier, difficulty: expected.difficulty, aiDifficulty: expected.difficulty,
      difficultyScore: expected.difficulty === "easy" ? 0.25 : expected.difficulty === "medium" ? 0.55 : 0.82,
      difficultySource: "ai_ingest", origin: "jami_generated",
      provenance: { board: input.course.board, boardLabel: "Jami", qualification: input.course.qualification, specificationId: input.course.specificationId, specificationTitle: input.course.specificationTitle, componentCode: "JAMI", componentTitle: "Gap filler", year: new Date().getUTCFullYear(), series: "Original", paperReference: "Not a past paper", questionNumber: String(index + 1), sourceUrl: "", sourceSha256 },
      rights: { key: rights.key, version: rights.version, verified: true, storageAllowed: true, studentDisplayAllowed: true, aiInferenceAllowed: true, revoked: false },
      contentVersion: sourceSha256.slice(0, 16),
      status: "published",
      review: {
        status: "approved", by: "ai", at: now,
        notes: ["Jami-authored rather than extracted; there is no source paper to check it against."],
      },
      selectionKey: Math.random(), createdAt: now, updatedAt: now,
    };
    return { question, secret: { questionId: id, contentVersion: sourceSha256.slice(0, 16), markSchemeItem, officialMarkScheme: "", modelAnswer: answer, examinerNotes: [], acceptableAlternatives: [], sourceDocumentHash: sourceSha256 } };
  });
  const refs = examGeneratedQuestionRefs(input.uid);
  await Promise.all(questions.flatMap((item) => [
    refs.questions.doc(item.question.id).set(examDocument(item.question)),
    refs.secrets.doc(item.question.id).set(examDocument(item.secret)),
  ]));
  return questions.map((item) => item.question);
}
