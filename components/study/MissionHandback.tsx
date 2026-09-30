"use client";

import { ButtonLink } from "@/components/ui";

/**
 * The way back, for a session the Study Hub sent the student on.
 *
 * Without it the loop had no return leg. A student pressed "Start practising"
 * on Today, did the work, and landed on a session summary whose every button
 * led further into Study -- run it again, build another session, edit cards --
 * so the page that asked for the work never found out, from their point of
 * view, that it had happened.
 *
 * Deliberately above the session summary rather than instead of it. The
 * accuracy, the ratings and the streak are what a student wants after a
 * session and none of that is replaced; this only adds the sentence that says
 * where the work came from, and the door back to it.
 *
 * It claims nothing about what the answers meant. Whether they change what
 * Jami recommends is decided when Today recalculates, from all the evidence
 * rather than from this session -- so the copy says the work is recorded and
 * stops there.
 */
export default function MissionHandback({ answered }: { answered: number }) {
  return (
    <div className="app-panel-warm animate-slide-up relative overflow-hidden rounded-xl p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">
            That was the work Jami suggested.
          </div>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {answered === 1 ? "Your answer is" : `Your ${answered} answers are`} recorded. Today
            will work out what comes next.
          </p>
        </div>
        <ButtonLink href="/dashboard" variant="secondary" className="shrink-0">
          See what&apos;s next
        </ButtonLink>
      </div>
    </div>
  );
}
