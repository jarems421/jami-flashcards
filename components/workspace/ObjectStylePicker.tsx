"use client";

import ObjectIcon from "@/components/workspace/ObjectIcon";
import IconBubble from "@/components/ui/IconBubble";
import { cx } from "@/lib/app/class-names";
import {
  OBJECT_COLOR_PRESETS,
  OBJECT_ICON_PICKER_PRESETS,
  type ObjectColorId,
  type ObjectIconId,
} from "@/lib/workspace/object-card-styles";

type ObjectStylePickerProps = {
  color: string;
  icon: string;
  onColorChange: (color: ObjectColorId) => void;
  onIconChange: (icon: ObjectIconId) => void;
  colorLabel?: string;
  iconLabel?: string;
  className?: string;
  compact?: boolean;
  centered?: boolean;
};

export function ObjectStylePicker({
  color,
  icon,
  onColorChange,
  onIconChange,
  colorLabel = "Colour",
  iconLabel = "Icon",
  className,
  compact = false,
  centered = false,
}: ObjectStylePickerProps) {
  return (
    <div className={cx(compact ? "space-y-4" : "space-y-5", className)}>
      <div className="space-y-2">
        <p className={cx(
          "text-sm font-medium text-text-secondary",
          centered && "text-center",
        )}>
          {colorLabel}
        </p>
        <div className={cx("flex flex-wrap gap-2", centered && "justify-center")}>
          {OBJECT_COLOR_PRESETS.map((preset) => {
            const selected = preset.id === color;
            return (
              <button
                key={preset.id}
                type="button"
                aria-label={`Use ${preset.label}`}
                aria-pressed={selected}
                onClick={() => onColorChange(preset.id)}
                className={cx(
                  `${compact ? "h-8 w-8" : "h-9 w-9"} rounded-full border-2 p-0.5 transition duration-fast`,
                  selected
                    ? "border-[var(--color-accent)] shadow-ring"
                    : "border-transparent hover:border-[var(--color-border-strong)]",
                )}
              >
                <span
                  className="block h-full w-full rounded-full"
                  style={{
                    background: `linear-gradient(135deg, ${preset.light}, ${preset.base} 55%, ${preset.dark})`,
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className={cx(
          "text-sm font-medium text-text-secondary",
          centered && "text-center",
        )}>
          {iconLabel}
        </p>
        <div className={cx("flex flex-wrap gap-2", centered && "justify-center")}>
          {OBJECT_ICON_PICKER_PRESETS.map((preset) => {
            const selected = preset.id === icon;
            return (
              <button
                key={preset.id}
                type="button"
                aria-label={`Use ${preset.label} icon`}
                aria-pressed={selected}
                onClick={() => onIconChange(preset.id)}
                className={cx(
                  `inline-grid ${compact ? "h-9 w-9 rounded-xl" : "h-10 w-10 rounded-2xl"} place-items-center border transition duration-fast`,
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-text-secondary",
                )}
              >
                {preset.id === "none" ? (
                  <IconBubble size="xs" shape="circle" className="h-4 w-4 border border-current opacity-60" aria-hidden />
                ) : (
                  <ObjectIcon icon={preset.id} className="h-5 w-5" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
