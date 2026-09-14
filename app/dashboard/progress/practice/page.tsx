"use client";

import AppPage from "@/components/layout/AppPage";
import PracticeProgress from "@/components/progress/PracticeProgress";
import { useUser } from "@/components/providers/UserProvider";
import { EmptyState } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import { PROGRESS_TITLE, PROGRESS_VIEWS } from "@/lib/app/progress-views";

export default function ProgressPracticePage() {
  const { user } = useUser();

  return (
    <AppPage
      title={PROGRESS_TITLE}
      views={PROGRESS_VIEWS}
      viewsLabel="Progress views"
      backHref="/dashboard"
      backLabel="Today"
      width="xl"
      contentClassName="space-y-4"
    >
      {featureFlags.enableMasteryProgress ? (
        <PracticeProgress userId={user.uid} />
      ) : (
        <EmptyState
          emoji="Progress"
          eyebrow="Not enabled"
          title="Progress is behind a feature flag"
          description="Enable mastery progress after topics and notebooks are ready."
        />
      )}
    </AppPage>
  );
}
