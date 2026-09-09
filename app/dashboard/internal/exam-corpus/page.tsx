import AppPage from "@/components/layout/AppPage";
import { PageHero } from "@/components/ui";
import ExamCorpusWorkspace from "@/components/practice/ExamCorpusWorkspace";

export default function ExamCorpusPage() {
  return (
    <AppPage title="Exam corpus" width="xl">
      <PageHero
        eyebrow="Internal quality"
        title="Real questions, checked before anyone sees them"
        description="Find a licensed course's papers, read them into the bank, and approve each extracted question against its mark scheme. Nothing reaches a student unapproved."
      />
      <ExamCorpusWorkspace />
    </AppPage>
  );
}
