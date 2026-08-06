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
  PageHero,
  SectionHeader,
  SegmentedControl,
} from "@/components/ui";
import { useFeedback } from "@/hooks/useFeedback";
import { useDashboardData } from "@/hooks/useDashboardData";
import type { DashboardDataLoadOptions } from "@/hooks/useDashboardData";
import {
  getSourcePanelHref,
  TUTOR_TITLE,
  TUTOR_VIEWS,
} from "@/lib/app/tutor-views";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type { Source } from "@/lib/material/sources";
import { sortByCreatedAtNewest } from "@/lib/app/recent-items";
import { getPendingGeneratedContentDrafts } from "@/services/study/generated-content";
import { getActiveSources } from "@/services/study/sources";

/** Enough of the queue to act on without turning the page into a list. */
const MAX_PENDING_DRAFTS = 20;
const MAX_RECENT_SOURCES = 4;

type DraftGroup = {
  sourceId: string | null;
  title: string;
  flashcards: number;
  questions: number;
  total: number;
};

/**
 * Groups the queue by the source that produced it.
 *
 * Reviewing drafts happens one source at a time -- the workflow that edits them
 * belongs to a source -- so the queue is only useful if it says which source to
 * open. Drafts with no source still get a row, or they would be invisible.
 */
function groupDraftsBySource(
  drafts: GeneratedContentDraft[],
  sources: Source[]
): DraftGroup[] {
  const titleById = new Map(sources.map((source) => [source.id, source.title]));
  const groups = new Map<string, DraftGroup>();

  for (const draft of drafts) {
    const sourceId = draft.sourceId ?? null;
    const key = sourceId ?? "__unsourced__";
    const group = groups.get(key) ?? {
      sourceId,
      title: sourceId
        ? titleById.get(sourceId) ?? "A source you have removed"
        : "Written without a source",
      flashcards: 0,
      questions: 0,
      total: 0,
    };

    if (draft.kind === "practice-question") group.questions += 1;
    else group.flashcards += 1;
    group.total += 1;
    groups.set(key, group);
  }

  return [...groups.values()].sort((left, right) => right.total - left.total);
}

function describeGroup(group: DraftGroup) {
  const parts: string[] = [];
  if (group.flashcards > 0) {
    parts.push(`${group.flashcards} flashcard${group.flashcards === 1 ? "" : "s"}`);
  }
  if (group.questions > 0) {
    parts.push(`${group.questions} question${group.questions === 1 ? "" : "s"}`);
  }
  return parts.join(" and ");
}

/**
 * Jami's own page.
 *
 * Two things brought it about. The drafts Jami writes had nowhere to be
 * reviewed -- the only way in was to open Sources, remember which source had
 * produced them, and find the drawer -- and the tutor itself had no front door
 * at all, existing only as a drawer over three other screens.
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
      // difference is said out loud rather than shown as "no drafts waiting".
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
    () => groupDraftsBySource(drafts, sources),
    [drafts, sources]
  );
  const recentSources = useMemo(
    () =>
      sortByCreatedAtNewest(sources, (source) => source.updatedAt).slice(
        0,
        MAX_RECENT_SOURCES
      ),
    [sources]
  );

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

      <PageHero
        eyebrow="Your tutor"
        title="Jami reads what you choose, when you ask."
        description="Pick a source and ask about it, and Jami can explain it, quiz you, or draft cards and questions from it. It does not read anything on its own, and it keeps nothing between conversations."
        action={
          <ButtonLink href="/dashboard/library">Choose a source</ButtonLink>
        }
      />

      <Card padding="lg">
        <SectionHeader
          title={
            drafts.length > 0
              ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} waiting for you`
              : "Drafts to review"
          }
          description="Nothing Jami writes is added to your studying until you have read it and said yes."
        />
        <div className="mt-5 space-y-3">
          {loading ? (
            <p className="text-sm text-text-muted">Looking for drafts...</p>
          ) : loadFailed ? (
            <EmptyState
              emoji="Draft"
              title="Drafts are unavailable"
              description="We could not read your queue, so it has not been treated as empty."
              action={
                <Button type="button" onClick={() => void reload()}>
                  Try again
                </Button>
              }
            />
          ) : draftGroups.length === 0 ? (
            <EmptyState
              emoji="Draft"
              title="No drafts waiting"
              description="Ask Jami to make study material from one of your sources and the drafts will appear here."
              action={
                <ButtonLink href="/dashboard/library">Open sources</ButtonLink>
              }
            />
          ) : (
            draftGroups.map((group) => (
              <div
                key={group.sourceId ?? "__unsourced__"}
                className="app-subtle-panel flex flex-col gap-3 rounded-[1.15rem] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-text-primary">
                    {group.title}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">
                    {describeGroup(group)}
                  </div>
                </div>
                {group.sourceId ? (
                  <ButtonLink
                    href={getSourcePanelHref(group.sourceId, "drafts")}
                    size="sm"
                    variant="secondary"
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

      {recentSources.length > 0 ? (
        <Card padding="lg">
          <SectionHeader
            title="Ask about a source"
            description="Jami reads the one you pick, for that conversation only."
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {recentSources.map((source) => (
              <div
                key={source.id}
                className="app-subtle-panel flex items-center justify-between gap-3 rounded-[1.15rem] p-4"
              >
                <div className="min-w-0 truncate text-sm font-medium text-text-primary">
                  {source.title}
                </div>
                <ButtonLink
                  href={getSourcePanelHref(source.id, "tutor")}
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                >
                  Ask
                </ButtonLink>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </AppPage>
  );
}
