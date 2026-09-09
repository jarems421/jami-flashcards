"use client";

import { useEffect, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import { ButtonLink, Card, EmptyState, FeedbackBanner, Skeleton } from "@/components/ui";
import { EXAM_BOARD_LABELS } from "@/lib/practice/exam-formats";
import type { ExamSession } from "@/lib/practice/exam-questions";
import { listPastPaperPracticeSessions } from "@/services/study/exam-practice";

function dateLabel(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default function ExamPracticeHistory({
  folderId,
  embedded = false,
}: {
  folderId?: string;
  embedded?: boolean;
}) {
  const [sessions, setSessions] = useState<ExamSession[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void listPastPaperPracticeSessions(folderId)
      .then(setSessions)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Practice history could not be loaded.")
      );
  }, [folderId]);

  const startHref = `/dashboard/practice/questions/new${
    folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""
  }`;

  let content;
  if (error) {
    content = <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} />;
  } else if (sessions === null) {
    content = (
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="h-40" />
        ))}
      </div>
    );
  } else if (sessions.length === 0) {
    content = (
      <EmptyState
        emoji="📄"
        title="Your practice will appear here"
        description="Finish or pause a Past Paper Practice session and you can come back to every answer and mark."
        action={<ButtonLink href={startHref}>Start practice</ButtonLink>}
      />
    );
  } else {
    content = (
      <div className="grid gap-3 md:grid-cols-2">
        {sessions.map((session) => {
          const percent = session.maxTotal
            ? Math.round((session.awardedTotal / session.maxTotal) * 100)
            : 0;
          const complete = session.status === "completed";
          return (
            <Card key={session.id} padding="md">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-muted">
                    {session.folderName} · {dateLabel(session.updatedAt)}
                  </p>
                  <h2 className="mt-2 truncate text-lg font-semibold text-text-primary">
                    {session.subject}
                  </h2>
                  <p className="mt-1 truncate text-sm text-text-secondary">
                    {EXAM_BOARD_LABELS[session.course.board] ?? session.course.board} ·{" "}
                    {session.course.specificationTitle}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    complete ? "bg-success/15 text-success" : "bg-[var(--color-glass-subtle)] text-text-muted"
                  }`}
                >
                  {complete ? "Complete" : "In progress"}
                </span>
              </div>
              <div className="mt-6 flex items-end justify-between gap-4">
                <div>
                  <p className="text-3xl font-semibold tracking-tight text-text-primary">
                    {session.awardedTotal}
                    <span className="text-base font-normal text-text-muted">/{session.maxTotal}</span>
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {session.answeredCount} of {session.questions.length} marked · {percent}%
                  </p>
                </div>
                <ButtonLink
                  href={`/dashboard/practice/questions/${encodeURIComponent(session.id)}`}
                  variant="secondary"
                  size="sm"
                >
                  {complete ? "Review" : "Continue"}
                </ButtonLink>
              </div>
            </Card>
          );
        })}
      </div>
    );
  }

  if (embedded) return content;
  return (
    <AppPage
      title="Practice history"
      backHref="/dashboard/practice"
      backLabel="Practice"
      width="study"
      action={<ButtonLink href={startHref}>Start practice</ButtonLink>}
    >
      <p className="mb-5 text-sm text-text-muted">
        Every question, mark and improvement in one calm place.
      </p>
      {content}
    </AppPage>
  );
}
