import { forgetGenerationCheckpoint } from "@/lib/ai/generation-checkpoint";
import {
  buildPracticePaperGenerationResponse,
  parsePracticePaperModelAnswer,
  type ParsedPracticePaperModelAnswer,
} from "@/lib/ai/practice-paper-generation";
import { isCompletePracticePaperCandidate } from "@/lib/ai/practice-paper-quality";
import type { Source } from "@/lib/material/sources";
import { paperFigureIssues } from "@/lib/practice/asset-routing";
import { sectionMarkIssues } from "@/lib/practice/exam-formats";
import {
  parseJsonObject,
  type GenerationContents,
  type GenerationStageInput,
} from "@/services/ai/practice-paper-generation-passes.server";
import { paperRasterEnabled } from "@/services/ai/practice-paper-generation-prompts.server";
import { failure } from "@/services/ai/practice-paper-generation-request.server";

/**
 * The design stage: one complete candidate paper, held to the exam format
 * before any mark-scheme work is paid for.
 */

export type ReadyPracticePaper = Extract<ParsedPracticePaperModelAnswer, { status: "ready" }>;

function withProvisionalMarkScheme(value: string) {
  try {
    const payload = parseJsonObject(value);
    if (payload.status !== "ready" || !Array.isArray(payload.questions)) {
      return value;
    }
    const items = payload.questions.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const question = candidate as Record<string, unknown>;
      const questionId = typeof question.id === "string" ? question.id.trim() : "";
      const marks = typeof question.marks === "number" && Number.isFinite(question.marks)
        ? Math.max(1, Math.round(question.marks))
        : 0;
      if (!questionId || marks === 0) return [];
      return [{
        questionId,
        marking: "additive",
        maxMarks: marks,
        answer: "Provisional; replaced before release.",
        acceptableAlternatives: [],
        commonMistakes: [],
        points: [{
          id: `${questionId}.draft`,
          marks,
          code: "B",
          text: "Provisional credit allocation; replaced before release.",
          dep: [],
          ft: false,
          essentialTerms: [],
          allow: [],
          reject: [],
        }],
      }];
    });
    payload.markScheme = {
      kind: "generated",
      label: "Jami-generated marking guide",
      notice: "This is not an official mark scheme.",
      items,
    };
    return JSON.stringify(payload);
  } catch {
    return value;
  }
}

/**
 * Designs the paper, or returns the response that ends the request: a
 * clarifying question for the student, or a refunded failure.
 */
export async function designPracticePaper(
  input: GenerationStageInput & {
    systemInstruction: string;
    contents: GenerationContents;
    prepared: readonly { reference: string; source: Source }[];
    expectedTotalMarks?: number;
    expectedSections?: readonly { id: string; title?: string; marks: number }[];
  }
): Promise<Response | ReadyPracticePaper> {
  const {
    runPass,
    refund,
    log,
    sourceRefs,
    parsedRequest,
    systemInstruction,
    contents,
    prepared,
    expectedTotalMarks,
    expectedSections,
  } = input;
  let paperPass = await runPass({
    name: "paper_design",
    taskClass: "important",
    role: "supervisor",
    systemInstruction,
    contents,
    temperature: 0.25,
    maxOutputTokens: 20_000,
    // Keyed on the sources the paper is built from, which is what makes two
    // runs the same piece of work. The most expensive single call in the
    // pipeline at 20,000 tokens on the supervisor, and until now it was paid
    // for again every time a later batch failed.
    checkpoint: { pass: "paper_design", subject: sourceRefs },
  });
  let draft = parsePracticePaperModelAnswer(withProvisionalMarkScheme(paperPass.text), {
    allowedSourceRefs: sourceRefs,
    length: parsedRequest.length,
  });
  if (!draft) {
    paperPass = await runPass({
      name: "paper_design_structured_retry",
      reasoningEffort: "low",
      taskClass: "important",
      role: "supervisor",
      systemInstruction: `${systemInstruction}\nThe previous response was structurally invalid. Return one complete JSON object with every required candidate-paper field, keep markScheme.items empty, and include no prose outside the JSON.`,
      contents,
      temperature: 0.1,
      maxOutputTokens: 20_000,
    });
    draft = parsePracticePaperModelAnswer(withProvisionalMarkScheme(paperPass.text), {
      allowedSourceRefs: sourceRefs,
      length: parsedRequest.length,
    });
  }
  if (!draft) {
    await refund("invalid_provider_response");
    return failure(
      "Jami could not build a reliable paper from that material. Try making the request more specific.",
      502,
      "invalid_provider_response"
    );
  }

  if (draft.status === "needs_clarification") {
    const response = buildPracticePaperGenerationResponse({
      parsed: draft,
      sourcesByRef: new Map(
        prepared.map((item) => [item.reference, item.source] as const)
      ),
    });
    return Response.json(response);
  }

  /**
   * Every asset is the kind of thing it should be.
   *
   * Two generators fail in opposite directions: an image model returns a
   * usable micrograph no drawing could achieve, and a triangle whose marked
   * 47 degrees measures sixty. Nothing downstream reads a picture, so a
   * measured figure sent to an image model reaches a candidate as a question
   * that cannot be answered from what is in front of them. Checked here,
   * before an image is paid for rather than after.
   */
  const routing = paperFigureIssues(draft.questions, { rasterEnabled: paperRasterEnabled() });
  if (routing.length > 0) {
    log.warn("paper_design.asset_routing", {
      issueCount: routing.length,
      issueCodes: Array.from(new Set(routing.map((issue) => issue.code))),
    });
    forgetGenerationCheckpoint({ pass: "paper_design", subject: sourceRefs });
    forgetGenerationCheckpoint({ pass: "paper_design_total_retry", subject: sourceRefs });
    await refund("asset_routing");
    return failure(
      "Jami asked for the wrong kind of figure: " +
        routing.slice(0, 3).map((issue) => issue.detail).join(" ") ,
      422,
      "asset_routing"
    );
  }

  if (!isCompletePracticePaperCandidate(draft)) {
    await refund("incomplete_paper");
    return failure(
      "Jami produced a short practice set instead of a complete paper. Add a past paper or assessment brief and try again.",
      422,
      "incomplete_paper"
    );
  }

  /**
   * Whether the paper is worth what the profile says, checked before any
   * mark-scheme work is paid for.
   *
   * Nothing compared these. A draft built against a profile stating 96 marks
   * came back at 80 with one set of instructions and at 166 with another --
   * eight questions in the first case, thirty in the second, one of them
   * worth nothing -- and both went on to consume roughly twenty further model
   * calls before the whole-paper audit refused them. The audit was right and
   * far too late: a paper that does not total what it must was already wrong
   * when the design pass returned.
   *
   * Fails rather than repairs, deliberately. Reaching a required total means
   * adding or removing questions, which is designing the paper again, and
   * doing that silently inside a repair loop is how a run spends an hour
   * getting further from a correct answer.
   *
   * For a long time this caught a gap it could not close. A question carried
   * id, label, prompt, marks and assets and no section, so a profile stating
   * "four sections of 24 marks" described something the output format could
   * not express, and the designer answered with a flat list that nothing held
   * to those totals: ten drafts of the same 96-mark component came back at
   * 80, 96, 97, 136, 143, 154, 164, 169, 177 and 178 marks.
   *
   * A question can now name its section, and the section check below holds
   * each one to its own total. The first draft under that schema did use the
   * sections -- and sized them 43/41/41/43 against a required 24 each, because
   * the format context listed section titles and marks but never the ids the
   * check compares against. It was asked to make section A worth 24 marks
   * without being told which section was A.
   */
  /**
   * One retry that tells the designer what it actually built.
   *
   * The instruction already states the total and the sections and says not
   * to change them, and three drafts came back at 80, 164 and 143 against a
   * required 96 regardless. Repeating the same instruction would be the
   * fourth. What it has never been told is its own arithmetic: how many
   * marks it produced, how far off that is, and that a question carries no
   * section so the sections have to be built from the order and the tariffs.
   *
   * The mark-scheme batches already recover this way, by being handed the
   * specific fault rather than the original instruction again.
   */
  /*
   * And its sections' arithmetic, section by section, because a paper can be
   * right overall and wrong in every section, and "rebuild it" was taken as
   * "start again": the retry wrote a new paper with new mistakes. A WJEC
   * Chemistry draft built Section B at 52 marks against 70 and had no second
   * chance at all, since only a wrong total bought a retry. It is now told what
   * each section came to, asked to repair rather than rebuild, and kept only
   * if every sum is right.
   */
  const wrongSections = expectedSections?.length
    ? sectionMarkIssues(draft.questions, expectedSections, draft.choiceGroups).wrong
    : [];
  const totalWrong = Boolean(expectedTotalMarks) && draft.totalMarks !== expectedTotalMarks;
  if (totalWrong || wrongSections.length > 0) {
    const built = draft.questions.map((question) => question.marks).join(" + ");
    const sectionLines = wrongSections
      .map((entry) =>
        `Section ${entry.section} came to ${entry.actual} marks and must be ${entry.expected} (${entry.actual < entry.expected ? `${entry.expected - entry.actual} short` : `${entry.actual - entry.expected} over`}).`
      )
      .join(" ");
    paperPass = await runPass({
      name: "paper_design_total_retry",
      taskClass: "important",
      role: "supervisor",
      systemInstruction:
        `${systemInstruction}\nYour previous paper was worth ${draft.totalMarks} marks across ` +
        `${draft.questions.length} questions (${built})` +
        (expectedTotalMarks ? `, and this component is worth exactly ${expectedTotalMarks}.` : ".") +
        (sectionLines ? ` ${sectionLines}` : "") +
        " Repair it rather than starting again: keep the questions that already fit, and change only what makes a sum wrong -- " +
        "add questions or raise tariffs in a section that is short, remove or lower them in one that is over. " +
        "Every question's section field is the bare identifier the profile gives its section; emit each section's questions " +
        "together in order. Do not add sections beyond those the profile lists. Before returning, add up each section's marks " +
        "and the paper's total and check each equals its figure.",
      contents,
      temperature: 0.1,
      maxOutputTokens: 20_000,
      checkpoint: { pass: "paper_design_total_retry", subject: sourceRefs },
    });
    const retried = parsePracticePaperModelAnswer(withProvisionalMarkScheme(paperPass.text), {
      allowedSourceRefs: sourceRefs,
      length: parsedRequest.length,
    });
    const retriedSectionsRight =
      !expectedSections?.length ||
      (retried?.status === "ready" &&
        sectionMarkIssues(retried.questions, expectedSections, retried.choiceGroups).wrong.length === 0);
    if (
      retried &&
      retried.status === "ready" &&
      (!expectedTotalMarks || retried.totalMarks === expectedTotalMarks) &&
      retriedSectionsRight
    ) {
      log.info("paper_design.total_corrected", {
        from: draft.totalMarks,
        to: retried.totalMarks,
        sectionsCorrected: wrongSections.length,
      });
      draft = retried;
    }
  }

  /**
   * The sections, now that a question can say which one it is in.
   *
   * The paper total alone lets a draft be right overall and wrong
   * throughout, and a student practising a 24-mark section against 40 marks
   * of questions has been misled about the paper they will sit.
   */
  if (expectedSections && expectedSections.length > 0) {
    const { wrong, built } = sectionMarkIssues(draft.questions, expectedSections, draft.choiceGroups);
    if (wrong.length > 0) {
      // The sections it did build, so a naming mismatch is distinguishable
      // from a marks mismatch in the log rather than by rerunning.
      log.warn("paper_design.section_mismatch", { sections: wrong, built: [...built] });
      forgetGenerationCheckpoint({ pass: "paper_design", subject: sourceRefs });
      forgetGenerationCheckpoint({ pass: "paper_design_total_retry", subject: sourceRefs });
      await refund("paper_section_mismatch");
      return failure(
        "Jami built sections that do not match this component: " +
          wrong.map((entry) => `${entry.section} is ${entry.actual} marks, not ${entry.expected}`).join("; ") + ".",
        422,
        "paper_section_mismatch"
      );
    }
  }

  if (expectedTotalMarks && draft.totalMarks !== expectedTotalMarks) {
    // Forget both, so a rerun draws a new paper rather than replaying this
    // one. The design varies widely between attempts on the same request, and
    // a cached failure is what stopped retrying from ever escaping it.
    forgetGenerationCheckpoint({ pass: "paper_design", subject: sourceRefs });
    forgetGenerationCheckpoint({ pass: "paper_design_total_retry", subject: sourceRefs });
    log.warn("paper_design.total_mismatch", {
      expected: expectedTotalMarks,
      actual: draft.totalMarks,
      questions: draft.questions.length,
    });
    await refund("paper_total_mismatch");
    return failure(
      `Jami built a paper worth ${draft.totalMarks} marks where this component is worth ${expectedTotalMarks}. Try again, or check the exam format profile.`,
      422,
      "paper_total_mismatch"
    );
  }
  return draft;
}
