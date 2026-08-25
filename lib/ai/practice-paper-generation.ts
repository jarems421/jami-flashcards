import type { Source } from "@/lib/material/sources";
import { repairModelJsonBackslashes } from "@/lib/ai/model-json";
import { normalizePracticePaperCompanionDocuments } from "@/lib/practice/exam-formats";
import {
  getPracticePaperQuestionLimit,
  calculatePracticePaperTotalMarks,
  normalizePracticePaperAssessmentProfile,
  normalizePracticePaperChoiceGroups,
  normalizePracticePaperGradeGuidance,
  normalizePracticePaperMarkScheme,
  normalizePracticePaperQuestions,
  type PracticePaperFocus,
  type PracticePaperGenerationAudit,
  type PracticePaperGenerationResponse,
  type PracticePaperLength,
  type PracticePaperTimingMode,
} from "@/lib/practice/practice-papers";

export const MAX_PRACTICE_PAPER_REQUEST_LENGTH = 2_000;
export const MAX_PRACTICE_PAPER_COVERAGE_LENGTH = 1_000;

export function canonicalizeGeneratedMarkSchemeItems(value: unknown[]) {
  const list = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate
      : typeof candidate === "string" && candidate.trim()
        ? [candidate]
        : [];
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") return candidate;
    const item = candidate as Record<string, unknown>;
    return {
      ...item,
      questionId: item.questionId ?? item.id,
      marking: item.marking ?? item.markingModel,
      ...(Array.isArray(item.points)
        ? {
            points: item.points.map((point) => {
              if (!point || typeof point !== "object") return point;
              const entry = point as Record<string, unknown>;
              return {
                ...entry,
                dep: list(entry.dep),
                ft: entry.ft === true,
                essentialTerms: list(entry.essentialTerms),
                allow: list(entry.allow),
                reject: list(entry.reject),
              };
            }),
          }
        : {}),
    };
  });
}

export type PracticePaperGenerationRequest = {
  folderId: string;
  request: string;
  coverage: string;
  length: PracticePaperLength;
  focus: PracticePaperFocus;
  focusDetail: string;
  timingMode: PracticePaperTimingMode;
  tutorEnabled: boolean;
  sourceIds: string[];
};

export type ParsedPracticePaperModelAnswer =
  | {
      status: "needs_clarification";
      question: string;
      sourceRefs: string[];
    }
  | {
      status: "ready";
      assessmentProfile: ReturnType<typeof normalizePracticePaperAssessmentProfile>;
      title: string;
      instructions: string[];
      companionDocuments?: ReturnType<typeof normalizePracticePaperCompanionDocuments>;
      durationMinutes: number;
      questions: ReturnType<typeof normalizePracticePaperQuestions>;
      choiceGroups: ReturnType<typeof normalizePracticePaperChoiceGroups>;
      totalMarks: number;
      markScheme: ReturnType<typeof normalizePracticePaperMarkScheme>;
      sourceRefs: string[];
      gradeGuidance: ReturnType<typeof normalizePracticePaperGradeGuidance>;
      examinerInsights: string[];
    };

function normalizeId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function normalizeText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeTextList(value: unknown, maximum = 20) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 800))
        .filter(Boolean)
    )
  ).slice(0, maximum);
}

function isLength(value: unknown): value is PracticePaperLength {
  return value === "full";
}

function isFocus(value: unknown): value is PracticePaperFocus {
  return value === "balanced" || value === "weak_areas" || value === "custom";
}

export function parsePracticePaperGenerationRequest(
  value: unknown
): PracticePaperGenerationRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  const folderId = normalizeId(request.folderId);
  const prompt = normalizeText(request.request, MAX_PRACTICE_PAPER_REQUEST_LENGTH);
  const coverage = normalizeText(
    request.coverage,
    MAX_PRACTICE_PAPER_COVERAGE_LENGTH
  );
  const length = isLength(request.length) ? request.length : null;
  const focus = isFocus(request.focus) ? request.focus : null;
  const sourceIds = Array.isArray(request.sourceIds)
    ? Array.from(new Set(request.sourceIds.map(normalizeId).filter(Boolean))).slice(0, 16)
    : [];
  if (
    !folderId ||
    !prompt ||
    !coverage ||
    !length ||
    !focus ||
    sourceIds.length > 15
  ) {
    return null;
  }
  return {
    folderId,
    request: prompt,
    coverage,
    length,
    focus,
    focusDetail: normalizeText(request.focusDetail, 1_000),
    timingMode: request.timingMode === "untimed" ? "untimed" : "timed",
    tutorEnabled: request.tutorEnabled === true,
    sourceIds,
  };
}

function getSourceRoleWeight(source: Source) {
  const searchable = `${source.title} ${source.fileName ?? ""} ${
    source.subject ?? ""
  }`.toLowerCase();
  if (/specification|syllabus|module handbook|course handbook/.test(searchable)) return 900;
  if (/assessment brief|marking rubric|rubric/.test(searchable)) return 850;
  if (/mark scheme|markscheme|solutions?/.test(searchable)) return 800;
  if (/examiner report|chief examiner|assessment report/.test(searchable)) return 790;
  if (/past paper|exam paper|specimen|mock/.test(searchable)) return 760;
  if (/lecture|seminar|class notes|revision notes/.test(searchable)) return 500;
  if (/textbook|reading|chapter/.test(searchable)) return 400;
  return 200;
}

function getTerms(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .match(/[a-z0-9\u00c0-\u024f]{3,}/g)
        ?.filter(
          (term) =>
            !["about", "create", "from", "paper", "practice", "questions", "with"].includes(
              term
            )
        ) ?? []
    )
  ).slice(0, 30);
}

export function rankPracticePaperSources(
  sources: readonly Source[],
  request: string,
  maximum = 15
) {
  const terms = getTerms(request);
  return [...sources]
    .filter((source) => source.status === "active")
    .sort((left, right) => {
      const score = (source: Source) => {
        const searchable = `${source.title} ${source.fileName ?? ""} ${
          source.subject ?? ""
        }`.toLowerCase();
        return (
          getSourceRoleWeight(source) +
          terms.reduce(
            (total, term) => total + (searchable.includes(term) ? 30 : 0),
            0
          )
        );
      };
      return score(right) - score(left) || right.updatedAt - left.updatedAt;
    })
    .slice(0, Math.max(1, Math.min(15, maximum)));
}

const AUTHORITATIVE_ASSESSMENT_SOURCE =
  /specification|syllabus|module handbook|course handbook|assessment brief|rubric|mark scheme|markscheme|past paper|exam paper|specimen|examiner report/i;

export function practicePaperNeedsWebResearch(
  sources: readonly Pick<Source, "title" | "fileName">[]
) {
  return !sources.some((source) =>
    AUTHORITATIVE_ASSESSMENT_SOURCE.test(
      `${source.title} ${source.fileName ?? ""}`
    )
  );
}

export function buildPracticePaperResearchQuery(input: {
  subject: string;
  studyLevel: string;
  request: string;
}) {
  const publicSubjectTerms = new Set([
    "accounting", "anatomy", "art", "biology", "business", "calculus",
    "chemistry", "computing", "computer", "design", "economics", "engineering",
    "english", "finance", "french", "geography", "german", "history", "italian",
    "language", "languages", "latin", "law", "literature", "mathematics", "maths",
    "medicine", "music", "nursing", "philosophy", "physics", "politics", "psychology",
    "religious", "science", "sociology", "spanish", "statistics", "studies",
  ]);
  const subject = (input.subject.toLowerCase().match(/[a-z]{3,}/g) ?? [])
    .filter((term) => publicSubjectTerms.has(term))
    .slice(0, 4)
    .join(" ");
  const studyLevel = input.studyLevel.match(
    /\b(?:GCSE|IGCSE|A[ -]?level|AS[ -]?level|IB|BTEC|T[ -]?level|AP|undergraduate|postgraduate|university)\b/i
  )?.[0];
  const qualification = input.request.match(
    /\b(?:GCSE|IGCSE|A[ -]?level|AS[ -]?level|IB|BTEC|T[ -]?level|AP)\b/i
  )?.[0];
  const board = input.request.match(
    /\b(?:AQA|Pearson Edexcel|Edexcel|OCR|WJEC|Eduqas|CCEA|Cambridge International)\b/i
  )?.[0];
  const moduleCode = input.request.match(/\b[A-Z]{2,8}[ -]?\d{2,5}[A-Z]?\b/)?.[0];
  const parts = [
    subject,
    qualification,
    board,
    moduleCode,
    studyLevel,
    "official assessment specification exam format",
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(parts)).join(" ").replace(/\s+/g, " ").slice(0, 500);
}

function unwrapJson(value: string) {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

export function parsePracticePaperModelAnswer(
  value: string,
  input: {
    allowedSourceRefs: readonly string[];
    length: PracticePaperLength;
  }
): ParsedPracticePaperModelAnswer | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(
      repairModelJsonBackslashes(unwrapJson(value))
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
  const allowedRefs = new Set(input.allowedSourceRefs);
  const sourceRefs = normalizeTextList(payload.sourceRefs, 15);
  if (sourceRefs.some((reference) => !allowedRefs.has(reference))) return null;

  if (payload.status === "needs_clarification") {
    const question = normalizeText(payload.clarificationQuestion, 600);
    return question
      ? { status: "needs_clarification", question, sourceRefs }
      : null;
  }
  if (payload.status !== "ready") return null;

  const questions = normalizePracticePaperQuestions(payload.questions).slice(
    0,
    getPracticePaperQuestionLimit(input.length)
  );
  if (questions.length === 0) return null;
  const markScheme = normalizePracticePaperMarkScheme(
    payload.markScheme,
    questions
  );
  if (markScheme.items.length !== questions.length) return null;
  const choiceGroups = normalizePracticePaperChoiceGroups(
    payload.choiceGroups,
    questions
  );
  const title = normalizeText(payload.title, 160);
  if (!title) return null;
  const totalMarks = calculatePracticePaperTotalMarks(questions, choiceGroups);

  return {
    status: "ready",
    assessmentProfile: normalizePracticePaperAssessmentProfile(
      payload.assessmentProfile
    ),
    title,
    instructions: normalizeTextList(payload.instructions, 20),
    companionDocuments: normalizePracticePaperCompanionDocuments(payload.companionDocuments),
    durationMinutes:
      typeof payload.durationMinutes === "number" &&
      Number.isFinite(payload.durationMinutes)
        ? Math.max(5, Math.min(360, Math.round(payload.durationMinutes)))
        : Math.max(20, totalMarks),
    questions,
    choiceGroups,
    totalMarks,
    markScheme,
    sourceRefs,
    gradeGuidance: normalizePracticePaperGradeGuidance(payload.gradeGuidance),
    examinerInsights: normalizeTextList(payload.examinerInsights, 12),
  };
}

export function buildPracticePaperGenerationResponse(input: {
  parsed: ParsedPracticePaperModelAnswer;
  sourcesByRef: ReadonlyMap<string, Source>;
  generationAudit?: PracticePaperGenerationAudit;
}): PracticePaperGenerationResponse {
  const sources = input.parsed.sourceRefs
    .map((reference) => input.sourcesByRef.get(reference))
    .filter((source): source is Source => Boolean(source));
  const sourceIds = sources.map((source) => source.id);
  const sourceLabels = sources.map((source) => source.title);
  if (input.parsed.status === "needs_clarification") {
    return {
      status: "needs_clarification",
      question: input.parsed.question,
      sourceIds,
      sourceLabels,
    };
  }
  return {
    status: "ready",
    assessmentProfile: input.parsed.assessmentProfile,
    title: input.parsed.title,
    instructions: input.parsed.instructions,
    companionDocuments: input.parsed.companionDocuments ?? [],
    durationMinutes: input.parsed.durationMinutes,
    questions: input.parsed.questions,
    choiceGroups: input.parsed.choiceGroups,
    totalMarks: input.parsed.totalMarks,
    markScheme: input.parsed.markScheme,
    sourceIds,
    sourceLabels,
    gradeGuidance: input.parsed.gradeGuidance,
    examinerInsights: input.parsed.examinerInsights,
    generationAudit: input.generationAudit,
  };
}
