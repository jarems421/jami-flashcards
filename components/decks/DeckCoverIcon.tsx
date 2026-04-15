import {
  getDeckColorPreset,
  getDeckIconPreset,
  type DeckColorPresetId,
  type DeckIconPresetId,
} from "@/lib/study/deck-style";

type Props = {
  colorPreset?: DeckColorPresetId | string;
  iconPreset?: DeckIconPresetId | string;
  className?: string;
};

export default function DeckCoverIcon({
  colorPreset,
  iconPreset,
  className = "h-14 w-14",
}: Props) {
  const color = getDeckColorPreset(colorPreset);
  const icon = getDeckIconPreset(iconPreset);

  return (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-[1.2rem] border border-white/[0.14] text-white shadow-[0_16px_32px_rgba(7,2,22,0.24)]`}
      style={{ backgroundImage: color.iconGradient }}
      title={icon.label}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
        <path d={icon.path} />
      </svg>
    </div>
  );
}
