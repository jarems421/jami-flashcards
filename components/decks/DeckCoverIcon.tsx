import {
  getDeckColorPreset,
  type DeckColorPresetId,
  type DeckIconPresetId,
} from "@/lib/study/deck-style";
import ObjectIcon from "@/components/workspace/ObjectIcon";

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

  return (
    <div
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[0.9rem] border border-black/15 text-white shadow-[0_8px_16px_rgba(5,8,18,0.2)] ${className}`}
      style={{
        background: `linear-gradient(145deg, ${color.light} 0%, ${color.base} 58%, ${color.dark} 100%)`,
      }}
    >
      <div className="absolute inset-y-0 left-0 w-[18%] border-r border-black/15 bg-black/10" aria-hidden="true" />
      <ObjectIcon icon={iconPreset} className="h-[48%] w-[48%] text-white/88" />
    </div>
  );
}
