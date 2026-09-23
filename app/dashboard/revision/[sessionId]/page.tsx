import AppPage from "@/components/layout/AppPage";
import RevisionSessionScreen from "@/components/revision/RevisionSessionScreen";
import { EmptyState } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import { readRevisionReturnHref } from "@/lib/app/routes";

export default async function RevisionSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ return?: string | string[] }>;
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
  const { sessionId } = await params;
  const { return: back } = await searchParams;
  const returnHref = readRevisionReturnHref(Array.isArray(back) ? back[0] : back);
  return (
    <RevisionSessionScreen
      sessionId={sessionId}
      {...(returnHref ? { returnHref } : {})}
    />
  );
}
