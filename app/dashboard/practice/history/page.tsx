import AppPage from "@/components/layout/AppPage";
import { EmptyState } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import ExamPracticeHistory from "@/components/practice/ExamPracticeHistory";

export default function PracticeHistoryPage() {
  if (!featureFlags.enablePastPaperPractice) {
    return (
      <AppPage title="Practice history" backHref="/dashboard/practice" backLabel="Practice">
        <EmptyState
          emoji="📄"
          title="Past Paper Practice is not enabled yet"
          description="This environment has no rights-cleared question corpus, so the feature is switched off."
        />
      </AppPage>
    );
  }
  return <ExamPracticeHistory />;
}
