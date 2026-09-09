import type { AiContentPart } from "@/lib/ai/content-parts";
import type {
  PracticePaper,
  PracticePaperQuestion,
} from "@/lib/practice/practice-papers";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";

export type SingleQuestionPaperInput = {
  id: string;
  folderId: string;
  title: string;
  question: PracticePaperQuestion;
  markSchemeItem: PracticePaperMarkSchemeItem;
  studyLevel: string;
  qualification: string;
  awardingBody: string;
  specification: string;
  component?: string;
  formatSummary?: string;
  markSchemeKind?: "generated" | "official" | "estimated" | "missing";
  markSchemeLabel?: string;
  markSchemeNotice?: string;
};

/** The production and evaluation paths share this exact synthetic paper. */
export function buildSingleQuestionPaper(input: SingleQuestionPaperInput): PracticePaper {
  const now = 0;
  return {
    id: input.id,
    notebookId: input.id,
    folderId: input.folderId,
    title: input.title,
    origin: "uploaded",
    status: "submitted",
    sourceIds: [],
    sourceLabels: [],
    request: "",
    coverage: "",
    length: "full",
    focus: "balanced",
    durationMinutes: 0,
    timingMode: "untimed",
    timingState: "submitted",
    totalPausedMs: 0,
    deadlineVersion: 1,
    tutorEnabled: false,
    tutorUsed: false,
    timerEnabled: false,
    instructions: [],
    assessmentProfile: {
      studyLevel: input.studyLevel,
      qualificationOrModule: input.qualification,
      awardingBodyOrInstitution: input.awardingBody,
      specificationOrCourse: input.specification,
      tierOrComponent: input.component ?? "",
      formatSummary:
        input.formatSummary ??
        `Single ${input.specification} question worth ${input.question.marks} marks.`,
      confidence: "high",
    },
    questions: [input.question],
    choiceGroups: [],
    totalMarks: input.question.marks,
    markScheme: {
      kind: input.markSchemeKind ?? "official",
      label: input.markSchemeLabel ?? "Official mark scheme",
      notice: input.markSchemeNotice ?? "Apply the published guide exactly.",
      items: [input.markSchemeItem],
    },
    gradeGuidance: { kind: "none", label: "Not applicable", notice: "", boundaries: [] },
    examinerInsights: [],
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildSingleQuestionAnswerParts(input: {
  questionId: string;
  answerText?: string;
  workingImage?: AiContentPart;
}): AiContentPart[] {
  const parts: AiContentPart[] = [{
    text: [
      `--- STUDENT ANSWER (${input.questionId}) ---`,
      input.answerText?.trim() || "The student supplied working only.",
      input.workingImage
        ? "The student's handwritten working follows. Transcribe relevant lines before awarding method marks; never invent unreadable work."
        : "",
    ].filter(Boolean).join("\n"),
  }];
  if (input.workingImage) parts.push(input.workingImage);
  return parts;
}
