"use client";

import { useCallback, useState } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import type { ConstellationLine } from "@/lib/constellation/constellations";
import type { NormalizedStar } from "@/lib/constellation/stars";
import AppPage from "@/components/layout/AppPage";
import { Card, ConfirmDialog, FeedbackBanner, PageHero, Skeleton } from "@/components/ui";
import ConstellationControls, {
  type ConstellationSkyMode,
} from "@/components/constellation/ConstellationControls";
import NewSkyCard from "@/components/constellation/NewSkyCard";
import PastSkiesCard from "@/components/constellation/PastSkiesCard";
import SkyCanvas from "@/components/constellation/SkyCanvas";
import SkyFill from "@/components/constellation/SkyFill";
import SkyHeader from "@/components/constellation/SkyHeader";
import SkyPatternChat from "@/components/constellation/SkyPatternChat";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import PanelStyleSetting from "@/components/profile/PanelStyleSetting";
import { useConstellationLifecycle } from "@/hooks/useConstellationLifecycle";
import { useConstellationLineEditing } from "@/hooks/useConstellationLineEditing";
import { useConstellationLinking } from "@/hooks/useConstellationLinking";
import { useConstellationRename } from "@/hooks/useConstellationRename";
import { useConstellationSky } from "@/hooks/useConstellationSky";
import { useSkyBackgroundChoice } from "@/hooks/useSkyBackgroundChoice";
import { useSkyPattern } from "@/hooks/useSkyPattern";
import { useStarArranging } from "@/hooks/useStarArranging";
import { useStarGestureLock } from "@/hooks/useStarGestureLock";

/**
 * Stars: the skies a student's finished goals fill.
 *
 * The page composes its controllers -- the skies themselves, arranging stars,
 * drawing lines between them, Jami's patterns, renaming, starting and finishing
 * a sky -- and decides what a press on a star means in the current mode.
 */
export default function ConstellationDashboardPage() {
  const { user } = useUser();
  const uid = user.uid;
  const { feedback, success, showError, showThrownError, clear: clearFeedback } = useFeedback();
  const [refreshing, setRefreshing] = useState(false);
  /*
   * One gesture, two meanings, so the sky has a mode.
   *
   * Dragging a star already moves it, and dragging from a star to another star
   * is the natural way to join them -- the same gesture cannot be both. A
   * visible toggle is the honest way to resolve that: at any moment a drag does
   * exactly one thing and the button says which.
   */
  const [skyMode, setSkyMode] = useState<ConstellationSkyMode>("arrange");
  // Clearing every line is one click away from a pattern someone built by
  // hand, so the button asks once before it does it.
  const [isConfirmingClearLines, setIsConfirmingClearLines] = useState(false);

  const {
    loading: isLoading,
    reload,
    constellations,
    setConstellations,
    setAllStars,
    goalsById,
    selectConstellation,
    selectedConstellation,
    activeConstellation,
    visibleStars,
  } = useConstellationSky({ uid, onLoadError: showError });

  /*
   * Finishing a sky seals what is in it, not how it is arranged.
   *
   * One flag used to mean both, so finishing a constellation turned it "View
   * only" and the student lost the ability to move stars they had placed. Those
   * are different things: a finished sky takes no new stars -- that is what
   * finishing is for, and the next one starts collecting them -- but where each
   * star sits is personalisation, and there is no reason for it to expire. The
   * arrangement is also the part someone is most likely to want to revisit,
   * because a finished sky is the one they will actually keep looking at.
   */
  const canArrangeSelectedConstellation = Boolean(selectedConstellation);
  const isConnecting = skyMode === "connect";
  const selectedLines = selectedConstellation?.lines ?? [];

  const setStarGesture = useStarGestureLock();
  const { startDrag, nudgeStar } = useStarArranging({
    uid,
    enabled: canArrangeSelectedConstellation,
    setAllStars,
    onSaveError: showError,
  });
  const background = useSkyBackgroundChoice({ uid, selectedConstellation });
  const rename = useConstellationRename({ uid, setConstellations, onError: showThrownError });
  const lifecycle = useConstellationLifecycle({
    uid,
    activeConstellation,
    reload,
    feedback: { clear: clearFeedback, success, showError, showThrownError },
  });

  const { redoLines, clearRedoHistory, toggleLine, undoLine, redoLine, clearLines } =
    useConstellationLineEditing({
      uid,
      selectedConstellation,
      setConstellations,
      onSaveError: showError,
    });
  const { linkFromStarId, linkPoint, linkHoverStarId, beginOrFinishLink, clearLink } =
    useConstellationLinking({ toggleLine });

  const {
    undoSnapshot: skyPatternUndo,
    ask: handleAskJamiForPattern,
    undo: handleUndoSkyPattern,
  } = useSkyPattern({
    uid,
    selectedConstellation,
    visibleStars,
    setAllStars,
    setConstellations,
    // Drop anything mid-gesture: the stars under it have moved.
    onArrangementApplied: () => {
      clearRedoHistory();
      clearLink();
    },
    onReloadNeeded: () => void reload(),
    onError: showError,
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    clearFeedback();
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [clearFeedback, reload]);

  // Leaving Connect mode drops any half-drawn line with it.
  const handleSkyModeChange = (mode: ConstellationSkyMode) => {
    setSkyMode(mode);
    if (mode === "connect") return;
    clearLink();
    setIsConfirmingClearLines(false);
  };

  const handleClearLines = useCallback(() => {
    clearLines();
    setIsConfirmingClearLines(false);
  }, [clearLines]);

  /*
   * Stable, because the drawn figure is memoised on it. An arrow function
   * written inline here would be a new value on every pointer move and would
   * rebuild every line in the sky mid-drag.
   */
  const handleRemoveLine = useCallback(
    (line: ConstellationLine) => toggleLine(line.a, line.b),
    [toggleLine]
  );

  // A press on a star starts a line in Connect mode, and a move otherwise.
  const handleStarPress = (star: NormalizedStar, pointerType: string) => {
    setStarGesture(true, pointerType);
    if (isConnecting) beginOrFinishLink(star);
    else startDrag(star.id);
  };

  const pastConstellations = constellations.filter(
    (constellation) => constellation.id !== activeConstellation?.id
  );

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Stars"
        backHref="/dashboard"
        backLabel="Today"
        width="3xl"
        action={<RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />}
        contentClassName="space-y-4 sm:space-y-6"
      >
        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onDismiss={() => clearFeedback()}
          />
        ) : null}

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-[32rem]" />
            <Skeleton className="h-36" />
          </div>
        ) : (
          <>
            {/*
             * The lifecycle, said once, at the top.
             *
             * A sky holds forty stars and only one is ever active -- the
             * service refuses to create a second and always has. That rule was
             * enforced and never explained, so "why can I not make a new
             * constellation" had no answer anywhere on the page. It is the
             * first thing said now.
             */}
            <PageHero
              compact
              eyebrow="Goal rewards"
              title="Your stars"
              description={
                <p>
                  Finishing a goal earns a star. Forty stars fill a sky; finish that sky to keep it
                  as a record, and the next one starts collecting.
                </p>
              }
            />

            {activeConstellation ? null : (
              <NewSkyCard
                hasSkies={constellations.length > 0}
                name={lifecycle.newSkyName}
                onNameChange={lifecycle.setNewSkyName}
                creating={lifecycle.creating}
                onCreate={() => void lifecycle.create()}
              />
            )}

            {selectedConstellation ? (
              <Card padding="md" className="space-y-4">
                <SkyHeader
                  sky={selectedConstellation}
                  constellations={constellations}
                  activeConstellationId={activeConstellation?.id}
                  rename={rename}
                  onSelect={selectConstellation}
                />

                <ConstellationControls
                  mode={skyMode}
                  onModeChange={handleSkyModeChange}
                  isBackground={background.isSelectedBackground}
                  onToggleBackground={background.toggleSelectedBackground}
                  linkFromStarId={linkFromStarId}
                  linkHoverStarId={linkHoverStarId}
                  lineCount={selectedLines.length}
                  redoCount={redoLines.length}
                  onUndo={undoLine}
                  onRedo={redoLine}
                  onClear={() => setIsConfirmingClearLines(true)}
                />

                <SkyPatternChat
                  // A new sky starts a new conversation.
                  key={selectedConstellation.id}
                  disabled={visibleStars.length < 2}
                  onSend={handleAskJamiForPattern}
                  canUndo={skyPatternUndo?.constellationId === selectedConstellation.id}
                  onUndo={handleUndoSkyPattern}
                />

                {/* How the rest of Jami sits over this sky, while it is the background. */}
                {background.backgroundEnabled ? <PanelStyleSetting /> : null}

                <SkyCanvas
                  skyId={selectedConstellation.id}
                  stars={visibleStars}
                  lines={selectedLines}
                  goalsById={goalsById}
                  mode={skyMode}
                  link={{ fromStarId: linkFromStarId, point: linkPoint, hoverStarId: linkHoverStarId }}
                  canArrange={canArrangeSelectedConstellation}
                  onRemoveLine={handleRemoveLine}
                  onStarActivate={beginOrFinishLink}
                  onStarPress={handleStarPress}
                  onStarNudge={nudgeStar}
                />

                <SkyFill
                  sky={selectedConstellation}
                  canFinish={
                    selectedConstellation.id === activeConstellation?.id && lifecycle.canFinish
                  }
                  finishing={lifecycle.finishing}
                  onFinish={() => void lifecycle.finish()}
                />
              </Card>
            ) : null}

            {pastConstellations.length ? (
              <PastSkiesCard
                skies={pastConstellations}
                openSkyId={selectedConstellation?.id}
                rename={rename}
                onOpen={selectConstellation}
              />
            ) : null}
          </>
        )}
        <ConfirmDialog
          open={isConfirmingClearLines}
          title="Clear all lines?"
          description={`This will remove all ${selectedLines.length} connection${selectedLines.length === 1 ? "" : "s"} from this constellation and cannot be undone.`}
          confirmLabel="Clear lines"
          onConfirm={handleClearLines}
          onClose={() => setIsConfirmingClearLines(false)}
        />
      </AppPage>
    </Refreshable>
  );
}
