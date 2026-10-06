import { Button, Card, Select } from "@/components/ui";
import type { Notebook } from "@/lib/workspace/notebooks";

/** Keeping a marked answer as a page in one of the folder's notebooks. */
export default function ExamNotebookSaveCard({
  choices,
  notebookId,
  onPick,
  saving,
  saved,
  onSave,
}: {
  choices: readonly Pick<Notebook, "id" | "title">[];
  notebookId: string;
  onPick: (notebookId: string) => void;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <Card tone="subtle" padding="md">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">Keep this in a notebook</h3>
          <p className="mt-0.5 text-sm text-text-muted">A marked page with the question, your work and the feedback.</p>
        </div>
        {saved ? (
          <p className="shrink-0 text-sm font-semibold text-[var(--color-success-text)]">Saved to your notebook.</p>
        ) : (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Select
              aria-label="Notebook"
              value={notebookId}
              className="sm:min-w-64"
              onChange={(event) => onPick(event.target.value)}
            >
              <option value="">Choose notebook</option>
              {choices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </Select>
            <Button variant="secondary" disabled={!notebookId || saving} onClick={onSave}>
              {saving ? "Saving…" : "Save to notebook"}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
