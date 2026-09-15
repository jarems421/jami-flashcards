"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import { EmptyState, Skeleton } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import ExamSessionSetup from "@/components/practice/ExamSessionSetup";

/** Specification topic or concept ids from a link, such as a study action narrowing practice to one. */
function readIds(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((topicId) => topicId.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function NewPastPaperPracticeSetup() {
  const search = useSearchParams();
  return (
    <ExamSessionSetup
      initialFolderId={search.get("folderId") ?? search.get("folder") ?? ""}
      initialTopicIds={readIds(search.get("topics"))}
      initialConceptIds={readIds(search.get("concepts"))}
      originNotebookId={search.get("notebookId") ?? search.get("notebook") ?? undefined}
    />
  );
}

export default function NewPastPaperPracticePage() {
  if (!featureFlags.enablePastPaperPractice) {
    return (
      <AppPage title="Past Paper Practice" backHref="/dashboard/practice" backLabel="Practice">
        <EmptyState
          emoji="📄"
          title="Past Paper Practice is not enabled yet"
          description="This environment has no rights-cleared question corpus, so the feature is switched off."
        />
      </AppPage>
    );
  }
  return (
    <AppPage title="Past Paper Practice" backHref="/dashboard/practice" backLabel="Practice" width="2xl">
      {/* The folder can arrive in the URL, so the setup reads search params. */}
      <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
        <NewPastPaperPracticeSetup />
      </Suspense>
    </AppPage>
  );
}
