import AppPage from "@/components/layout/AppPage";
import PaperQualityWorkspace from "@/components/practice/PaperQualityWorkspace";
import { PageHero } from "@/components/ui";

export default function PaperQualityPage() {
  return (
    <AppPage title="Paper quality" width="xl">
      <PageHero
        eyebrow="Internal quality"
        title="Paper generation, measured properly"
        description="Build official format profiles, run the held-out 108-paper benchmark, and review every paper before approving a release baseline."
      />
      <PaperQualityWorkspace />
    </AppPage>
  );
}
