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
  /**
   * Marks the paper awards beside the question for technical accuracy, which
   * are not this marker's to give. See `separateAwardMarks`.
   */
  separateAwardMarks?: number;
}): AiContentPart[] {
  const parts: AiContentPart[] = [{
    text: [
      `--- STUDENT ANSWER (${input.questionId}) ---`,
      input.answerText?.trim() || "The student supplied working only.",
      input.separateAwardMarks
        ? [
            `The printed paper also offers ${input.separateAwardMarks} marks for technical accuracy (AO4: spelling, punctuation, vocabulary and sentence structure), scored from a separate grid across the whole section.`,
            "Those marks are not yours to award and are not part of this question's total. Handwriting reaches you as a transcription, so spelling and punctuation cannot be judged from it honestly. Mark only the marks for answering the question, and do not deduct for technical accuracy.",
          ].join(" ")
        : "",
      input.workingImage
        ? [
            "The student's handwritten working follows, as one image holding every page they wrote on.",
            "They answered on the question paper itself, so each page is captioned with where it came from: \"written on printed page 2 of 3\" is working in the space the board printed for that part, and \"extra answer sheet 1\" is an answer that ran past it. Pages read left to right, then down.",
            "Only the handwriting is the student's. The printed page is shown to you separately and is not reproduced underneath their ink.",
            "Transcribe relevant lines before awarding method marks; never invent unreadable work.",
          ].join(" ")
        : "",
    ].filter(Boolean).join("\n"),
  }];
  if (input.workingImage) parts.push(input.workingImage);
  return parts;
}
