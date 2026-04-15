type BackFormatPresetsProps = {
  onApply: (nextBack: string) => void;
  currentBack: string;
  disabled?: boolean;
};

const PRESETS: Array<{ label: string; template: string }> = [
  {
    label: "Bullets",
    template: "- Key point 1\n- Key point 2\n- Key point 3",
  },
  {
    label: "Numbered",
    template: "1. First step\n2. Second step\n3. Final step",
  },
  {
    label: "Definition",
    template: "Definition:\n- \nExample:\n- ",
  },
  {
    label: "Formula",
    template: "Formula: \nVariables:\n- \n- ",
  },
  {
    label: "Compare",
    template: "Concept A:\n- \nConcept B:\n- \nKey difference:\n- ",
  },
];

function mergeTemplate(currentBack: string, template: string) {
  const trimmed = currentBack.trim();
  if (!trimmed) {
    return template;
  }

  return `${trimmed}\n\n${template}`;
}

export default function BackFormatPresets({
  onApply,
  currentBack,
  disabled = false,
}: BackFormatPresetsProps) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-text-muted">
        Answer format shortcuts
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={disabled}
            onClick={() => onApply(mergeTemplate(currentBack, preset.template))}
            className="rounded-full border border-white/[0.12] bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-text-secondary transition duration-fast hover:border-border-strong hover:bg-white/[0.08] disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
