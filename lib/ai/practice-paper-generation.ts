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

export function partitionMarkSchemeQuestions<T extends { marks: number }>(
  questions: readonly T[],
  options: { maximumQuestions?: number; maximumMarks?: number } = {}
) {
  const maximumQuestions = Math.max(1, options.maximumQuestions ?? 2);
  const maximumMarks = Math.max(1, options.maximumMarks ?? 20);
  const batches: T[][] = [];
  let current: T[] = [];
  let currentMarks = 0;

  for (const question of questions) {
    const marks = Math.max(0, Number.isFinite(question.marks) ? question.marks : 0);
    if (
      current.length > 0 &&
      (current.length >= maximumQuestions || currentMarks + marks > maximumMarks)
    ) {
      batches.push(current);
      current = [];
      currentMarks = 0;
    }
    current.push(question);
    currentMarks += marks;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function canonicalizeGeneratedMarkSchemeItems(value: unknown[]) {
  const list = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate
      : typeof candidate === "string" && candidate.trim()
        ? [candidate]
        : [];
  const canonicalBands = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.map((band) => {
        if (!band || typeof band !== "object") return band;
        const entry = band as Record<string, unknown>;
        return {
          ...entry,
          minMarks: entry.minMarks ?? entry.min ?? entry.from,
          maxMarks: entry.maxMarks ?? entry.max ?? entry.to,
          descriptor: entry.descriptor ?? entry.description ?? entry.text,
        };
      })
    : candidate;
  const canonicalTraits = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.map((trait) => {
        if (!trait || typeof trait !== "object") return trait;
        const entry = trait as Record<string, unknown>;
        return {
          ...entry,
          label: entry.label ?? entry.name,
          maxMarks: entry.maxMarks ?? entry.max ?? entry.marks,
          bands: canonicalBands(entry.bands ?? entry.levels),
        };
      })
    : candidate;
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") return candidate;
    const item = candidate as Record<string, unknown>;
    const nestedMarking = item.marking && typeof item.marking === "object" && !Array.isArray(item.marking)
      ? item.marking as Record<string, unknown>
      : null;
    const rawMarking = typeof item.marking === "string"
      ? item.marking
      : nestedMarking?.type ?? nestedMarking?.model ?? nestedMarking?.kind ??
        nestedMarking?.method ?? nestedMarking?.schemeType ?? item.markingModel;
    const nestedAdditive = nestedMarking?.additive && typeof nestedMarking.additive === "object"
      ? nestedMarking.additive as Record<string, unknown>
      : null;
    const nestedPointPool = nestedMarking?.pointPool && typeof nestedMarking.pointPool === "object"
      ? nestedMarking.pointPool as Record<string, unknown>
      : null;
    const nestedBanded = nestedMarking?.banded && typeof nestedMarking.banded === "object"
      ? nestedMarking.banded as Record<string, unknown>
      : null;
    const nestedWeightedTraits = nestedMarking?.weightedTraits && typeof nestedMarking.weightedTraits === "object"
      ? nestedMarking.weightedTraits as Record<string, unknown>
      : null;
    const nestedCompetency = nestedMarking?.competency && typeof nestedMarking.competency === "object"
      ? nestedMarking.competency as Record<string, unknown>
      : null;
    const points = item.points ?? nestedMarking?.points ?? nestedAdditive?.points ?? nestedPointPool?.points;
    const bands = canonicalBands(item.bands ?? item.levels ?? nestedMarking?.bands ?? nestedMarking?.levels ?? nestedBanded?.bands ?? nestedBanded?.levels);
    const traits = canonicalTraits(item.traits ?? nestedMarking?.traits ?? nestedWeightedTraits?.traits);
    const competencies = item.competencies ?? nestedMarking?.competencies ?? nestedCompetency?.competencies;
    const awardable = item.awardable ?? nestedMarking?.awardable ?? nestedPointPool?.awardable;
    const normalizedMarking = typeof rawMarking === "string"
      ? rawMarking.replace(/[^A-Za-z]/g, "").toLowerCase()
      : "";
    const marking =
      ["additive", "points", "pointbased", "pointmarking"].includes(normalizedMarking) ? "additive" :
      ["pointpool", "pool", "bestpoints"].includes(normalizedMarking) ? "pointPool" :
      ["banded", "bands", "level", "levels", "levelofresponse", "levelsofresponse"].includes(normalizedMarking) ? "banded" :
      ["weightedtraits", "traits", "analytic", "analytical"].includes(normalizedMarking) ? "weightedTraits" :
      ["competency", "competencies", "competencybased"].includes(normalizedMarking) ? "competency" :
      nestedPointPool || (Array.isArray(points) && awardable !== undefined) ? "pointPool" :
      Array.isArray(points) || nestedAdditive ? "additive" :
      Array.isArray(bands) || nestedBanded ? "banded" :
      Array.isArray(traits) || nestedWeightedTraits ? "weightedTraits" :
      Array.isArray(competencies) || nestedCompetency ? "competency" :
      rawMarking;
    const normalizedPoints = Array.isArray(points)
      ? points.map((point) => {
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
        })
      : undefined;
    const pointCodes = new Map(
      (normalizedPoints ?? []).flatMap((point) =>
        point && typeof point === "object" && typeof (point as Record<string, unknown>).id === "string"
          ? [[String((point as Record<string, unknown>).id), String((point as Record<string, unknown>).code ?? "").toUpperCase()] as const]
          : []
      )
    );
    const safePoints = normalizedPoints?.map((point) => {
      if (!point || typeof point !== "object") return point;
      const entry = point as Record<string, unknown>;
      if (String(entry.code ?? "").toUpperCase() !== "M" || !Array.isArray(entry.dep)) return point;
      return {
        ...entry,
        dep: entry.dep.filter((dependency) => pointCodes.get(String(dependency)) !== "A"),
      };
    });
    const balancedPoints = (() => {
      if (marking !== "additive" || !safePoints || safePoints.length === 0) return safePoints;
      const maxMarks = Math.round(Number(item.maxMarks));
      if (!Number.isFinite(maxMarks) || maxMarks < safePoints.length) return safePoints;
      const entries = safePoints.map((point) => {
        if (!point || typeof point !== "object") return point;
        const entry = point as Record<string, unknown>;
        return { ...entry, marks: Math.max(1, Math.round(Number(entry.marks) || 1)) };
      });
      const readable = entries.every((point) => point && typeof point === "object");
      if (!readable) return safePoints;
      let total = entries.reduce((sum, point) =>
        sum + Number((point as Record<string, unknown>).marks), 0);
      if (total < maxMarks) {
        const last = entries.at(-1) as Record<string, unknown>;
        last.marks = Number(last.marks) + (maxMarks - total);
        return entries;
      }
      for (let index = entries.length - 1; index >= 0 && total > maxMarks; index -= 1) {
        const point = entries[index] as Record<string, unknown>;
        const removable = Math.min(Number(point.marks) - 1, total - maxMarks);
        point.marks = Number(point.marks) - removable;
        total -= removable;
      }
      return entries;
    })();
    return {
      ...item,
      questionId: item.questionId ?? item.id,
      marking,
      ...(item.awardable === undefined && awardable !== undefined
        ? { awardable }
        : {}),
      ...(item.bands === undefined && bands !== undefined
        ? { bands }
        : {}),
      ...(item.traits === undefined && traits !== undefined
        ? { traits }
        : {}),
      ...(item.competencies === undefined && competencies !== undefined
        ? { competencies }
        : {}),
      ...(balancedPoints
        ? { points: balancedPoints }
        : {}),
    };
  });
}

export function normalizeGeneratedMarkSchemeBatch(
  value: unknown[],
  questions: ReturnType<typeof normalizePracticePaperQuestions>
) {
  const items = normalizePracticePaperMarkScheme(
    { items: canonicalizeGeneratedMarkSchemeItems(value) },
    questions
  ).items;
  return items.length === questions.length ? items : null;
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

const AUDIT_REPAIR_TOP_LEVEL_KEYS = [
  "assessmentProfile",
  "title",
  "instructions",
  "companionDocuments",
  "durationMinutes",
  "choiceGroups",
  "sourceRefs",
  "gradeGuidance",
  "examinerInsights",
] as const;

/**
 * Applies a deliberately small audit patch to a complete paper. Audit repairs
 * must not ask a provider to repeat an entire long paper: doing so is both
 * wasteful and prone to output truncation. The merged value is parsed and
 * validated by the normal paper parser immediately afterwards.
 */
export function applyPracticePaperAuditRepairPatch(
  paper: Extract<ParsedPracticePaperModelAnswer, { status: "ready" }>,
  value: unknown
) {
  if (!value || typeof value !== "object") return null;
  const patch = value as Record<string, unknown>;
  const topLevel =
    patch.topLevel && typeof patch.topLevel === "object"
      ? patch.topLevel as Record<string, unknown>
      : patch.paper && typeof patch.paper === "object"
        ? patch.paper as Record<string, unknown>
        : {};
  const merged: Record<string, unknown> = { ...paper };
  for (const key of AUDIT_REPAIR_TOP_LEVEL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(topLevel, key)) {
      merged[key] = topLevel[key];
    }
  }

  const removeQuestionIds = new Set(
    Array.isArray(patch.removeQuestionIds)
      ? patch.removeQuestionIds.filter((item): item is string =>
          typeof item === "string" && item.trim().length > 0
        )
      : []
  );
  const pairedReplacements = Array.isArray(patch.replacements)
    ? patch.replacements.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object"
      )
    : [];
  const rawQuestionReplacements = [
    ...(Array.isArray(patch.questionReplacements) ? patch.questionReplacements : []),
    ...(Array.isArray(patch.questions) ? patch.questions : []),
    ...pairedReplacements.map((item) => item.question),
  ];
  const questionReplacements = rawQuestionReplacements
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      ...item,
      id: typeof item.id === "string" ? item.id : item.questionId,
    }))
    .filter((item) => typeof item.id === "string" && item.id.trim().length > 0);
  const questionsById = new Map(
    questionReplacements.map((item) => [String(item.id), item] as const)
  );
  const existingQuestionIds = new Set(paper.questions.map((item) => item.id));
  merged.questions = [
    ...paper.questions
      .filter((item) => !removeQuestionIds.has(item.id))
      .map((item) => questionsById.get(item.id) ?? item),
    ...questionReplacements.filter((item) => !existingQuestionIds.has(String(item.id))),
  ];

  const rawMarkScheme = paper.markScheme as unknown as Record<string, unknown>;
  const markSchemeTopLevel =
    patch.markSchemeTopLevel && typeof patch.markSchemeTopLevel === "object"
      ? patch.markSchemeTopLevel as Record<string, unknown>
      : {};
  const rawItemReplacements = [
    ...(Array.isArray(patch.markSchemeItemReplacements) ? patch.markSchemeItemReplacements : []),
    ...(Array.isArray(patch.markSchemeItems) ? patch.markSchemeItems : []),
    ...pairedReplacements.map((item) => item.markSchemeItem ?? item.markScheme),
  ];
  const itemReplacements = canonicalizeGeneratedMarkSchemeItems(rawItemReplacements);
  const itemsByQuestionId = new Map(
    itemReplacements
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => [String(item.questionId ?? ""), item] as const)
      .filter(([questionId]) => Boolean(questionId))
  );
  const existingItemIds = new Set(
    paper.markScheme.items.map((item) => item.questionId)
  );
  merged.markScheme = {
    ...rawMarkScheme,
    ...markSchemeTopLevel,
    items: [
      ...paper.markScheme.items
        .filter((item) => !removeQuestionIds.has(item.questionId))
        .map((item) => itemsByQuestionId.get(item.questionId) ?? item),
      ...itemReplacements.filter((item) =>
        item &&
        typeof item === "object" &&
        !existingItemIds.has(String((item as Record<string, unknown>).questionId ?? ""))
      ),
    ],
  };
  return merged;
}

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
