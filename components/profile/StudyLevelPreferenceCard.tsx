"use client";

import { useEffect, useState } from "react";
import StudyLevelSelect from "@/components/study/StudyLevelSelect";
import { Button, Card, FeedbackBanner, SectionHeader } from "@/components/ui";
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
  const [savedLevel, setSavedLevel] = useState<StudyLevel | "">("");
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
          setSavedLevel(current);
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

  const save = async () => {
    setSaving(true);
    setFeedback(undefined);
    try {
      const saved = (await saveDefaultStudyLevel(userId, level || null)) ?? "";
      setLevel(saved);
      setSavedLevel(saved);
      setFeedback({ type: "success", message: "Default study level saved." });
    } catch (error) {
      console.error("Failed to save the default study level.", error);
      setFeedback({
        type: "error",
        message: "Jami could not save your study level.",
      });
    } finally {
      setSaving(false);
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

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-4 w-full justify-center sm:w-auto"
        disabled={loading || saving || level === savedLevel}
        onClick={() => void save()}
      >
        {saving ? "Saving..." : "Save study level"}
      </Button>
    </Card>
  );
}
