"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
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
  SegmentedControl,
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

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="app-chip rounded-full px-2.5 py-1 text-2xs font-semibold">
      {children}
    </span>
  );
}

function TutorStep({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="app-chip grid h-7 w-7 shrink-0 place-items-center rounded-full text-2xs font-semibold tabular-nums">
        {number}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text-primary">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-text-muted">
          {detail}
        </span>
      </span>
    </div>
  );
}

/**
 * Jami's front door.
 *
 * The invitation to study is the main surface. Material stays within reach,
 * while generated drafts sit in a distinct approval queue so administrative
 * work never makes the Tutor feel like another dashboard.
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

  return (
    <AppPage
      title={TUTOR_TITLE}
      backHref="/dashboard"
      backLabel="Today"
      width="3xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      <SegmentedControl items={TUTOR_VIEWS} label="Tutor views" />

      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={clearFeedback}
        />
      ) : null}

      <div className="grid min-w-0 gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="min-w-0 space-y-4 sm:space-y-6">
          <Card tone="warm" padding="lg" className="min-h-[25rem]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-accent/10 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-32 left-1/4 h-64 w-64 rounded-full bg-warm-glow blur-3xl"
            />

            <div className="relative flex min-h-[21rem] flex-col">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-warm-border bg-warm-glow text-warm-accent shadow-warm">
                  <JamiTutorIcon className="h-7 w-7" />
                </span>
                <span>
                  <span className="block text-2xs font-semibold uppercase tracking-[0.2em] text-warm-accent">
                    Jami Tutor
                  </span>
                  <span className="mt-0.5 block text-xs text-text-muted">
                    Beside your work, when you ask
                  </span>
                </span>
              </div>

              <div className="mt-9 max-w-2xl sm:mt-12">
                <h2 className="text-3xl font-medium leading-[1.08] tracking-[-0.035em] text-text-primary sm:text-4xl lg:text-5xl">
                  What are you working through?
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-7 text-text-secondary sm:text-base">
                  Choose your notes, a paper, or another source. Jami will help
                  you find the next step without taking the thinking away.
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <ButtonLink href="/dashboard/library" size="lg">
                    Choose material
                  </ButtonLink>
                  <span className="text-xs leading-5 text-text-muted">
                    Reads only what you hand it
                  </span>
                </div>
              </div>

              <div className="mt-10 grid gap-5 border-t border-[var(--color-border)] pt-5 sm:grid-cols-3">
                <TutorStep
                  number="01"
                  title="Hint first"
                  detail="A useful nudge before an answer."
                />
                <TutorStep
                  number="02"
                  title="Work it through"
                  detail="Explain, question, and check together."
                />
                <TutorStep
                  number="03"
                  title="You stay in control"
                  detail="Full solutions and drafts are deliberate."
                />
              </div>
            </div>
          </Card>

          {loading || recentSources.length > 0 ? (
            <Card padding="lg">
              <SectionHeader
                eyebrow="Pick up where you left off"
                title="Recent material"
                description="Jami reads the one you pick, for that conversation only."
                action={
                  <ButtonLink
                    href="/dashboard/library"
                    variant="secondary"
                    size="sm"
                  >
                    See all
                  </ButtonLink>
                }
              />
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {loading ? (
                  <>
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                  </>
                ) : (
                  recentSources.map((source) => (
                    <Link
                      key={source.id}
                      href={getSourcePanelHref(source.id, "tutor")}
                      className="group app-subtle-panel flex min-h-20 items-center gap-3 rounded-xl p-3.5 transition duration-fast hover:-translate-y-[1px] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)]"
                    >
                      <IconBubble
                        size="md"
                        shape="rounded"
                        className="app-chip shrink-0 font-semibold"
                        aria-hidden
                      >
                        {getSourceTypeMark(source.type)}
                      </IconBubble>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text-primary">
                          {source.title}
                        </span>
                        <span className="mt-1 block text-xs text-text-muted">
                          {getSourceTypeLabel(source.type)}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm text-text-muted transition duration-fast group-hover:bg-[var(--color-glass-strong)] group-hover:text-text-primary"
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
              action={
                <ButtonLink href="/dashboard/library">Add a source</ButtonLink>
              }
            />
          )}
        </div>

        <aside
          className={`${hasDrafts ? "order-first xl:order-none" : ""} min-w-0 xl:sticky xl:top-28`}
        >
          <Card tone={hasDrafts ? "warm" : "subtle"} padding="md">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  Draft review
                </p>
                <h2 className="mt-2 text-lg font-semibold tracking-tight text-text-primary">
                  {loading
                    ? "Checking your queue"
                    : hasDrafts
                      ? `${drafts.length} waiting for you`
                      : "You are all caught up"}
                </h2>
              </div>
              <span
                className={`grid h-9 min-w-9 shrink-0 place-items-center rounded-full px-2 text-xs font-semibold tabular-nums ${
                  hasDrafts ? "app-selected" : "app-chip"
                }`}
              >
                {loading ? "…" : drafts.length}
              </span>
            </div>
            <p className="mt-3 text-xs leading-5 text-text-muted">
              {"Nothing Jami writes joins your studying until you have read it and said yes."}
            </p>

            <div className="mt-5 space-y-2.5">
              {loading ? (
                <>
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </>
              ) : loadFailed ? (
                <EmptyState
                  variant="compact"
                  align="left"
                  emoji="Draft"
                  title="Drafts are unavailable"
                  description="We could not read your queue, so it has not been treated as empty."
                  action={
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void reload()}
                    >
                      Try again
                    </Button>
                  }
                />
              ) : !hasDrafts ? (
                <div className="app-subtle-panel rounded-xl p-4">
                  <p className="text-sm font-medium text-text-primary">
                    Nothing needs reviewing
                  </p>
                  <p className="mt-1.5 text-xs leading-5 text-text-muted">
                    Card and question drafts will wait here for your approval.
                  </p>
                </div>
              ) : (
                draftGroups.map((group) => (
                  <div
                    key={group.sourceId ?? "__unsourced__"}
                    className="app-subtle-panel rounded-xl p-3.5"
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
                        <div className="truncate text-sm font-semibold text-text-primary">
                          {group.title}
                        </div>
                        {group.preview ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                            {group.preview}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {describeDraftCounts(group).map((part) => (
                        <Chip key={part}>{part}</Chip>
                      ))}
                    </div>
                    {group.sourceId ? (
                      <ButtonLink
                        href={getSourcePanelHref(group.sourceId, "drafts")}
                        variant="secondary"
                        size="sm"
                        className="mt-3 w-full"
                      >
                        Review drafts
                      </ButtonLink>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <p className="flex items-start gap-2 text-2xs leading-5 text-text-muted">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current"
                />
                Keeps nothing between conversations
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </AppPage>
  );
}
