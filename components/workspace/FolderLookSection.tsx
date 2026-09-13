"use client";

import { FormSection } from "@/components/ui";
import type {
  ObjectColorId,
  ObjectIconId,
} from "@/lib/workspace/object-card-styles";
import FolderObjectCard from "./FolderObjectCard";
import { ObjectStylePicker } from "./ObjectStylePicker";

type FolderLookSectionProps = {
  name: string;
  color: ObjectColorId;
  icon: ObjectIconId;
  onColorChange: (color: ObjectColorId) => void;
  onIconChange: (icon: ObjectIconId) => void;
};

/** A folder's colour and icon, beside the folder they will make. */
export default function FolderLookSection({
  name,
  color,
  icon,
  onColorChange,
  onIconChange,
}: FolderLookSectionProps) {
  return (
    <FormSection title="Look">
      <div className="grid gap-4 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-center">
        {/* Swatches already show the choice on a phone, where width is short. */}
        <div
          aria-hidden="true"
          className="app-subtle-panel hidden rounded-xl p-1.5 sm:block"
        >
          <FolderObjectCard
            compact
            title={name.trim() || "New folder"}
            color={color}
            icon={icon}
          />
        </div>
        <ObjectStylePicker
          color={color}
          icon={icon}
          onColorChange={onColorChange}
          onIconChange={onIconChange}
          colorLabel="Folder colour"
          iconLabel="Folder icon"
          compact
        />
      </div>
    </FormSection>
  );
}
