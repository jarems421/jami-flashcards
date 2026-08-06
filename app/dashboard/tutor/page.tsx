"use client";

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
  PageHero,
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
    <span className="app-chip rounded-full px-2.5 py-1 text-[0.68rem] font-semibold">
      {children}
    </span>
  );
}

/**
 * Jami's own page.
 *
 * Two things brought it about. The drafts Jami writes had nowhere to be
 * reviewed -- the only way in was to open Sources, remember which source had
 * produced them, and find the drawer -- and the tutor itself had no front door
 * at all, existing only as a drawer over three other screens.
 *
 * The queue leads whenever anything is in it. It is the only part of this page
 * that is work waiting on the student; everything else is an invitation, and an
 * invitation should not sit above a backlog.
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
    [user.uid]
  );

  const applyTutorData = useCallback(
    (data: Awaited<ReturnType<typeof loadTutorData>>) => {
      setSources(data.sources);
      setDrafts(data.drafts);
    },
    []
  );

  const handleLoadError = useCallback(
    (error: unknown) => {
      console.error("Failed to load the Tutor workspace.", error);
      setLoadFailed(true);
      // An empty queue and an unreadable one look the same on screen, so the
      // difference is said out loud rather than shown as "nothing waiting".
      showError("Jami could not load your drafts just now. Try again shortly.");
    },
    [showError]
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
    [drafts, sources]
  );
  const recentSources = useMemo(
    () =>
      [...sources]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_RECENT_SOURCES),
    [sources]
  );
  const hasDrafts = draftGroups.length > 0;

  return (
    <AppPage
      title={TUTOR_TITLE}
      backHref="/dashboard"
      backLabel="Today"
      width="2xl"
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

      {/*
        The hero states the offer, and the limits sit beside it as two short
        lines rather than inside a paragraph. A student skims a page like this;
        a wall of prose about what Jami does not retain gets skipped exactly
        when it matters, which is the first visit.
      */}
      <PageHero
        eyebrow="Jami"
        title="Ask about your own material."
        description="Pick something for Jami to read and it can explain it, quiz you, or draft cards and questions from it."
        action={<ButtonLink href="/dashboard/library">Choose a source</ButtonLink>}
        aside={
          <div className="app-subtle-panel grid w-full min-w-0 gap-3 rounded-[1.4rem] p-4 sm:min-w-[15rem]">
            <div className="flex items-start gap-2.5">
              <IconBubble size="xs" shape="circle" className="app-chip mt-0.5 shrink-0">
                1
              </IconBubble>
              <span className="text-xs leading-5 text-text-secondary">
                Reads only what you hand it
              </span>
            </div>
            <div className="h-px bg-[var(--color-border)]" />
            <div className="flex items-start gap-2.5">
              <IconBubble size="xs" shape="circle" className="app-chip mt-0.5 shrink-0">
                2
              </IconBubble>
              <span className="text-xs leading-5 text-text-secondary">
                Keeps nothing between conversations
              </span>
            </div>
          </div>
        }
      />

      <Card tone={hasDrafts ? "warm" : "default"} padding="lg">
        <SectionHeader
          eyebrow="Waiting on you"
          title={
            loading
              ? "Looking for drafts"
              : hasDrafts
                ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} to review`
                : "No drafts waiting"
          }
          description="Nothing Jami writes joins your studying until you have read it and said yes."
        />

        <div className="mt-5 space-y-3">
          {loading ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : loadFailed ? (
            <EmptyState
              variant="compact"
              align="left"
              emoji="Draft"
              title="Drafts are unavailable"
              description="We could not read your queue, so it has not been treated as empty."
              action={
                <Button type="button" onClick={() => void reload()}>
                  Try again
                </Button>
              }
            />
          ) : !hasDrafts ? (
            <p className="text-sm leading-6 text-text-secondary">
              Ask Jami to make study material from a source and the drafts land
              here first.
            </p>
          ) : (
            draftGroups.map((group) => (
              <div
                key={group.sourceId ?? "__unsourced__"}
                className="app-subtle-panel flex flex-col gap-4 rounded-[1.35rem] p-4 sm:flex-row sm:items-center"
              >
                <IconBubble
                  size="md"
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
                    <p className="mt-1 line-clamp-1 text-sm leading-6 text-text-secondary">
                      {group.preview}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {describeDraftCounts(group).map((part) => (
                      <Chip key={part}>{part}</Chip>
                    ))}
                  </div>
                </div>

                {group.sourceId ? (
                  <ButtonLink
                    href={getSourcePanelHref(group.sourceId, "drafts")}
                    size="sm"
                    className="shrink-0"
                  >
                    Review
                  </ButtonLink>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      {loading || recentSources.length > 0 ? (
        <Card padding="lg">
          <SectionHeader
            eyebrow="Your material"
            title="Ask about a source"
            description="Jami reads the one you pick, for that conversation only."
            action={
              <ButtonLink href="/dashboard/library" variant="secondary" size="sm">
                All sources
              </ButtonLink>
            }
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {loading ? (
              <>
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </>
            ) : (
              recentSources.map((source) => (
                <a
                  key={source.id}
                  href={getSourcePanelHref(source.id, "tutor")}
                  className="app-subtle-panel flex items-center gap-3 rounded-[1.35rem] p-3.5 transition duration-fast hover:-translate-y-[1px] hover:border-[var(--color-border-strong)]"
                >
                  <IconBubble
                    size="md"
                    shape="rounded"
                    className="app-chip shrink-0"
                    aria-hidden
                  >
                    {getSourceTypeMark(source.type)}
                  </IconBubble>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-primary">
                      {source.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      {getSourceTypeLabel(source.type)}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-sm text-text-muted"
                  >
                    →
                  </span>
                </a>
              ))
            )}
          </div>
        </Card>
      ) : (
        <EmptyState
          emoji="Source"
          eyebrow="Nothing to read yet"
          title="Give Jami something to work from"
          description="Save a page, a file, or your own notes, and Jami can explain them, quiz you, or draft study material from them."
          action={<ButtonLink href="/dashboard/library">Add a source</ButtonLink>}
        />
      )}
    </AppPage>
  );
}
