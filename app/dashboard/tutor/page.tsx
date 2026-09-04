"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import { SettingsIcon } from "@/components/ai/JamiAssistantIcons";
import { featureFlags } from "@/lib/app/feature-flags";
import { useUser } from "@/components/providers/UserProvider";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  FeedbackBanner,
  IconBubble,
  JamiTutorIcon,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import { useFeedback } from "@/hooks/useFeedback";
import {
  useDashboardData,
  type DashboardDataLoadOptions,
} from "@/hooks/useDashboardData";
import {
  getSourcePanelHref,
  TUTOR_TITLE,
  TUTOR_VIEWS,
} from "@/lib/app/tutor-views";
import {
  describeDraftCounts,
  getSourceTypeLabel,
  getSourceTypeMark,
  groupTutorDrafts,
} from "@/lib/app/tutor-drafts";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type { Source } from "@/lib/material/sources";
import { getPendingGeneratedContentDrafts } from "@/services/study/generated-content";
import { getActiveSources } from "@/services/study/sources";

/** Enough of the queue to act on without turning the page into a list. */
const MAX_PENDING_DRAFTS = 20;
const MAX_RECENT_SOURCES = 6;

/**
 * When a source was last touched, in the roughest terms that are still true.
 *
 * A row that only names a source is a filing cabinet. Knowing which one you had
 * open yesterday is most of how you find the one you want.
 */
function formatLastUsed(updatedAt: number) {
  const elapsed = Math.max(0, Date.now() - updatedAt);
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(updatedAt);
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="app-chip rounded-full px-2.5 py-1 text-2xs font-semibold">
      {children}
    </span>
  );
}

/**
 * Jami's front door.
 *
 * Two things happen here: you pick something to ask about, and you clear the
 * drafts Jami has written for you. So those are what the page is, in that
 * order, and the header above them is a label rather than an event.
 *
 * It used to open on a 400px hero -- a headline at text-5xl, one button, two
 * blurred decorative discs, and a numbered 01/02/03 explainer of how tutoring
 * works -- none of which was the student's own material, and all of which sat
 * above it. An explainer earns its place the first time somebody arrives and
 * costs them a scroll on every visit after that.
 */
export default function TutorPage() {
  const { user } = useUser();
  const [sources, setSources] = useState<Source[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const { feedback, showError, clear: clearFeedback } = useFeedback();

  const loadTutorData = useCallback(
    async (reads: DashboardDataLoadOptions = {}) => {
      const [userSources, pendingDrafts] = await Promise.all([
        getActiveSources(user.uid, reads),
        getPendingGeneratedContentDrafts(user.uid, MAX_PENDING_DRAFTS),
      ]);
      return { sources: userSources, drafts: pendingDrafts };
    },
    [user.uid],
  );

  const applyTutorData = useCallback(
    (data: Awaited<ReturnType<typeof loadTutorData>>) => {
      setSources(data.sources);
      setDrafts(data.drafts);
    },
    [],
  );

  const handleLoadError = useCallback(
    (error: unknown) => {
      console.error("Failed to load the Tutor workspace.", error);
      setLoadFailed(true);
      showError("Jami could not load your drafts just now. Try again shortly.");
    },
    [showError],
  );

  const { loading, reload } = useDashboardData({
    requestKey: user.uid,
    load: loadTutorData,
    apply: applyTutorData,
    onError: handleLoadError,
    onLoadStart: () => {
      setLoadFailed(false);
      clearFeedback();
    },
  });

  const draftGroups = useMemo(
    () => groupTutorDrafts(drafts, sources),
    [drafts, sources],
  );
  const recentSources = useMemo(
    () =>
      [...sources]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_RECENT_SOURCES),
    [sources],
  );
  const hasDrafts = draftGroups.length > 0;
  /*
   * Which sources have drafts waiting, so a row can say so.
   *
   * The two halves of this page were about the same material and never
   * referred to each other: the queue below knew a source had four cards
   * waiting and the row for that source, directly above it, showed nothing.
   */
  const draftsBySource = useMemo(
    () =>
      new Map(
        draftGroups
          .filter((group) => group.sourceId)
          .map((group) => [group.sourceId as string, group.total])
      ),
    [draftGroups]
  );

  return (
    <AppPage
      title={TUTOR_TITLE}
      views={TUTOR_VIEWS}
      viewsLabel="Tutor views"
      backHref="/dashboard"
      backLabel="Today"
      width="xl"
      contentClassName="space-y-4"
      action={
        featureFlags.enableTutorPersonalisation ? (
          <ButtonLink href="/dashboard/tutor/personalise" variant="surface" size="sm">
            <span className="mr-2 inline-grid place-items-center text-text-muted">
              <SettingsIcon />
            </span>
            Personalise Jami
          </ButtonLink>
        ) : undefined
      }
    >
      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={clearFeedback}
        />
      ) : null}

      {/*
        * Who this is and how to start, on one line.
        *
        * The single promise that matters is here and nowhere else. It used to
        * be made four times on this screen -- "Reads only what you hand it",
        * "for that conversation only", "Nothing Jami writes joins your studying
        * until you have read it and said yes", "Keeps nothing between
        * conversations". Each is true and the wording is deliberate, but four
        * reassurances on one page stop reassuring and start sounding nervous.
        */}
      <Card tone="warm" padding="md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="relative grid h-12 w-12 shrink-0 place-items-center">
              {/*
                * Light around the mark rather than behind the page. It is the
                * one piece of atmosphere here, it belongs to Jami, and it
                * breathes slowly enough that noticing it is not the point.
                */}
              <span
                aria-hidden="true"
                className="jami-mark-glow pointer-events-none absolute inset-0 -m-3 rounded-full bg-[radial-gradient(circle_at_center,var(--color-warm-glow)_0%,transparent_70%)]"
              />
              <span className="relative grid h-12 w-12 place-items-center rounded-2xl border border-warm-border bg-warm-glow text-warm-accent shadow-warm">
                <JamiTutorIcon className="h-6 w-6" />
              </span>
            </span>
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-[0.2em] text-warm-accent">
                Jami Tutor
              </p>
              <p className="mt-1 text-sm leading-6 text-text-secondary">
                Ask from your own material.
              </p>
              {/*
                * Two short lines, and deliberately still two.
                *
                * Folding them into one sentence was the first thing tried here
                * and `tutor-surface.test.ts` caught it: what a student needs to
                * know about what Jami retains has to be scannable, because a
                * paragraph about it is skipped exactly on the first visit, when
                * it is the only time it matters. Four of these on one page was
                * the problem; one is not the fix.
                */}
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs leading-5 text-text-muted">
                <span>Reads only what you hand it</span>
                <span>Keeps nothing between conversations</span>
              </p>
            </div>
          </div>
          <ButtonLink href="/dashboard/library" className="shrink-0">
            Choose material
          </ButtonLink>
        </div>
      </Card>

      {/*
        * Your material, first, because picking something is what you came to
        * do. It used to sit under the hero and beside a sidebar that moved to
        * the top whenever a draft existed, so the page arrived in a different
        * shape depending on data.
        */}
      {loading || recentSources.length > 0 ? (
        <Card padding="md">
          <SectionHeader
            title="Recent material"
            description="Pick one to ask about."
            action={
              <ButtonLink href="/dashboard/library" variant="secondary" size="sm">
                See all
              </ButtonLink>
            }
          />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {loading ? (
              <>
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </>
            ) : (
              recentSources.map((source) => (
                <Link
                  key={source.id}
                  href={getSourcePanelHref(source.id, "tutor")}
                  className="group app-subtle-panel flex items-center gap-3 rounded-lg p-3 transition duration-fast hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)]"
                >
                  <IconBubble
                    size="sm"
                    shape="rounded"
                    className="app-chip shrink-0 font-semibold"
                    aria-hidden
                  >
                    {getSourceTypeMark(source.type)}
                  </IconBubble>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-primary">
                      {source.title}
                    </span>
                    <span className="mt-0.5 block truncate text-2xs text-text-muted">
                      {getSourceTypeLabel(source.type)} ·{" "}
                      {formatLastUsed(source.updatedAt)}
                    </span>
                  </span>
                  {draftsBySource.has(source.id) ? (
                    <span className="app-selected shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums">
                      {draftsBySource.get(source.id)} waiting
                    </span>
                  ) : null}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-sm text-text-muted transition duration-fast group-hover:text-text-primary"
                  >
                    →
                  </span>
                </Link>
              ))
            )}
          </div>
        </Card>
      ) : (
        <EmptyState
          title="Give Jami something useful to read"
          description="Add a source, then ask from that material when you need help."
          action={<ButtonLink href="/dashboard/library">Add a source</ButtonLink>}
        />
      )}

      <Card tone={hasDrafts ? "warm" : "default"} padding="md">
        <SectionHeader
          title="Draft review"
          description="Nothing Jami writes joins your studying until you have said yes."
          action={
            <span
              className={`grid h-8 min-w-8 shrink-0 place-items-center rounded-full px-2.5 text-xs font-semibold tabular-nums ${
                hasDrafts ? "app-selected" : "app-chip"
              }`}
              aria-label={`${loading ? 0 : drafts.length} drafts waiting`}
            >
              {loading ? "…" : drafts.length}
            </span>
          }
        />

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {loading ? (
            <>
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </>
          ) : loadFailed ? (
            <div className="sm:col-span-2">
              <EmptyState
                variant="compact"
                align="left"
                emoji="Draft"
                title="Drafts are unavailable"
                description="We could not read your queue, so it has not been treated as empty."
                action={
                  <Button type="button" size="sm" onClick={() => void reload()}>
                    Try again
                  </Button>
                }
              />
            </div>
          ) : !hasDrafts ? (
            <p className="text-sm text-text-muted sm:col-span-2">
              Nothing is waiting. Card and question drafts will gather here for
              your approval.
            </p>
          ) : (
            draftGroups.map((group) => (
              <div
                key={group.sourceId ?? "__unsourced__"}
                className="app-subtle-panel flex flex-col rounded-lg p-3"
              >
                <div className="flex items-start gap-3">
                  <IconBubble
                    size="sm"
                    shape="rounded"
                    className="app-chip shrink-0 font-semibold tabular-nums"
                    aria-hidden
                  >
                    {group.total}
                  </IconBubble>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {group.title}
                    </div>
                    {group.preview ? (
                      <p className="mt-1 line-clamp-2 text-2xs leading-5 text-text-muted">
                        {group.preview}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {describeDraftCounts(group).map((part) => (
                    <Chip key={part}>{part}</Chip>
                  ))}
                </div>
                {group.sourceId ? (
                  <ButtonLink
                    href={getSourcePanelHref(group.sourceId, "drafts")}
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                  >
                    Review drafts
                  </ButtonLink>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>
    </AppPage>
  );
}
