"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import { EmptyState, Skeleton } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import ExamSessionSetup from "@/components/practice/ExamSessionSetup";

function NewPastPaperPracticeSetup() {
  const search = useSearchParams();
  return (
    <ExamSessionSetup
      initialFolderId={search.get("folderId") ?? search.get("folder") ?? ""}
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
