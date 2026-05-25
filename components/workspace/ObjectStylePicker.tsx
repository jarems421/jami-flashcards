"use client";

import ObjectIcon from "@/components/workspace/ObjectIcon";
import {
  OBJECT_COLOR_PRESETS,
  OBJECT_ICON_PRESETS,
  type ObjectColorId,
  type ObjectIconId,
} from "@/components/workspace/object-card-styles";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ObjectStylePickerProps = {
  color: string;
  icon: string;
  onColorChange: (color: ObjectColorId) => void;
  onIconChange: (icon: ObjectIconId) => void;
  colorLabel?: string;
  iconLabel?: string;
  className?: string;
};

export function ObjectStylePicker({
  color,
  icon,
  onColorChange,
  onIconChange,
  colorLabel = "Colour",
  iconLabel = "Icon",
  className,
}: ObjectStylePickerProps) {
  return (
    <div className={cx("space-y-4", className)}>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
          {colorLabel}
        </p>
        <div className="flex flex-wrap gap-2">
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
                  "h-9 w-9 rounded-full border p-0.5 transition hover:-translate-y-0.5",
                  selected
                    ? "border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-muted)]"
                    : "border-[var(--color-border)]",
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
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
          {iconLabel}
        </p>
        <div className="flex flex-wrap gap-2">
          {OBJECT_ICON_PRESETS.map((preset) => {
            const selected = preset.id === icon;
            return (
              <button
                key={preset.id}
                type="button"
                aria-label={`Use ${preset.label} icon`}
                aria-pressed={selected}
                onClick={() => onIconChange(preset.id)}
                className={cx(
                  "flex h-10 w-10 items-center justify-center rounded-2xl border transition hover:-translate-y-0.5",
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-[var(--color-text-muted)]",
                )}
              >
                <ObjectIcon icon={preset.id} className="h-5 w-5" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
