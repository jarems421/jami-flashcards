"use client";

import ConstellationRenameField from "@/components/constellation/ConstellationRenameField";
import type { ConstellationRename } from "@/hooks/useConstellationRename";
import type { Constellation } from "@/lib/constellation/constellations";

/** Which sky is open, whether it is the one collecting stars, and the way to another. */
export default function SkyHeader({
  sky,
  constellations,
  activeConstellationId,
  rename,
  onSelect,
}: {
  sky: Constellation;
  constellations: Constellation[];
  activeConstellationId: string | undefined;
  rename: ConstellationRename;
  onSelect: (constellationId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {rename.renamingId === sky.id ? (
          <ConstellationRenameField rename={rename} widthClassName="w-full max-w-xs" />
        ) : (
          <button
            type="button"
            className="group flex min-w-0 items-center gap-2 text-left"
            onClick={() => rename.start(sky)}
          >
            <span className="truncate text-lg font-semibold text-text-primary">{sky.name}</span>
            <span
              aria-hidden="true"
              className="shrink-0 text-text-muted transition-colors group-hover:text-accent"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </span>
            <span className="sr-only">Rename this sky</span>
          </button>
        )}
        <p className="mt-1 text-xs text-text-muted">
          {sky.status === "active" ? "Collecting stars now" : "Finished - kept as a record"}
          {" · "}
          {sky.starCount} of {sky.maxStars} stars
        </p>
      </div>

      {constellations.length > 1 ? (
        <label className="flex shrink-0 flex-col gap-1 text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted sm:items-end">
          Viewing
          <span className="relative mt-1 block">
            <select
              value={sky.id}
              onChange={(event) => onSelect(event.target.value)}
              className="app-field w-full min-w-[12rem] appearance-none truncate rounded-2xl py-2.5 pl-4 pr-10 text-sm font-medium normal-case tracking-normal"
            >
              {constellations.map((constellation) => (
                <option key={constellation.id} value={constellation.id}>
                  {constellation.name}
                  {constellation.id === activeConstellationId ? " (active)" : ""}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
            >
              <path
                d="m6 8 4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>
      ) : null}
    </div>
  );
}
