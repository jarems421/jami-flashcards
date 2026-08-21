export type ExamBoardId =
  | "aqa"
  | "pearson_edexcel"
  | "ocr"
  | "eduqas"
  | "wjec"
  | "ccea";

export type ExamQualification = "gcse" | "a_level";
export type ExamFormatProfileStatus = "current" | "announced" | "retired";
export type ExamFormatVerificationStatus =
  | "verified"
  | "limited"
  | "conflicted"
  | "custom";

export type ExamFormatDocumentType =
  | "catalogue"
  | "specification"
  | "sample_paper"
  | "past_paper"
  | "mark_scheme"
  | "examiner_report"
  | "official_guidance";

export type ExamFormatSourceReceipt = {
  id: string;
  title: string;
  url: string;
  documentType: ExamFormatDocumentType;
  retrievedAt: number;
  documentHash: string;
  supports: string[];
};

export type ExamFormatVerificationIssue = {
  code:
    | "missing_specification"
    | "missing_assessment_artifact"
    | "conflicting_marks"
    | "conflicting_duration"
    | "conflicting_component"
    | "unsupported_assessment_type"
    | "stale_evidence";
  message: string;
  field?: string;
};

export type ExamFormatSection = {
  id: string;
  title: string;
  marks?: number;
  requiredQuestions?: number;
  availableQuestions?: number;
  instructions?: string;
};

export type ExamFormatRequiredMaterial = {
  kind: "formula_sheet" | "source_booklet" | "data_sheet" | "insert" | "permitted_text";
  title: string;
  supplied: boolean;
  instructions?: string;
};

export type ExamFormatProfileVersion = {
  profileId: string;
  version: string;
  board: ExamBoardId;
  boardLabel: string;
  qualification: ExamQualification;
  qualificationLabel: string;
  subject: string;
  specificationCode: string;
  specificationTitle: string;
  componentCode: string;
  componentTitle: string;
  tier?: string;
  calculatorPolicy?: "required" | "allowed" | "not_allowed" | "not_applicable";
  durationMinutes: number;
  totalMarks: number;
  sections: ExamFormatSection[];
  choiceRules: string[];
  assessmentObjectives: string[];
  topicExpectations: string[];
  tariffProgression: string[];
  commandWords: string[];
  requiredMaterials: ExamFormatRequiredMaterial[];
  formatSummary: string;
  status: ExamFormatProfileStatus;
  verificationStatus: ExamFormatVerificationStatus;
  confidence: "low" | "medium" | "high";
  issues: ExamFormatVerificationIssue[];
  sources: ExamFormatSourceReceipt[];
  effectiveFrom?: string;
  firstExamDate?: string;
  effectiveUntil?: string;
  supersedesVersion?: string;
  retrievedAt: number;
  verifiedAt?: number;
  createdAt: number;
};

export type ExamFormatProfile = {
  id: string;
  board: ExamBoardId;
  qualification: ExamQualification;
  subject: string;
  specificationCode: string;
  componentCode: string;
  activeVersion: string;
  status: ExamFormatProfileStatus;
  aliases: string[];
  latestRetrievedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type PracticePaperBrief = {
  profileId?: string;
  profileVersion?: string;
  board: string;
  qualification: string;
  subject: string;
  specification: string;
  component: string;
  tier?: string;
  durationMinutes: number;
  totalMarks: number;
  materials: string[];
  verificationStatus: ExamFormatVerificationStatus;
  confidence: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  customFallbackAvailable: boolean;
};

export type PracticePaperCompanionDocument = {
  id: string;
  role: "formula_sheet" | "source_booklet" | "data_sheet" | "insert" | "reference";
  title: string;
  instructions?: string;
  pages: Array<{
    id: string;
    title?: string;
    content: string;
    altText?: string;
  }>;
};

const BOARD_HOSTS: Record<ExamBoardId, string[]> = {
  aqa: ["aqa.org.uk", "filestore.aqa.org.uk"],
  pearson_edexcel: ["qualifications.pearson.com"],
  ocr: ["ocr.org.uk"],
  eduqas: ["eduqas.co.uk"],
  wjec: ["wjec.co.uk"],
  ccea: ["ccea.org.uk", "apps.ccea.org.uk"],
};

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function integer(value: unknown, maximum = 10_000) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.round(value)))
    : 0;
}

function list(value: unknown, count: number, length: number) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const normalized = text(item, length);
        return normalized ? [normalized] : [];
      }).slice(0, count)
    : [];
}

export function isOfficialExamBoardUrl(board: ExamBoardId, value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return BOARD_HOSTS[board].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function normalizeSources(board: ExamBoardId, value: unknown): ExamFormatSourceReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const source = candidate as Record<string, unknown>;
    const url = text(source.url, 2_000);
    const title = text(source.title, 240);
    if (!title || !isOfficialExamBoardUrl(board, url)) return [];
    const documentTypes = new Set<ExamFormatDocumentType>([
      "catalogue", "specification", "sample_paper", "past_paper", "mark_scheme",
      "examiner_report", "official_guidance",
    ]);
    const documentType = documentTypes.has(source.documentType as ExamFormatDocumentType)
      ? source.documentType as ExamFormatDocumentType
      : "official_guidance";
    return [{
      id: text(source.id, 100) || `source-${index + 1}`,
      title,
      url,
      documentType,
      retrievedAt: integer(source.retrievedAt, Number.MAX_SAFE_INTEGER) || Date.now(),
      documentHash: /^[a-f0-9]{64}$/i.test(text(source.documentHash, 128))
        ? text(source.documentHash, 128).toLowerCase()
        : "",
      supports: list(source.supports, 20, 100),
    }];
  });
}

function normalizeSections(value: unknown): ExamFormatSection[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const section = candidate as Record<string, unknown>;
    const titleValue = text(section.title, 160);
    if (!titleValue) return [];
    return [{
      id: text(section.id, 80) || `section-${index + 1}`,
      title: titleValue,
      marks: integer(section.marks) || undefined,
      requiredQuestions: integer(section.requiredQuestions, 100) || undefined,
      availableQuestions: integer(section.availableQuestions, 100) || undefined,
      instructions: text(section.instructions, 500) || undefined,
    }];
  });
}

function normalizeMaterials(value: unknown): ExamFormatRequiredMaterial[] {
  if (!Array.isArray(value)) return [];
  const kinds = new Set<ExamFormatRequiredMaterial["kind"]>([
    "formula_sheet", "source_booklet", "data_sheet", "insert", "permitted_text",
  ]);
  return value.slice(0, 12).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const material = candidate as Record<string, unknown>;
    const kind = kinds.has(material.kind as ExamFormatRequiredMaterial["kind"])
      ? material.kind as ExamFormatRequiredMaterial["kind"]
      : null;
    const titleValue = text(material.title, 160);
    if (!kind || !titleValue) return [];
    return [{
      kind,
      title: titleValue,
      supplied: material.supplied !== false,
      instructions: text(material.instructions, 500) || undefined,
    }];
  });
}

function verificationIssues(input: {
  sources: ExamFormatSourceReceipt[];
  durationMinutes: number;
  totalMarks: number;
  componentCode: string;
}) {
  const issues: ExamFormatVerificationIssue[] = [];
  if (!input.sources.some((source) => source.documentType === "specification")) {
    issues.push({ code: "missing_specification", message: "No official specification was confirmed." });
  }
  if (!input.sources.some((source) =>
    source.documentType === "sample_paper" ||
    source.documentType === "past_paper" ||
    source.documentType === "mark_scheme"
  )) {
    issues.push({ code: "missing_assessment_artifact", message: "No official paper or mark scheme was confirmed." });
  }
  if (!input.durationMinutes || !input.totalMarks || !input.componentCode) {
    issues.push({ code: "conflicting_component", message: "The component structure is incomplete." });
  }
  return issues;
}

export function normalizeExamFormatProfileVersion(
  value: unknown,
  fallback: { profileId: string; board: ExamBoardId; now?: number }
): ExamFormatProfileVersion | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const now = fallback.now ?? Date.now();
  const qualification: ExamQualification = raw.qualification === "a_level" ? "a_level" : "gcse";
  const sources = normalizeSources(fallback.board, raw.sources);
  const durationMinutes = integer(raw.durationMinutes, 600);
  const totalMarks = integer(raw.totalMarks, 1_000);
  const componentCode = text(raw.componentCode, 120);
  const derivedIssues = verificationIssues({ sources, durationMinutes, totalMarks, componentCode });
  const suppliedIssues: ExamFormatVerificationIssue[] = Array.isArray(raw.issues)
    ? raw.issues.slice(0, 20).flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const issue = candidate as Record<string, unknown>;
        const message = text(issue.message, 500);
        if (!message) return [];
        return [{
          code: "conflicting_component" as const,
          message,
          field: text(issue.field, 100) || undefined,
        }];
      })
    : [];
  const issues = [...derivedIssues, ...suppliedIssues];
  const verificationStatus: ExamFormatVerificationStatus =
    raw.verificationStatus === "custom" ? "custom" :
    suppliedIssues.length > 0 ? "conflicted" :
    issues.length === 0 ? "verified" : "limited";
  const subject = text(raw.subject, 160);
  const specificationCode = text(raw.specificationCode, 120);
  const componentTitle = text(raw.componentTitle, 200);
  if (!subject || !specificationCode || !componentTitle) return null;
  return {
    profileId: fallback.profileId,
    version: text(raw.version, 120) || `${now}`,
    board: fallback.board,
    boardLabel: text(raw.boardLabel, 120),
    qualification,
    qualificationLabel: text(raw.qualificationLabel, 120) || (qualification === "gcse" ? "GCSE" : "A level"),
    subject,
    specificationCode,
    specificationTitle: text(raw.specificationTitle, 240) || subject,
    componentCode,
    componentTitle,
    tier: text(raw.tier, 100) || undefined,
    calculatorPolicy: raw.calculatorPolicy === "required" || raw.calculatorPolicy === "allowed" ||
      raw.calculatorPolicy === "not_allowed" || raw.calculatorPolicy === "not_applicable"
      ? raw.calculatorPolicy : undefined,
    durationMinutes,
    totalMarks,
    sections: normalizeSections(raw.sections),
    choiceRules: list(raw.choiceRules, 20, 500),
    assessmentObjectives: list(raw.assessmentObjectives, 30, 300),
    topicExpectations: list(raw.topicExpectations, 80, 300),
    tariffProgression: list(raw.tariffProgression, 20, 300),
    commandWords: list(raw.commandWords, 40, 80),
    requiredMaterials: normalizeMaterials(raw.requiredMaterials),
    formatSummary: text(raw.formatSummary, 1_500),
    status: raw.status === "announced" || raw.status === "retired" ? raw.status : "current",
    verificationStatus,
    confidence: verificationStatus === "verified" ? "high" : verificationStatus === "conflicted" ? "low" : "medium",
    issues,
    sources,
    effectiveFrom: text(raw.effectiveFrom, 40) || undefined,
    firstExamDate: text(raw.firstExamDate, 40) || undefined,
    effectiveUntil: text(raw.effectiveUntil, 40) || undefined,
    supersedesVersion: text(raw.supersedesVersion, 120) || undefined,
    retrievedAt: integer(raw.retrievedAt, Number.MAX_SAFE_INTEGER) || now,
    verifiedAt: verificationStatus === "verified" ? now : undefined,
    createdAt: integer(raw.createdAt, Number.MAX_SAFE_INTEGER) || now,
  };
}

export function buildPracticePaperBrief(profile: ExamFormatProfileVersion): PracticePaperBrief {
  return {
    profileId: profile.profileId,
    profileVersion: profile.version,
    board: profile.boardLabel,
    qualification: profile.qualificationLabel,
    subject: profile.subject,
    specification: [profile.specificationTitle, profile.specificationCode].filter(Boolean).join(" · "),
    component: [profile.componentTitle, profile.componentCode].filter(Boolean).join(" · "),
    tier: profile.tier,
    durationMinutes: profile.durationMinutes,
    totalMarks: profile.totalMarks,
    materials: profile.requiredMaterials.map((material) => material.title),
    verificationStatus: profile.verificationStatus,
    confidence: profile.confidence,
    requiresConfirmation: profile.verificationStatus !== "verified" || profile.confidence === "low",
    customFallbackAvailable: profile.verificationStatus !== "verified",
  };
}

export function normalizePracticePaperBrief(value: unknown): PracticePaperBrief | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const board = text(raw.board, 120);
  const qualification = text(raw.qualification, 120);
  const subject = text(raw.subject, 160);
  const specification = text(raw.specification, 240);
  const component = text(raw.component, 240);
  if (!board || !qualification || !subject || !component) return undefined;
  const verificationStatus: ExamFormatVerificationStatus =
    raw.verificationStatus === "verified" || raw.verificationStatus === "conflicted" ||
    raw.verificationStatus === "custom" ? raw.verificationStatus : "limited";
  const confidence = raw.confidence === "high" || raw.confidence === "medium"
    ? raw.confidence : "low";
  return {
    profileId: text(raw.profileId, 180) || undefined,
    profileVersion: text(raw.profileVersion, 120) || undefined,
    board,
    qualification,
    subject,
    specification,
    component,
    tier: text(raw.tier, 100) || undefined,
    durationMinutes: integer(raw.durationMinutes, 600),
    totalMarks: integer(raw.totalMarks, 1_000),
    materials: list(raw.materials, 12, 160),
    verificationStatus,
    confidence,
    requiresConfirmation: raw.requiresConfirmation === true,
    customFallbackAvailable: raw.customFallbackAvailable === true,
  };
}

export function normalizePracticePaperCompanionDocuments(
  value: unknown
): PracticePaperCompanionDocument[] {
  if (!Array.isArray(value)) return [];
  const roles = new Set<PracticePaperCompanionDocument["role"]>([
    "formula_sheet", "source_booklet", "data_sheet", "insert", "reference",
  ]);
  return value.slice(0, 12).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Record<string, unknown>;
    const role = roles.has(raw.role as PracticePaperCompanionDocument["role"])
      ? raw.role as PracticePaperCompanionDocument["role"] : null;
    const titleValue = text(raw.title, 160);
    if (!role || !titleValue || !Array.isArray(raw.pages)) return [];
    const pages = raw.pages.slice(0, 40).flatMap((page, pageIndex) => {
      if (!page || typeof page !== "object") return [];
      const item = page as Record<string, unknown>;
      const content = text(item.content, 12_000);
      if (!content) return [];
      return [{
        id: text(item.id, 80) || `page-${pageIndex + 1}`,
        title: text(item.title, 160) || undefined,
        content,
        altText: text(item.altText, 500) || undefined,
      }];
    });
    if (pages.length === 0) return [];
    return [{
      id: text(raw.id, 80) || `companion-${index + 1}`,
      role,
      title: titleValue,
      instructions: text(raw.instructions, 500) || undefined,
      pages,
    }];
  });
}

export function selectExamFormatVersion(
  versions: readonly ExamFormatProfileVersion[],
  date = new Date()
) {
  const target = date.toISOString().slice(0, 10);
  return [...versions]
    .filter((version) => version.status !== "retired")
    .filter((version) => !version.effectiveFrom || version.effectiveFrom <= target)
    .filter((version) => !version.effectiveUntil || version.effectiveUntil >= target)
    .sort((left, right) =>
      (right.effectiveFrom ?? "").localeCompare(left.effectiveFrom ?? "") ||
      right.retrievedAt - left.retrievedAt
    )[0];
}

export function practicePaperFormatContext(profile: ExamFormatProfileVersion) {
  return [
    `Verified format profile: ${profile.profileId}@${profile.version}`,
    `${profile.boardLabel} ${profile.qualificationLabel} ${profile.subject}`,
    `Specification: ${profile.specificationTitle} (${profile.specificationCode})`,
    `Component: ${profile.componentTitle} (${profile.componentCode})${profile.tier ? `, ${profile.tier}` : ""}`,
    `Duration: ${profile.durationMinutes} minutes. Total marks: ${profile.totalMarks}.`,
    profile.calculatorPolicy ? `Calculator policy: ${profile.calculatorPolicy}.` : "",
    profile.sections.length ? `Sections: ${profile.sections.map((section) => `${section.title}${section.marks ? ` (${section.marks} marks)` : ""}`).join("; ")}.` : "",
    profile.choiceRules.length ? `Choice rules: ${profile.choiceRules.join("; ")}.` : "",
    profile.requiredMaterials.length ? `Required candidate materials: ${profile.requiredMaterials.map((material) => material.title).join("; ")}.` : "",
    profile.assessmentObjectives.length ? `Assessment objectives: ${profile.assessmentObjectives.join("; ")}.` : "",
    "This profile controls structure. Student-selected sources control taught content. Do not change the duration, total marks, sections, or choice rules.",
  ].filter(Boolean).join("\n");
}

export function practicePaperFormatIssues(input: {
  durationMinutes: number;
  totalMarks: number;
}, profile: ExamFormatProfileVersion) {
  const issues: string[] = [];
  if (input.durationMinutes !== profile.durationMinutes) {
    issues.push(`Duration must be ${profile.durationMinutes} minutes.`);
  }
  if (input.totalMarks !== profile.totalMarks) {
    issues.push(`Total marks must be ${profile.totalMarks}.`);
  }
  return issues;
}

const BOILERPLATE = new Set([
  "answer all questions", "show your working", "the marks for questions", "do not use a calculator",
  "you may use a calculator", "write your answers", "turn over", "total marks",
]);

function distinctiveTokens(value: string) {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function stableWindowHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function distinctiveQuestionWindowHashes(question: string) {
  const tokens = distinctiveTokens(question);
  const hashes: string[] = [];
  for (let index = 0; index <= tokens.length - 14; index += 1) {
    const window = tokens.slice(index, index + 14).join(" ");
    if (![...BOILERPLATE].some((phrase) => window.includes(phrase))) {
      hashes.push(stableWindowHash(window));
    }
  }
  return hashes;
}

export function findDistinctivePaperOverlap(
  questions: readonly string[],
  referenceQuestions: readonly string[]
) {
  const referenceWindows = new Map<string, number>();
  referenceQuestions.forEach((question, referenceIndex) => {
    const tokens = distinctiveTokens(question);
    for (let index = 0; index <= tokens.length - 14; index += 1) {
      const window = tokens.slice(index, index + 14).join(" ");
      if (![...BOILERPLATE].some((phrase) => window.includes(phrase))) {
        referenceWindows.set(window, referenceIndex);
      }
    }
  });
  return questions.flatMap((question, questionIndex) => {
    const tokens = distinctiveTokens(question);
    for (let index = 0; index <= tokens.length - 14; index += 1) {
      const window = tokens.slice(index, index + 14).join(" ");
      const referenceIndex = referenceWindows.get(window);
      if (referenceIndex !== undefined) return [{ questionIndex, referenceIndex, excerpt: window }];
    }
    return [];
  });
}
