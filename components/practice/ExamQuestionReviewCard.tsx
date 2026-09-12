"use client";

import type { ReactNode } from "react";
import { Card, StudyText } from "@/components/ui";
import type { ExamQuestionReviewItem } from "@/services/practice/exam-corpus-review.server";

/**
 * One extracted question, shown beside the scheme it was paired with.
 *
 * The pairing is most of what is being judged, which is why the two sit side by
 * side rather than the scheme hiding behind a disclosure: a scheme belonging to
 * the question after this one reads perfectly well on its own and is only wrong
 * next to the question it was attached to.
 *
 * Shared by the review queue and the spot-check, because they are the same act
 * asking different questions of it -- "is this one right" against "is this
 * extraction right" -- and a reviewer moving between them should not have to
 * read two different layouts of the same material.
 */
export default function ExamQuestionReviewCard({
  item,
  actions,
  tone,
}: {
  item: ExamQuestionReviewItem;
  actions?: ReactNode;
  tone?: "default" | "warm";
}) {
  return (
    <Card padding="lg" tone={tone === "warm" ? "warm" : undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-text-muted">
          {item.provenance.boardLabel} · {item.provenance.series} {item.provenance.year} ·{" "}
          {item.provenance.paperReference} · Q{item.provenance.questionNumber}
        </p>
        <span className="text-xs font-medium text-text-muted">
          {item.marks} mark{item.marks === 1 ? "" : "s"} · {item.difficulty}
        </span>
      </div>

      {item.review.by ? (
        <p className="mt-2 text-xs text-text-muted">
          {item.review.by === "ai" ? "Reviewed by Jami" : "Reviewed by you"} · {item.review.status}
          {item.review.notes.length ? ` · ${item.review.notes.join(" ")}` : ""}
        </p>
      ) : null}

      {item.verification && item.verification.issues.length > 0 ? (
        <ul className="mt-3 space-y-1 rounded-2xl border border-error/30 bg-error/10 p-3">
          {item.verification.issues.map((issue, index) => (
            <li key={index} className="text-sm text-text-primary">
              · {issue}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-text-secondary">Question</h3>
          <StudyText
            as="div"
            text={item.prompt}
            className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-primary"
          />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-secondary">
            Paired scheme · {item.markScheme.regime}
          </h3>
          {item.markScheme.criteria.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {item.markScheme.criteria.map((criterion) => (
                <li key={criterion.id} className="text-sm leading-5 text-text-primary">
                  <span className="text-text-muted">[{criterion.marks}]</span> {criterion.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-text-muted">
              No awardable criteria were parsed. Reject unless the regime explains it.
            </p>
          )}
          {item.markScheme.officialText ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-text-secondary">
                Scheme text as extracted
              </summary>
              <StudyText
                as="div"
                text={item.markScheme.officialText}
                className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-muted"
              />
            </details>
          ) : null}
        </div>
      </div>

      {actions ? <div className="mt-5 flex flex-wrap gap-2">{actions}</div> : null}
    </Card>
  );
}
