"use client";

import ConstellationRenameField from "@/components/constellation/ConstellationRenameField";
import { Button, Card, SectionHeader } from "@/components/ui";
import type { ConstellationRename } from "@/hooks/useConstellationRename";
import type { Constellation } from "@/lib/constellation/constellations";

/** Every sky but the one collecting stars, each one renamed or opened in place. */
export default function PastSkiesCard({
  skies,
  openSkyId,
  rename,
  onOpen,
}: {
  skies: Constellation[];
  openSkyId: string | undefined;
  rename: ConstellationRename;
  onOpen: (constellationId: string) => void;
}) {
  return (
    <Card padding="md" className="space-y-4">
      <SectionHeader
        title="Past skies"
        description="Finished skies stay here. Open one to look at it, rearrange its stars, or redraw its lines."
      />
      <div className="grid gap-3 lg:grid-cols-2">
        {skies.map((sky) => {
          const isOpen = sky.id === openSkyId;
          return (
            <div
              key={sky.id}
              className={`app-panel p-4 text-sm ${isOpen ? "ring-1 ring-[var(--color-selected-border)]" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                {rename.renamingId === sky.id ? (
                  <ConstellationRenameField rename={rename} widthClassName="w-full max-w-[10rem]" />
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-primary">{sky.name}</p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {sky.starCount} star{sky.starCount === 1 ? "" : "s"}
                        {sky.status === "finished" ? " · finished" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="ghost" onClick={() => rename.start(sky)}>
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="surface"
                        disabled={isOpen}
                        onClick={() => onOpen(sky.id)}
                      >
                        {isOpen ? "Viewing" : "Open"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
