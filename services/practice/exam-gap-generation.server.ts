import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { generateAiText } from "@/lib/ai/provider-router";
import { parseJsonObject } from "@/services/ai/practice-paper-generation.server";
import { normalizeMarkSchemeItem } from "@/lib/practice/mark-schemes";
import { examDocument, type ExamCourseSelection, type ExamDifficulty, type ExamQuestion, type ExamQuestionSecret } from "@/lib/practice/exam-questions";
import { getExamQuestionRights } from "@/lib/practice/exam-question-rights";
import type { StudyLevel } from "@/lib/profile/study-level";
import { examGeneratedQuestionRefs } from "@/services/practice/exam-evidence.server";

type Candidate = { prompt?: unknown; answer?: unknown; points?: unknown; difficulty?: unknown; topicIds?: unknown };

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
}) {
  const requested = (Object.entries(input.missing) as Array<[ExamDifficulty, number | undefined]>).flatMap(([difficulty, count]) =>
    Array.from({ length: count ?? 0 }, () => ({ difficulty, marks: difficulty === "easy" ? 2 : difficulty === "medium" ? 4 : 6 }))
  );
  if (requested.length === 0) return [];
  const response = await generateAiText({
    role: "supervisor",
    taskClass: "important",
    timeoutMs: 45_000,
    deadlineAt: Date.now() + 50_000,
    generationConfig: { temperature: 0.25, topP: 0.8, maxOutputTokens: 8_000 },
    request: {
      systemInstruction: "You write original school exam practice questions. Never reproduce or claim to quote a past-paper question. Match the named current specification and return strict JSON only. Each point is one independently awardable mark and the number of points must equal marks.",
      contents: [{ role: "user", parts: [{ text: `Create exactly ${requested.length} original gap-filler questions for ${input.subject}. Course: ${input.course.specificationTitle} (${input.course.specificationId}), ${input.course.qualification}, ${input.course.board}${input.course.tier ? `, ${input.course.tier}` : ""}. Requested sequence: ${JSON.stringify(requested)}. Preferred canonical topic ids: ${JSON.stringify(input.topicIds)}. Return {"questions":[{"difficulty":"easy|medium|hard","prompt":"...","answer":"complete example answer","points":["one mark point per string"],"topicIds":["only supplied ids when relevant"]}]}. No assets, citations or copyrighted wording.` }] }],
    },
  });
  const payload = parseJsonObject(response);
  const candidates = Array.isArray(payload.questions) ? payload.questions as Candidate[] : [];
  if (candidates.length !== requested.length) throw new Error("Gap-fill generation returned the wrong number of questions.");
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
    const topicIds = Array.isArray(candidate.topicIds) ? candidate.topicIds.filter((item): item is string => typeof item === "string" && input.topicIds.includes(item)).slice(0, 10) : [];
    const question: ExamQuestion = {
      id, paperId: `jami-gap-${input.course.specificationId}`, subject: input.subject, subjectKey: input.subjectKey,
      studyLevel: input.studyLevel, label: `Jami-created ${index + 1}`, prompt, marks: expected.marks, assets: [], topicIds,
      tier: input.course.tier, difficulty: expected.difficulty, aiDifficulty: expected.difficulty,
      difficultyScore: expected.difficulty === "easy" ? 0.25 : expected.difficulty === "medium" ? 0.55 : 0.82,
      difficultySource: "ai_ingest", origin: "jami_generated",
      provenance: { board: input.course.board, boardLabel: "Jami", qualification: input.course.qualification, specificationId: input.course.specificationId, specificationTitle: input.course.specificationTitle, componentCode: "JAMI", componentTitle: "Gap filler", year: new Date().getUTCFullYear(), series: "Original", paperReference: "Not a past paper", questionNumber: String(index + 1), sourceUrl: "", sourceSha256 },
      rights: { key: rights.key, version: rights.version, verified: true, storageAllowed: true, studentDisplayAllowed: true, aiInferenceAllowed: true, revoked: false },
      status: "published", humanChecked: false, selectionKey: Math.random(), createdAt: now, updatedAt: now,
    };
    return { question, secret: { questionId: id, markSchemeItem, officialMarkScheme: "", modelAnswer: answer, examinerNotes: [], acceptableAlternatives: [], sourceDocumentHash: sourceSha256 } };
  });
  const refs = examGeneratedQuestionRefs(input.uid);
  await Promise.all(questions.flatMap((item) => [
    refs.questions.doc(item.question.id).set(examDocument(item.question)),
    refs.secrets.doc(item.question.id).set(examDocument(item.secret)),
  ]));
  return questions.map((item) => item.question);
}
