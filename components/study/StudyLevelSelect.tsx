"use client";

import { useId } from "react";
import {
  STUDY_LEVEL_OPTIONS,
  type StudyLevel,
} from "@/lib/profile/study-level";

type StudyLevelSelectProps = {
  value: StudyLevel | "";
  onChange: (value: StudyLevel | "") => void;
  emptyLabel: string;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
};

export default function StudyLevelSelect({
  value,
  onChange,
  emptyLabel,
  label = "Study level",
  description,
  disabled = false,
  id,
}: StudyLevelSelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const descriptionId = description ? `${selectId}-description` : undefined;

  return (
    <div>
      <label
        htmlFor={selectId}
        className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
      >
        {label}
      </label>
      <select
        id={selectId}
        value={value}
        disabled={disabled}
        aria-describedby={descriptionId}
        className="app-field min-h-[3.25rem] w-full rounded-2xl px-4 py-3 text-sm outline-none transition duration-fast disabled:cursor-not-allowed disabled:saturate-[0.82]"
        onChange={(event) =>
          onChange(event.target.value as StudyLevel | "")
        }
      >
        <option value="">{emptyLabel}</option>
        {STUDY_LEVEL_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {description ? (
        <p id={descriptionId} className="mt-2 text-xs leading-5 text-text-muted">
          {description}
        </p>
      ) : null}
    </div>
  );
}
