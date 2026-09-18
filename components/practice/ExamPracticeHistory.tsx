"use client";

import { useEffect, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import { Button, ButtonLink, Card, EmptyState, FeedbackBanner, Skeleton } from "@/components/ui";
import { examCourseName } from "@/lib/practice/exam-course-names";
import { EXAM_BOARD_LABELS } from "@/lib/practice/exam-formats";
import type { ExamSession } from "@/lib/practice/exam-questions";
import { examSessionQuestionRuns } from "@/lib/practice/exam-question-groups";
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
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void listPastPaperPracticeSessions(folderId)
      .then((page) => {
        if (!active) return;
        setSessions(page.sessions);
        setCursor(page.nextCursor);
      })
      .catch((reason) =>
        active &&
        setError(reason instanceof Error ? reason.message : "Practice history could not be loaded.")
      );
    return () => {
      active = false;
    };
  }, [folderId]);

  // Older work is reached rather than lost: the list used to stop at a hundred
  // sessions with nothing behind them.
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listPastPaperPracticeSessions(folderId, cursor);
      setSessions((current) => [...(current ?? []), ...page.sessions]);
      setCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "More practice could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  };

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
      <div className="app-rise grid gap-3 md:grid-cols-2">
        {sessions.map((session) => {
          const complete = session.status === "completed";
          /*
           * An unfinished session is scored against what has actually been
           * marked. Against the whole paper's marks, one perfect answer of five
           * questions read as 20% -- indistinguishable from a completed session
           * that went badly.
           */
          const denominator = complete
            ? session.maxTotal
            : session.assessedTotal ?? session.maxTotal;
          const percent = denominator
            ? Math.round((session.awardedTotal / denominator) * 100)
            : 0;
          const questionCount = examSessionQuestionRuns(session.questions).length;
          return (
            <Card key={session.id} padding="md">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-muted">
                    {session.folderName} · {dateLabel(session.updatedAt)}
                  </p>
                  <h2 className="mt-2 truncate text-lg font-semibold text-text-primary">
                    {examCourseName(session.course)}
                  </h2>
                  <p className="mt-1 truncate text-sm text-text-secondary">
                    {[EXAM_BOARD_LABELS[session.course.board] ?? session.course.board, session.course.tier]
                      .filter(Boolean)
                      .join(" · ")}
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
              {/* The numbered questions its parts came from. */}
              <div className="mt-6 flex items-end justify-between gap-4">
                <div>
                  <p className="text-3xl font-semibold tracking-tight text-text-primary">
                    {session.awardedTotal}
                    <span className="text-base font-normal text-text-muted">/{denominator}</span>
                  </p>
                  {/*
                    * Questions and parts, said as two numbers rather than one.
                    *
                    * This read "3 of 14 marked" for a session of two questions,
                    * which is the count the session itself used to show and the
                    * one nobody chose. `answeredCount` is parts and stays parts,
                    * because Progress is built on it -- so the questions are
                    * named alongside instead of in place of them.
                    */}
                  <p className="mt-1 text-xs text-text-muted">
                    {questionCount} question{questionCount === 1 ? "" : "s"}
                    {session.questions.length > questionCount
                      ? ` · ${session.answeredCount} of ${session.questions.length} parts marked`
                      : ` · ${session.answeredCount} of ${session.questions.length} marked`}
                    {" · "}
                    {percent}%
                    {complete ? "" : " so far"}
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
  const more =
    cursor && sessions?.length ? (
      <div className="mt-4 flex justify-center">
        <Button type="button" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? "Loading…" : "Show earlier practice"}
        </Button>
      </div>
    ) : null;

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
      {more}
    </AppPage>
  );
}
