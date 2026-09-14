"use client";

import type {
  ObjectColorId,
  ObjectIconId,
} from "@/lib/workspace/object-card-styles";
import { ObjectStylePicker } from "./ObjectStylePicker";

type FolderLookSectionProps = {
  color: ObjectColorId;
  icon: ObjectIconId;
  onColorChange: (color: ObjectColorId) => void;
  onIconChange: (icon: ObjectIconId) => void;
};

/**
 * A folder's colour and icon.
 *
 * No box and no preview of its own: the folder being made is already shown
 * beside its name at the top of the form, and changes as these are picked.
 */
export default function FolderLookSection({
  color,
  icon,
  onColorChange,
  onIconChange,
}: FolderLookSectionProps) {
  return (
    <ObjectStylePicker
      color={color}
      icon={icon}
      onColorChange={onColorChange}
      onIconChange={onIconChange}
      colorLabel="Colour"
      iconLabel="Icon"
      compact
    />
  );
}
