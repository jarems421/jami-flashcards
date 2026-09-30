import AppPage from "@/components/layout/AppPage";
import RevisionSessionStarter from "@/components/revision/RevisionSessionStarter";
import { EmptyState } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";

export default async function NewRevisionSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string | string[] }>;
}) {
  if (!featureFlags.enableRevisionSessions) {
    return (
      <AppPage title="Revision session" backHref="/dashboard" backLabel="Today">
        <EmptyState
          emoji="📘"
          title="Revision sessions aren't switched on here"
          description="Today will point you at your material instead."
        />
      </AppPage>
    );
  }
  const { action } = await searchParams;
  const actionId = (Array.isArray(action) ? action[0] : action)?.trim() ?? "";
  return <RevisionSessionStarter start={{ actionId }} />;
}
