"use client";

import type { Feedback } from "@/lib/app/feedback";
import type { SourceManagementController } from "@/hooks/useSourceManagement";
import WorkspaceActionDialog from "@/components/workspace/WorkspaceActionDialog";
import { Button, ConfirmDialog, FeedbackBanner, Input } from "@/components/ui";

type SourceManagementDialogsProps = {
  workflow: SourceManagementController;
  feedback: Feedback | null;
  onDismissFeedback: () => void;
};

/** Dialog presentation for the source-management workflow controller. */
export default function SourceManagementDialogs({
  workflow,
  feedback,
  onDismissFeedback,
}: SourceManagementDialogsProps) {
  return (
    <>
      <WorkspaceActionDialog
        open={workflow.renameOpen}
        title="Rename source"
        busy={workflow.busyAction === "rename-source"}
        onClose={workflow.closeRename}
      >
        {feedback ? (
          <div className="mb-4">
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              autoDismissMs={0}
              onDismiss={onDismissFeedback}
            />
          </div>
        ) : null}
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (workflow.renameTitle.trim()) void workflow.saveRename();
          }}
        >
          <Input
            label="Source title"
            value={workflow.renameTitle}
            data-dialog-autofocus="true"
            onChange={(event) => workflow.setRenameTitle(event.target.value)}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={workflow.busyAction === "rename-source"}
              onClick={workflow.closeRename}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                workflow.busyAction === "rename-source" ||
                !workflow.renameTitle.trim()
              }
            >
              {workflow.busyAction === "rename-source" ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </WorkspaceActionDialog>

      <ConfirmDialog
        open={workflow.confirmation === "archive"}
        title="Archive this source?"
        description="It will leave active Sources and its folders, but the source and uploaded file will be kept. You can restore it later."
        confirmLabel="Archive source"
        busy={workflow.busyAction === "archive-source"}
        tone="primary"
        onClose={workflow.closeConfirmation}
        onConfirm={() => void workflow.archive()}
      />
      <ConfirmDialog
        open={workflow.confirmation === "delete"}
        title="Delete this source everywhere?"
        description="This permanently removes the source from Sources and every folder. An uploaded file will also be deleted. This cannot be undone."
        confirmLabel="Delete source"
        busy={workflow.busyAction === "delete-source"}
        onClose={workflow.closeConfirmation}
        onConfirm={() => void workflow.deleteEverywhere()}
      />
    </>
  );
}
