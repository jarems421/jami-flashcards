"use client";

import { useEffect, useRef, useState } from "react";
import StudyLevelSelect from "@/components/study/StudyLevelSelect";
import { Card, FeedbackBanner, SectionHeader } from "@/components/ui";
import type { StudyLevel } from "@/lib/profile/study-level";
import {
  loadDefaultStudyLevel,
  saveDefaultStudyLevel,
} from "@/services/profile";

type StudyLevelPreferenceCardProps = {
  userId: string;
};

export default function StudyLevelPreferenceCard({
  userId,
}: StudyLevelPreferenceCardProps) {
  const [level, setLevel] = useState<StudyLevel | "">("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | undefined
  >();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setFeedback(undefined);
      try {
        const current = (await loadDefaultStudyLevel(userId)) ?? "";
        if (!cancelled) {
          setLevel(current);
        }
      } catch (error) {
        console.error("Failed to load the default study level.", error);
        if (!cancelled) {
          setFeedback({
            type: "error",
            message: "Jami could not load your study level.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  /*
   * Saved on choosing, not on a second click.
   *
   * This sat behind a "Save study level" button while the theme picker beside
   * it on the same page saves the moment you pick -- so choosing a level and
   * walking away looked exactly like setting it, and stored nothing. The
   * account this was found on had `defaultStudyLevel: null` with four folders
   * and none of them carrying a level either, and the tutor had been answering
   * every question with no idea what level to pitch at.
   *
   * The last choice wins: a slow write for an earlier selection must not
   * overwrite a later one, so only the newest request is allowed to report back.
   */
  const latestRequestRef = useRef(0);

  const save = async (nextLevel: StudyLevel | "") => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setSaving(true);
    setFeedback(undefined);
    try {
      const saved = (await saveDefaultStudyLevel(userId, nextLevel || null)) ?? "";
      if (latestRequestRef.current !== requestId) return;
      setLevel(saved);
      setFeedback({ type: "success", message: "Default study level saved." });
    } catch (error) {
      console.error("Failed to save the default study level.", error);
      if (latestRequestRef.current !== requestId) return;
      setFeedback({
        type: "error",
        message: "Jami could not save your study level.",
      });
    } finally {
      if (latestRequestRef.current === requestId) setSaving(false);
    }
  };

  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Learning preferences"
        title="Pitch explanations at the right level"
        description="This is your default. Individual folders can use a different study level."
      />

      <div className="mt-5">
        <StudyLevelSelect
          value={level}
          emptyLabel="Not specified"
          disabled={loading || saving}
          description="Jami uses this to choose depth, vocabulary, and assumed knowledge. It is not an ability rating."
          onChange={(nextLevel) => {
            setLevel(nextLevel);
            setFeedback(undefined);
            void save(nextLevel);
          }}
        />
      </div>

      {feedback ? (
        <div className="mt-4">
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onDismiss={() => setFeedback(undefined)}
          />
        </div>
      ) : null}

    </Card>
  );
}
