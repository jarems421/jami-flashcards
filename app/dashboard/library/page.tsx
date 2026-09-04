"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import {
  useDashboardData,
  type DashboardDataLoadOptions,
} from "@/hooks/useDashboardData";
import { useLibraryBrowser } from "@/hooks/useLibraryBrowser";
import { useSourceManagement } from "@/hooks/useSourceManagement";
import type { Source } from "@/lib/material/sources";
import type { Topic } from "@/lib/material/topics";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import type { Deck } from "@/lib/study/decks";
import { getPendingSourceDrafts } from "@/lib/material/source-selectors";
import { getGeneratedContentDrafts } from "@/services/study/generated-content";
import { getDecks } from "@/services/study/decks";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActiveTopics } from "@/services/study/topics";
import { isFirebasePermissionDenied } from "@/services/firebase/errors";
import { getSources } from "@/services/study/sources";
import { getSourceFileDownloadUrl } from "@/services/study/source-files";
import AppPage from "@/components/layout/AppPage";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";
import LibraryWorkspace from "@/components/library/LibraryWorkspace";
import SourceComposerDialog from "@/components/library/SourceComposerDialog";
import SourceDetailsWorkflow from "@/components/library/SourceDetailsWorkflow";
import SourceDraftWorkflow from "@/components/library/SourceDraftWorkflow";
import SourceManagementDialogs from "@/components/library/SourceManagementDialogs";
import { Button, EmptyState, FeedbackBanner, Skeleton } from "@/components/ui";
import {
  readSourcePanelLink,
  TUTOR_TITLE,
  TUTOR_VIEWS,
} from "@/lib/app/tutor-views";

type SourceWorkspacePanel = "tutor" | "details" | "drafts" | null;

export default function LibraryPage() {
  const { user } = useUser();
  const [sources, setSources] = useState<Source[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [sourceFileUrls, setSourceFileUrls] = useState<Record<string, string>>(
    {}
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerFolderId, setComposerFolderId] = useState("");
  /*
   * A Tutor link can name the panel to open as well as the source, so both are
   * read from the URL once, as this component's initial state, rather than
   * applied to it afterwards. Read from `window.location` like
   * `useLibraryBrowser` does, so the two agree on where the URL lives.
   */
  const [deepLink] = useState(() =>
    typeof window === "undefined"
      ? { sourceId: null, panel: null }
      : readSourcePanelLink(window.location.search)
  );
  const requestedSourceId = deepLink.sourceId;
  const [activePanel, setActivePanel] = useState<SourceWorkspacePanel>(
    deepLink.panel
  );
  const [hasSuccessfulLoad, setHasSuccessfulLoad] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const sourceComposerPrefillHandledRef = useRef(false);
  const {
    feedback,
    success,
    showError,
    showThrownError,
    clear: clearFeedback,
  } = useFeedback();

  const loadLibraryData = useCallback(async (reads: DashboardDataLoadOptions = {}) => {
    const [
      nextSources,
      nextTopics,
      nextFolders,
      nextDecks,
      nextNotebooks,
      nextDrafts,
    ] = await Promise.all([
      getSources(user.uid),
      getActiveTopics(user.uid, reads),
      getActiveStudyFolders(user.uid, reads).catch((error) => {
        console.error("Failed to load folders for Sources.", error);
        showError(
          "Folder links are temporarily unavailable. Your saved sources are still shown."
        );
        return [] as StudyFolder[];
      }),
      getDecks(user.uid, reads),
      getActiveNotebooks(user.uid, reads),
      getGeneratedContentDrafts(user.uid, reads),
    ]);
    return {
      sources: nextSources,
      topics: nextTopics,
      folders: nextFolders,
      decks: nextDecks,
      notebooks: nextNotebooks,
      drafts: nextDrafts,
    };
  }, [showError, user.uid]);

  const applyLibraryData = useCallback(
    (data: Awaited<ReturnType<typeof loadLibraryData>>) => {
      setSources(data.sources);
      setTopics(data.topics);
      setFolders(data.folders);
      setDecks(data.decks);
      setNotebooks(data.notebooks);
      setDrafts(data.drafts);
      setHasSuccessfulLoad(true);
      setLoadFailed(false);
    },
    []
  );

  const handleLibraryLoadError = useCallback(
    (error: unknown) => {
      console.error("Failed to load Sources workspace.", error);
      setLoadFailed(true);
      showError(
        isFirebasePermissionDenied(error)
          ? "Sources are unavailable for this account. Check your access and try again."
          : "Failed to load Sources. Try again."
      );
    },
    [showError]
  );

  const { loading, reload: loadAll } = useDashboardData({
    requestKey: user.uid,
    load: loadLibraryData,
    apply: applyLibraryData,
    onError: handleLibraryLoadError,
    onLoadStart: clearFeedback,
  });
  const clearPanelForSelectionChange = useCallback(
    () => setActivePanel(null),
    []
  );
  const browser = useLibraryBrowser(
    sources,
    loading,
    clearPanelForSelectionChange
  );
  const selectedSource = browser.selectedSource;

  /*
   * Selecting the source a Tutor link asked for.
   *
   * The drafts queue lists what is waiting per source, and a queue you cannot
   * act on is only a reminder -- so a row has to be able to open the source
   * that produced it. Guarded by a ref so it runs once per link and cannot
   * fight a student who has since clicked something else.
   *
   * The panel itself is not set here: it is read straight off the URL as this
   * component's initial state, and `visiblePanel` above already holds it shut
   * until a source is actually selected.
   */
  const appliedDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    if (!requestedSourceId || loading) return;
    if (appliedDeepLinkRef.current === requestedSourceId) return;
    if (!sources.some((source) => source.id === requestedSourceId)) return;

    appliedDeepLinkRef.current = requestedSourceId;
    browser.selectSource(requestedSourceId);
  }, [browser, loading, requestedSourceId, sources]);
  const selectedSourceFileUrl = selectedSource
    ? sourceFileUrls[selectedSource.id]
    : undefined;
  const sourceDraftCount = useMemo(
    () => getPendingSourceDrafts(drafts, selectedSource?.id ?? null).length,
    [drafts, selectedSource]
  );

  const reloadLibrary = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (loading || sourceComposerPrefillHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") !== "1") return;

    sourceComposerPrefillHandledRef.current = true;
    const requestedFolderId = params.get("folderId")?.trim() ?? "";
    params.delete("create");
    params.delete("folderId");
    const nextSearch = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`
    );
    void Promise.resolve().then(() => {
      setComposerFolderId(
        requestedFolderId &&
          folders.some((folder) => folder.id === requestedFolderId)
          ? requestedFolderId
          : ""
      );
      setComposerOpen(true);
    });
  }, [folders, loading]);

  useEffect(() => {
    let cancelled = false;
    const fileSources = sources.filter((source) => source.storagePath);
    if (fileSources.length === 0) return;

    const loadSourceFileUrls = async () => {
      const entries = await Promise.all(
        fileSources.map(async (source) => {
          try {
            return [
              source.id,
              await getSourceFileDownloadUrl(source.storagePath ?? ""),
            ] as const;
          } catch {
            // A broken preview URL must not hide other saved sources.
            return [source.id, ""] as const;
          }
        })
      );
      if (!cancelled) {
        setSourceFileUrls(
          Object.fromEntries(entries.filter(([, url]) => Boolean(url)))
        );
      }
    };

    void loadSourceFileUrls();
    return () => {
      cancelled = true;
    };
  }, [sources]);

  const management = useSourceManagement({
    userId: user.uid,
    source: selectedSource,
    onChanged: async (message, restored) => {
      await loadAll();
      if (restored) browser.setStatusFilter("active");
      success(message);
    },
    onError: showThrownError,
  });

  const openSourceComposer = () => {
    clearFeedback();
    setComposerFolderId("");
    setComposerOpen(true);
  };

  const openWorkspacePanel = (panel: Exclude<SourceWorkspacePanel, null>) => {
    if (!selectedSource) return;
    clearFeedback();
    setActivePanel(panel);
  };

  const openSelectedSource = () => {
    if (!selectedSource) return;
    const targetUrl =
      selectedSource.type === "link"
        ? selectedSource.externalUrl
        : selectedSourceFileUrl;
    if (targetUrl) window.open(targetUrl, "_blank", "noopener,noreferrer");
  };
  const visiblePanel = selectedSource ? activePanel : null;

  if (loading && !hasSuccessfulLoad) {
    return (
      <AppPage
        title={TUTOR_TITLE}
        views={TUTOR_VIEWS}
        viewsLabel="Tutor views"
        backHref="/dashboard"
        backLabel="Today"
      >
        <div className="space-y-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-80" />
        </div>
      </AppPage>
    );
  }

  if (loadFailed && !hasSuccessfulLoad) {
    return (
      <AppPage
        title={TUTOR_TITLE}
        views={TUTOR_VIEWS}
        viewsLabel="Tutor views"
        backHref="/dashboard"
        backLabel="Today"
      >
        <div className="space-y-4">
          {feedback ? (
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              autoDismissMs={0}
              onDismiss={clearFeedback}
            />
          ) : null}
          <EmptyState
            eyebrow="Sources unavailable"
            title="Your sources could not be loaded"
            description="Your saved work has not been changed. Try loading the workspace again."
            action={
              <Button type="button" onClick={() => void loadAll()}>
                Try again
              </Button>
            }
          />
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage
      title={TUTOR_TITLE}
      views={TUTOR_VIEWS}
      viewsLabel="Tutor views"
      backHref="/dashboard"
      backLabel="Today"
      width="study"
      action={
        <Button type="button" onClick={openSourceComposer}>
          Add source
        </Button>
      }
      contentClassName="space-y-4"
    >
      {feedback &&
      !composerOpen &&
      !management.renameOpen &&
      !visiblePanel ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={clearFeedback}
        />
      ) : null}

      <SourceComposerDialog
        open={composerOpen}
        userId={user.uid}
        folders={folders}
        topics={topics}
        initialFolderId={composerFolderId}
        onClose={() => setComposerOpen(false)}
        onTopicsChange={setTopics}
        onCreated={async (sourceId, message) => {
          await loadAll();
          browser.selectSource(sourceId);
          success(message);
        }}
      />

      <SourceManagementDialogs
        workflow={management}
        feedback={feedback}
        onDismissFeedback={clearFeedback}
      />

      <JamiAssistantDrawer
        userId={user.uid}
        open={visiblePanel === "tutor"}
        onOpenChange={(open) => {
          if (!open) setActivePanel(null);
        }}
        resetKey={selectedSource?.id ?? "no-source"}
        contextKey={`sources:${selectedSource?.id ?? ""}`}
        contextLabel="Current source"
        historyContextLabel={selectedSource?.title ?? "Source"}
        getContext={() => ({
          surface: "sources",
          sourceIds: selectedSource ? [selectedSource.id] : [],
        })}
        // The folders this source sits in, so Tutor settings can say which
        // folder's instructions are in force rather than restating the rule.
        settingsFolderIds={selectedSource?.folderIds ?? []}
        quickActions={[
          {
            label: "Explain key ideas",
            prompt: "Explain the key ideas in this source clearly.",
          },
          {
            label: "Revision summary",
            prompt: "Summarise this source for revision.",
          },
          {
            label: "Quiz me",
            prompt: "Quiz me on the most important ideas in this source.",
          },
          {
            label: "Make study material",
            run: () => openWorkspacePanel("drafts"),
          },
        ]}
      />

      <SourceDetailsWorkflow
        open={visiblePanel === "details"}
        source={selectedSource}
        folders={folders}
        topics={topics}
        userId={user.uid}
        onClose={() => setActivePanel(null)}
        onSourceChange={(nextSource) =>
          setSources((current) =>
            current.map((source) =>
              source.id === nextSource.id ? nextSource : source
            )
          )
        }
        onTopicsChange={setTopics}
      />

      <SourceDraftWorkflow
        open={visiblePanel === "drafts"}
        source={selectedSource}
        drafts={drafts}
        referenceData={{ topics, decks, notebooks }}
        userId={user.uid}
        onClose={() => setActivePanel(null)}
        onDraftsChange={setDrafts}
        onReload={reloadLibrary}
        onTopicsChange={setTopics}
      />

      <p className="px-1 text-sm leading-6 text-text-muted">
        Save references, read them here, and ask Jami when you need help.
      </p>

      <LibraryWorkspace
        browser={browser}
        folders={folders}
        selectedSourceFileUrl={selectedSourceFileUrl}
        sourceDraftCount={sourceDraftCount}
        restoring={management.busyAction === "restore-source"}
        actions={{
          addSource: openSourceComposer,
          askTutor: () => openWorkspacePanel("tutor"),
          openDrafts: () => openWorkspacePanel("drafts"),
          openDetails: () => openWorkspacePanel("details"),
          openOriginal: openSelectedSource,
          rename: () => {
            clearFeedback();
            management.openRename();
          },
          archive: management.requestArchive,
          restore: () => void management.restore(),
          delete: management.requestDelete,
        }}
      />
    </AppPage>
  );
}
