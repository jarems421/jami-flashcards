import type { AiGenerationRole } from "@/lib/ai/provider-policy";
import type { Logger } from "@/lib/observability/logger";
import type { AssetRoutingIssue } from "@/lib/practice/asset-routing";
import {
  FIGURE_REVIEW_SYSTEM_INSTRUCTION,
  figureReviewRequest,
  figuresForReview,
  parseFigureReview,
} from "@/lib/practice/figure-review";
import type { GenerationPassRunner } from "@/services/ai/practice-paper-generation-passes.server";

/**
 * A second pair of eyes on a paper's drawn figures, before anything else is
 * paid for.
 *
 * A sanitised SVG is safe and well formed, and neither says it is the right
 * picture. The checks that need no model run in code; this asks one whether
 * each figure answers its question, and it is not the model that drew them:
 * it runs on the paper-check role, the worker unless that is switched back.
 *
 * One call for the whole paper, with the figures as they will be printed, and
 * bounded -- at most twelve, none over 8,000 characters -- so a paper with
 * many figures costs one short pass, not one per figure.
 *
 * A review that cannot run returns nothing to fix, and is logged as skipped
 * rather than passed: it must not read as approval, and it must never cost
 * the paper either. Its faults buy a redraw; they never refuse a paper.
 *
 * On by default; `PRACTICE_PAPER_FIGURE_REVIEW_ENABLED=false` turns it off.
 */
export async function reviewPaperFigures(input: {
  runPass: GenerationPassRunner;
  role: AiGenerationRole;
  log: Logger;
  questions: Parameters<typeof figuresForReview>[0];
  alreadyFaulted: readonly AssetRoutingIssue[];
}): Promise<{ ran: boolean; issues: AssetRoutingIssue[] }> {
  if (process.env.PRACTICE_PAPER_FIGURE_REVIEW_ENABLED === "false") return { ran: false, issues: [] };
  const figures = figuresForReview(input.questions, input.alreadyFaulted);
  if (figures.length === 0) return { ran: false, issues: [] };
  try {
    const pass = await input.runPass({
      name: "paper_design_figure_review",
      reasoningEffort: "low",
      taskClass: "important",
      role: input.role,
      systemInstruction: FIGURE_REVIEW_SYSTEM_INSTRUCTION,
      contents: [{ role: "user", parts: [{ text: figureReviewRequest(figures) }] }],
      temperature: 0,
      maxOutputTokens: 3_000,
      timeoutMs: 45_000,
    });
    const issues = parseFigureReview(pass.text, figures);
    if (!issues) {
      input.log.warn("paper_design.figure_review_skipped", { figureCount: figures.length, reason: "unreadable" });
      return { ran: false, issues: [] };
    }
    input.log.info("paper_design.figure_review", { figureCount: figures.length, faultCount: issues.length });
    return { ran: true, issues };
  } catch (error) {
    input.log.warn("paper_design.figure_review_skipped", { figureCount: figures.length, reason: "failed", error });
    return { ran: false, issues: [] };
  }
}
