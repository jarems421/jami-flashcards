"use client";

import { useEffect, useRef } from "react";
import { Button, Input } from "@/components/ui";
import type { ConstellationRename } from "@/hooks/useConstellationRename";

/**
 * The inline field a sky's name turns into while it is being renamed. It is
 * mounted when renaming starts, so it takes the focus as it appears.
 */
export default function ConstellationRenameField({
  rename,
  widthClassName,
}: {
  rename: ConstellationRename;
  widthClassName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        ref={inputRef}
        value={rename.value}
        onChange={(event) => rename.setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void rename.save();
          if (event.key === "Escape") rename.cancel();
        }}
        containerClassName={widthClassName}
      />
      <Button size="sm" onClick={() => void rename.save()} disabled={!rename.value.trim()}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={rename.cancel}>
        Cancel
      </Button>
    </div>
  );
}
