"use client";

import Link from "next/link";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";
import ObjectActionsSheet from "@/components/workspace/ObjectActionsSheet";
import { useObjectCardActions } from "@/hooks/useObjectCardActions";
import type { DeckColorPresetId, DeckIconPresetId } from "@/lib/study/deck-style";

type DeckObjectCardProps = {
  title: string;
  colorPreset?: DeckColorPresetId | string;
  iconPreset?: DeckIconPresetId | string;
  href: string;
  onRemoveFromFolder?: () => void;
  removing?: boolean;
};

export default function DeckObjectCard({
  title,
  colorPreset,
  iconPreset,
  href,
  onRemoveFromFolder,
  removing = false,
}: DeckObjectCardProps) {
  const actionSheet = useObjectCardActions("deck");

  return (
    <div
      className="relative h-full select-none md:select-auto"
      style={{ WebkitTouchCallout: "none" }}
      {...actionSheet.pressProps}
    >
      <Link
        href={href}
        className="app-panel group flex h-full min-h-[6.25rem] items-center gap-3 p-3 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell"
        aria-label={`Open ${title}`}
      >
        <DeckCoverIcon
          colorPreset={colorPreset}
          iconPreset={iconPreset}
          className="h-16 w-14 rounded-md"
        />
        <div className="min-w-0 flex-1 pr-7">
          <div className="line-clamp-2 text-sm font-semibold leading-5 text-text-primary">
            {title}
          </div>
          <div className="mt-1 text-xs font-medium text-text-muted">Flashcard deck</div>
        </div>
      </Link>

      {onRemoveFromFolder ? (
        <>
          <button
            type="button"
            className="sr-only md:hidden"
            onClick={actionSheet.open}
          >
            Open deck actions for {title}
          </button>
          <details className="group/actions absolute right-3 top-3 z-20 hidden md:block">
            <summary
              aria-label={`Deck actions for ${title}`}
              title="Deck actions"
              className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--color-surface-panel-strong)] text-sm font-bold tracking-[0.08em] text-text-secondary shadow-sm transition hover:text-text-primary [&::-webkit-details-marker]:hidden"
            >
              ...
            </summary>
            <div className="absolute right-0 top-9 grid min-w-44 gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1.5 text-left shadow-e2">
              <button
                type="button"
                disabled={removing}
                className="rounded-lg px-3 py-2 text-left text-sm font-medium text-danger-text transition hover:bg-error-muted disabled:cursor-not-allowed disabled:opacity-60"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  onRemoveFromFolder();
                }}
              >
                {removing ? "Removing..." : "Remove from folder"}
              </button>
            </div>
          </details>

          <ObjectActionsSheet
            open={actionSheet.isOpen}
            objectKind="deck"
            title={title}
            actions={[
              {
                id: "remove",
                label: removing ? "Removing..." : "Remove from folder",
                tone: "danger",
                disabled: removing,
                onSelect: onRemoveFromFolder,
              },
            ]}
            onClose={actionSheet.close}
          />
        </>
      ) : null}
    </div>
  );
}
