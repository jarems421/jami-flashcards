"use client";

import FormDisclosure from "@/components/ui/FormDisclosure";
import NotebookPenSettingSlider from "@/components/workspace/NotebookPenSettingSlider";
import {
  getNotebookCornerSharpness,
  getNotebookCornerSharpnessLabel,
  getNotebookPressureLabel,
  getNotebookSteadinessLabel,
  getNotebookStraightenLabel,
  getNotebookTrackingLabel,
  hasNotebookPenAdvancedChanges,
  NOTEBOOK_STRAIGHTEN_MODES,
  resetNotebookPenAdvancedSettings,
  type NotebookPenSettings,
  type NotebookStraightenOnHold,
} from "@/lib/workspace/notebook-pen-feel";

const STRAIGHTEN_SHORT: Record<NotebookStraightenOnHold, string> = {
  off: "Off",
  lines: "Straighten",
  guided: "Straighten + level",
};

/**
 * The pen settings behind Smoothing.
 *
 * Smoothing is one number standing in for several, and that is the right thing
 * for almost everybody: it moves all of them somewhere sensible together. What
 * it cannot do is separate them, and the complaints it gets are about exactly
 * that -- a hand that wants its wobble filtered hard does not necessarily want
 * its corners rounded off too, and turning one down turns the other down with
 * it.
 *
 * So the constants Smoothing covers are also settable on their own, folded away
 * until they are wanted. Every control here reproduces the previous behaviour at
 * the middle of its travel, so opening this section and closing it again cannot
 * change how the pen writes.
 */
export default function NotebookPenAdvancedSettings({
  settings,
  onChange,
}: {
  settings: NotebookPenSettings;
  onChange: (next: NotebookPenSettings) => void;
}) {
  const cornerSharpness = getNotebookCornerSharpness(settings);
  const followingSmoothing = settings.cornerSharpnessPercent === null;
  const changed = hasNotebookPenAdvancedChanges(settings);
  const set = (patch: Partial<NotebookPenSettings>) =>
    onChange({ ...settings, ...patch });

  return (
    <FormDisclosure
      title="Advanced"
      summary={changed ? "Customised" : "Default"}
      className="mt-1"
    >
      <div className="space-y-3.5">
        <div>
          <NotebookPenSettingSlider
            label="Corner sharpness"
            name={getNotebookCornerSharpnessLabel(cornerSharpness).name}
            description={
              getNotebookCornerSharpnessLabel(cornerSharpness).description
            }
            percent={cornerSharpness}
            disabled={followingSmoothing}
            onChange={(value) => set({ cornerSharpnessPercent: value })}
          />
          {/* Corners are the half of Smoothing that decides whether writing
              reads as flowing or as a run of short straight runs, so this is
              the control most likely to be reached for -- and the link back to
              Smoothing has to be lettable-go of without the pen changing under
              the reader, which is why it starts where Smoothing had it. */}
          <button
            type="button"
            onClick={() =>
              set({
                cornerSharpnessPercent: followingSmoothing
                  ? cornerSharpness
                  : null,
              })
            }
            className="mt-0.5 min-h-[1.75rem] px-0.5 text-2xs font-semibold text-[var(--color-selected-text)] transition hover:underline"
          >
            {followingSmoothing
              ? "Set separately from Smoothing"
              : "Follow Smoothing again"}
          </button>
        </div>

        <NotebookPenSettingSlider
          label="Line steadiness"
          name={getNotebookSteadinessLabel(settings.steadinessPercent).name}
          description={
            getNotebookSteadinessLabel(settings.steadinessPercent).description
          }
          percent={settings.steadinessPercent}
          onChange={(value) => set({ steadinessPercent: value })}
        />

        <NotebookPenSettingSlider
          label="Nib tracking"
          name={getNotebookTrackingLabel(settings.trackingPercent).name}
          description={
            getNotebookTrackingLabel(settings.trackingPercent).description
          }
          percent={settings.trackingPercent}
          onChange={(value) => set({ trackingPercent: value })}
        />

        <NotebookPenSettingSlider
          label="Pressure"
          name={getNotebookPressureLabel(settings.pressurePercent).name}
          description={
            getNotebookPressureLabel(settings.pressurePercent).description
          }
          percent={settings.pressurePercent}
          onChange={(value) => set({ pressurePercent: value })}
        />

        <div>
          <div className="px-0.5 text-xs font-semibold text-text-secondary">
            Hold still at the end of a stroke
          </div>
          <div
            role="radiogroup"
            aria-label="Hold still at the end of a stroke"
            className="mt-1.5 grid grid-cols-3 gap-1.5"
          >
            {NOTEBOOK_STRAIGHTEN_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={settings.straightenOnHold === mode}
                aria-label={getNotebookStraightenLabel(mode).name}
                onClick={() => set({ straightenOnHold: mode })}
                className={`min-h-11 rounded-full border px-2 text-2xs font-semibold leading-tight transition ${
                  settings.straightenOnHold === mode
                    ? "app-selected"
                    : "app-chip"
                }`}
              >
                {STRAIGHTEN_SHORT[mode]}
              </button>
            ))}
          </div>
          <p className="mt-1 px-0.5 text-2xs leading-4 text-text-secondary">
            {getNotebookStraightenLabel(settings.straightenOnHold).description}
          </p>
        </div>

        <div className="border-t border-[var(--color-border)] pt-2.5">
          <button
            type="button"
            disabled={!changed}
            onClick={() => onChange(resetNotebookPenAdvancedSettings(settings))}
            className="inline-flex min-h-[2.25rem] w-full items-center justify-center rounded-full px-3 text-xs font-semibold text-text-secondary transition hover:bg-[var(--color-glass-medium)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset advanced settings
          </button>
        </div>
      </div>
    </FormDisclosure>
  );
}
