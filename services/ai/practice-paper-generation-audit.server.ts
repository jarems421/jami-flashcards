import { captureGenerationPass } from "@/lib/ai/generation-capture";
import {
  applyPracticePaperAuditRepairPatch,
  parsePracticePaperModelAnswer,
  type ParsedPracticePaperModelAnswer,
} from "@/lib/ai/practice-paper-generation";
import {
  isCompletePracticePaperCandidate,
  parsePracticePaperQualityAudit,
} from "@/lib/ai/practice-paper-quality";
import type { AiGenerationRole } from "@/lib/ai/provider-policy";
import type { ReadyPracticePaper } from "@/services/ai/practice-paper-generation-design.server";
import {
  parseJsonObject,
  type GenerationStageInput,
} from "@/services/ai/practice-paper-generation-passes.server";
import { failure } from "@/services/ai/practice-paper-generation-request.server";

/**
 * The audit stage: an independent check of the complete paper, a minimal
 * repair when it finds substantiated issues, a re-audit of that repair, and a
 * juror for whatever the re-audit still disputes.
 */

/**
 * Returns the paper to release with the findings behind it, or the refunded
 * failure that ends the request.
 */
export async function auditPracticePaper(
  input: GenerationStageInput & {
    schemeCandidate: ReadyPracticePaper;
    paperCheckRole: AiGenerationRole;
    formatContext?: string;
  }
) {
  const { runPass, refund, log, sourceRefs, parsedRequest, schemeCandidate, paperCheckRole, formatContext } = input;
  let finalPaper: ParsedPracticePaperModelAnswer = schemeCandidate;
  /**
   * The document the audit is about to judge.
   *
   * Every model response is captured and none of the inputs were, so when the
   * auditor reported that seventeen of eighteen questions had no marking
   * guidance, there was no way to tell whether it had hallucinated or had
   * genuinely been handed a paper missing its schemes. Replaying the same
   * model, provider, cap and JSON mode over the reconstructed paper found all
   * three swapped schemes and invented nothing, which means the production
   * failure was probably about what it was sent -- and that is the one thing
   * that was not kept.
   */
  captureGenerationPass({
    pass: "paper_audit_input",
    role: "supervisor",
    modelName: "n/a",
    text: JSON.stringify(schemeCandidate),
  });
  const auditPass = await runPass({
    name: "paper_audit",
    reasoningEffort: "low",
    taskClass: "important",
    role: paperCheckRole,
    systemInstruction: `You are Jami's senior independent assessment supervisor. Check the complete paper and marking guide for factual correctness, answerability, coverage, source alignment, duplicated or ambiguous questions, impossible assets, mark-total errors, choice-rule errors, timing realism, rubric correctness and whether it is genuinely a complete sitting. Do not rewrite the paper. Return JSON only as {"pass":true,"issues":[]} or {"pass":false,"issues":[{"code":"short_code","severity":"warning"|"error","detail":"specific evidence and required correction","questionId":"optional"}]}. Only report substantiated issues.`,
    contents: [{
      role: "user" as const,
      parts: [{ text: `${formatContext ? `--- REQUIRED FORMAT ---\n${formatContext}\n\n` : ""}${JSON.stringify(schemeCandidate)}` }],
    }],
    temperature: 0,
    maxOutputTokens: 4_000,
  });
  const audit = parsePracticePaperQualityAudit(auditPass.text);
  if (!audit) {
    await refund("invalid_audit_response");
    return failure(
      "Jami could not complete the paper quality check. Try again in a moment.",
      502,
      "invalid_audit_response"
    );
  }

  let repairModelName = "";
  let finalAudit = audit;
  if (!audit.pass) {
    log.warn("paper_audit.issues_found", {
      issueCount: audit.issues.length,
      issueCodes: Array.from(new Set(audit.issues.map((issue) => issue.code))),
      affectedQuestionCount: new Set(
        audit.issues.flatMap((issue) => issue.questionId ? [issue.questionId] : [])
      ).size,
    });
    const repairPass = await runPass({
      name: "paper_repair",
      taskClass: "important",
      role: "supervisor",
      systemInstruction: `You are Jami's assessment editor working from a senior supervisor's findings. Return a MINIMAL PATCH, never the complete paper. Repair every substantiated issue while preserving everything unaffected. Return valid JSON only with this schema: {"topLevel":{},"questionReplacements":[],"markSchemeTopLevel":{},"markSchemeItemReplacements":[],"removeQuestionIds":[]}. Include a full replacement question and its full matching mark-scheme item only when that question must change. Use topLevel only for changed paper fields such as instructions, durationMinutes, choiceGroups or companionDocuments. Use markSchemeTopLevel only for changed guide-level fields. Keep question IDs stable wherever possible. Every changed or new question must have exactly one matching replacement mark-scheme item. Do not copy unchanged questions or unchanged mark-scheme items into the response.`,
      contents: [{
        role: "user" as const,
        parts: [{
          text: `--- PAPER ---\n${JSON.stringify(schemeCandidate)}\n\n--- SUBSTANTIATED AUDIT ISSUES ---\n${JSON.stringify(audit.issues)}`,
        }],
      }],
      temperature: 0.1,
      maxOutputTokens: 20_000,
    });
    repairModelName = repairPass.modelName;
    const parseRepair = (text: string) => {
      try {
        const payload = parseJsonObject(text);
        const merged = applyPracticePaperAuditRepairPatch(schemeCandidate, payload);
        return merged && parsePracticePaperModelAnswer(JSON.stringify(merged), {
          allowedSourceRefs: sourceRefs,
          length: parsedRequest.length,
        });
      } catch {
        return null;
      }
    };
    let repaired = parseRepair(repairPass.text);
    if (!repaired || !isCompletePracticePaperCandidate(repaired)) {
      log.warn("paper_repair.patch_unreadable", {
        initialResponseBytes: Buffer.byteLength(repairPass.text, "utf8"),
      });
      const retryPass = await runPass({
        name: "paper_repair_structured_retry",
        taskClass: "important",
        role: "worker",
        systemInstruction: `Correct the malformed assessment repair patch. Return JSON only as {"topLevel":{},"replacements":[{"question":{FULL QUESTION WITH ORIGINAL id},"markSchemeItem":{FULL MATCHING ITEM WITH questionId EQUAL TO THE QUESTION id}}],"markSchemeTopLevel":{},"removeQuestionIds":[]}. Include only questions that must change. Do not return the complete paper. Preserve the original IDs and use the exact field structures shown in the original paper.`,
        contents: [{
          role: "user" as const,
          parts: [{
            text: `--- ORIGINAL PAPER ---\n${JSON.stringify(schemeCandidate)}\n\n--- AUDIT ISSUES ---\n${JSON.stringify(audit.issues)}\n\n--- MALFORMED PATCH TO CORRECT ---\n${repairPass.text}`,
          }],
        }],
        temperature: 0,
        maxOutputTokens: 20_000,
      });
      repairModelName = retryPass.modelName;
      repaired = parseRepair(retryPass.text);
    }
    if (!repaired || !isCompletePracticePaperCandidate(repaired)) {
      await refund("invalid_repair_response");
      return failure(
        "Jami found quality issues but could not repair the paper safely. Try again with stronger source material.",
        502,
        "invalid_repair_response"
      );
    }
    finalPaper = repaired;

    const reAuditPass = await runPass({
      name: "paper_reaudit",
      reasoningEffort: "low",
      taskClass: "important",
      role: paperCheckRole,
      systemInstruction: `You are Jami's senior independent assessment supervisor. Verify whether the supplied repair resolves the earlier issues without introducing new factual, answerability, coverage, timing, ambiguity, scoring, rubric or source-fidelity problems. Do not rewrite the paper. Return JSON only as {"pass":true,"issues":[]} or {"pass":false,"issues":[{"code":"short_code","severity":"warning"|"error","detail":"specific evidence","questionId":"optional"}]}.`,
      contents: [{
        role: "user" as const,
        parts: [{
          text: `--- REPAIRED PAPER ---\n${JSON.stringify(finalPaper)}\n\n--- ORIGINAL AUDIT ---\n${JSON.stringify(audit.issues)}`,
        }],
      }],
      temperature: 0,
      maxOutputTokens: 4_000,
    });
    finalAudit = parsePracticePaperQualityAudit(reAuditPass.text) ?? {
      pass: false,
      issues: [{
        code: "invalid_reaudit",
        severity: "error" as const,
        detail: "The repaired paper could not be independently verified.",
        questionId: undefined,
      }],
    };

    if (!finalAudit.pass) {
      const jurorPass = await runPass({
        name: "paper_quality_juror",
        taskClass: "important",
        role: "juror",
        systemInstruction: `You are the final independent assessment-quality juror. Decide whether the remaining audit findings are material enough to make this complete paper unsafe or inauthentic to release. Do not rewrite it. Return JSON only as {"pass":true,"issues":[]} or {"pass":false,"issues":[{"code":"short_code","severity":"warning"|"error","detail":"specific evidence","questionId":"optional"}]}.`,
        contents: [{
          role: "user" as const,
          parts: [{
            text: `--- PAPER ---\n${JSON.stringify(finalPaper)}\n\n--- UNRESOLVED FINDINGS ---\n${JSON.stringify(finalAudit.issues)}`,
          }],
        }],
        temperature: 0,
        maxOutputTokens: 4_000,
      });
      finalAudit = parsePracticePaperQualityAudit(jurorPass.text) ?? finalAudit;
      if (!finalAudit.pass) {
        await refund("unresolved_quality_issues");
        return failure(
          "Jami found unresolved quality issues and did not release the paper.",
          422,
          "unresolved_quality_issues"
        );
      }
    }
  }
  return { finalPaper, audit, finalAudit, repairModelName };
}
