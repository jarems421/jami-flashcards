import { ButtonLink, Card, ProgressBar } from "@/components/ui";
import type { ExamSession } from "@/lib/practice/exam-questions";

/** A finished session's first-attempt score, and where to go next. */
export default function ExamSessionComplete({
  session,
}: {
  session: Pick<ExamSession, "awardedTotal" | "maxTotal" | "requestedMix" | "folderId">;
}) {
  return (
    <Card tone="warm" padding="lg">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Session complete</p>
          <p className="mt-2 flex items-baseline font-semibold tabular-nums tracking-tight text-text-primary">
            <span className="text-5xl leading-none">{session.awardedTotal}</span>
            <span className="ml-1 text-2xl leading-none text-text-muted">/{session.maxTotal}</span>
          </p>
          <ProgressBar
            size="sm"
            progress={session.maxTotal ? (session.awardedTotal / session.maxTotal) * 100 : 0}
            className="mt-4 max-w-sm"
          />
          <p className="mt-3 text-sm text-text-muted">
            First-attempt score · {session.requestedMix.easy} easy · {session.requestedMix.medium} medium ·{" "}
            {session.requestedMix.hard} hard
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/dashboard/practice/history" variant="secondary">
            History
          </ButtonLink>
          <ButtonLink href={`/dashboard/practice/questions/new?folderId=${encodeURIComponent(session.folderId)}`}>
            Another session
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}
