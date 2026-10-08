"use client";

import { Button, Card, Input, SectionHeader } from "@/components/ui";

/**
 * Naming the sky that collects the next stars, shown while none is collecting:
 * before the first one, or once every sky is finished.
 */
export default function NewSkyCard({
  hasSkies,
  name,
  onNameChange,
  creating,
  onCreate,
}: {
  hasSkies: boolean;
  name: string;
  onNameChange: (name: string) => void;
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <Card tone="warm" padding="md">
      <SectionHeader
        eyebrow={hasSkies ? "Every sky finished" : "Reward space"}
        title={hasSkies ? "Start your next sky" : "Create your first sky"}
        description={
          hasSkies
            ? "Nothing is collecting stars at the moment. Name the next sky and the stars from your next goals will land in it."
            : "Stars from completed goals need somewhere to live. Make a sky now and let rewards fill it over time."
        }
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <Input
          placeholder="Sky name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCreate();
          }}
          containerClassName="w-full max-w-xs"
        />
        <Button type="button" disabled={creating || !name.trim()} onClick={onCreate}>
          {creating ? "Creating..." : "Create sky"}
        </Button>
      </div>
    </Card>
  );
}
