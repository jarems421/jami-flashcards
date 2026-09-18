"use client";

import { ButtonLink, Card, SectionHeader, Skeleton } from "@/components/ui";
import type { PlanNotice } from "@/lib/ai/assistant-plan";
import { planDaysBetween } from "@/lib/planning/plan-schedule";
import { PLAN_WEEKDAY_LABELS, type RevisionPlan } from "@/lib/planning/types";
import { getRevisionPlanHref } from "@/lib/app/routes";
import { getStudyDayKey } from "@/lib/study/day";

/**
 * The revision plan, as it appears on the Tutor landing.
 *
 * Two states and no wizard. Without a plan it shows what Jami has noticed and
 * invites a conversation; with one it says what the week looks like and gets
 * out of the way. Both are one card, because a student arriving here is
 * choosing what to do with Jami, not managing a timetable.
 *
 * The notices are the Learning Engine's own words, not a model's -- see
 * `buildPlanNotices`. Showing two of them here is the whole argument for
 * planning with Jami rather than on paper: it already knows where the holes
 * are, and it is saying so before being asked.
 */
export default function TutorPlanCard({
  plan,
  notices,
  loading = false,
}: {
  plan: RevisionPlan | null;
  notices: readonly PlanNotice[];
  loading?: boolean;
}) {
  const href = getRevisionPlanHref();

  /*
   * Nothing is claimed while the plan is still being read.
   *
   * Without this the card renders its invitation first and swaps to a plan a
   * moment later, which reads as the plan having just been created.
   */
  if (loading) {
    return (
      <Card padding="md">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-3 h-4 w-full max-w-sm" />
        <Skeleton className="mt-4 h-8 w-40 rounded-full" />
      </Card>
    );
  }

  if (plan) {
    const daysLeft = Math.max(0, planDaysBetween(getStudyDayKey(), plan.endDayKey));
    const perWeek = plan.sessions.reduce((total, session) => total + session.minutes, 0);
    // One chip per study day, not per sitting: two sittings on a Monday is one
    // Monday, and a row reading "Mon Mon Tue" says nothing anybody wanted.
    const studyDays = [...new Set(plan.sessions.map((session) => session.weekday))].sort(
      (left, right) => left - right
    );
    const timed = plan.sessions.filter((session) => session.startTime).length;

    return (
      <Card padding="md">
        <SectionHeader
          title="Your revision plan"
          description={
            daysLeft > 0
              ? `${daysLeft} days to go · about ${
                  perWeek >= 60 ? `${Math.round(perWeek / 60)}h` : `${perWeek} min`
                } a week`
              : "Finishing today"
          }
          action={
            <ButtonLink href={href} variant="secondary" size="sm">
              Open plan
            </ButtonLink>
          }
        />
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {studyDays.map((weekday) => (
            <span
              key={weekday}
              className="app-chip rounded-full px-2.5 py-1 text-2xs font-semibold"
            >
              {PLAN_WEEKDAY_LABELS[weekday]}
            </span>
          ))}
          <span className="ml-1 text-2xs text-text-muted">
            {plan.sessions.length} session{plan.sessions.length === 1 ? "" : "s"} a week
            {timed > 0 ? ", timed" : ""}
          </span>
        </div>
        <p className="mt-3 text-2xs leading-5 text-text-muted">
          What each session holds is chosen from your recent work on the day, so
          it keeps up as you go.
        </p>
      </Card>
    );
  }

  return (
    <Card padding="md">
      <SectionHeader
        title="Plan your revision"
        description="Tell Jami what's coming up and it will suggest a shape for your week."
        action={
          <ButtonLink href={href} size="sm">
            Plan with Jami
          </ButtonLink>
        }
      />
      {notices.length > 0 ? (
        <>
          <p className="mt-4 text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            Already worth knowing
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {notices.slice(0, 3).map((notice) => (
              <li
                key={`${notice.scopeKey}:${notice.detail}`}
                className="app-subtle-panel rounded-full px-3 py-1.5 text-2xs text-text-secondary"
              >
                {notice.detail}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-sm leading-6 text-text-muted">
          Once you have done a bit of studying, Jami will base its suggestions on
          what your answers actually show.
        </p>
      )}
    </Card>
  );
}
