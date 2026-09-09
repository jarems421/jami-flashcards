import AppPage from "@/components/layout/AppPage";
import { EmptyState } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import ExamSessionWorkspace from "@/components/practice/ExamSessionWorkspace";

export default async function PastPaperPracticeSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
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
  return <ExamSessionWorkspace sessionId={sessionId} />;
}
