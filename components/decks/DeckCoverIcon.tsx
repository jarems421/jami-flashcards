import {
  getDeckColorPreset,
  type DeckColorPresetId,
  type DeckIconPresetId,
} from "@/lib/study/deck-style";
import IconBubble from "@/components/ui/IconBubble";
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
    <IconBubble
      className={`${className} rounded-[1.2rem] border border-white/[0.14] text-white shadow-[0_16px_32px_rgba(7,2,22,0.24)]`}
      style={{
        background: `linear-gradient(145deg, ${color.light}, ${color.base} 52%, ${color.dark})`,
      }}
    >
      <ObjectIcon icon={iconPreset} className="h-7 w-7 text-white/78 drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]" />
    </IconBubble>
  );
}
