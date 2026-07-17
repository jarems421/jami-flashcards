import PracticeWorkspace from "@/components/workspace/PracticeWorkspace";
import AppPage from "@/components/layout/AppPage";
import { EmptyState } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";

export default function FoldersPage() {
  if (!featureFlags.enableFolders) {
    return (
      <AppPage title="Folders">
        <EmptyState
          emoji="📁"
          title="Folders are not enabled yet"
          description="The folder workspace is behind a feature flag in this environment."
        />
      </AppPage>
    );
  }

  return <PracticeWorkspace />;
}
