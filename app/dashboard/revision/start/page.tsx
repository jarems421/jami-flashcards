import AppPage from "@/components/layout/AppPage";
import RevisionSessionStarter from "@/components/revision/RevisionSessionStarter";
import RevisionStartPicker from "@/components/revision/RevisionStartPicker";
import { EmptyState } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import { readRevisionReturnHref } from "@/lib/app/routes";

type SearchParams = {
  folder?: string | string[];
  topic?: string | string[];
  return?: string | string[];
};

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

/**
 * Starting a Revision Session on something the student chose.
 *
 * With a folder and a concept it goes straight in -- the Topic page, a
 * notebook and a finished session's "next" all link here that way. Otherwise it
 * asks: which subject, then what in it.
 */
export default async function StartRevisionSessionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const returnHref = readRevisionReturnHref(first(params.return));
  const back = returnHref ?? "/dashboard";

  if (!featureFlags.enableRevisionSessions) {
    return (
      <AppPage title="Revision session" backHref={back} backLabel="Back">
        <EmptyState
          emoji="📘"
          title="Revision sessions aren't switched on here"
          description="Your folders and Today still work as usual."
        />
      </AppPage>
    );
  }

  const folderId = first(params.folder);
  const topicKey = first(params.topic);
  if (folderId && topicKey) {
    return (
      <RevisionSessionStarter
        start={{ folderId, topicKey }}
        {...(returnHref ? { returnHref } : {})}
      />
    );
  }

  return (
    <AppPage
      title="Revision session"
      backHref={back}
      backLabel={returnHref ? "Back" : "Today"}
      width="md"
      contentClassName="space-y-4"
    >
      <RevisionStartPicker
        {...(folderId ? { folderId } : {})}
        {...(returnHref ? { returnHref } : {})}
      />
    </AppPage>
  );
}
