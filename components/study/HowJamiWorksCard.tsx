"use client";

import { useState } from "react";
import { Button, Card, IconBubble, SectionHeader } from "@/components/ui";

export default function HowJamiWorksCard() {
  const [open, setOpen] = useState(false);
  const steps = [
    ["1", "Learn"],
    ["2", "Practice"],
    ["3", "Drafts"],
    ["4", "Progress"],
  ];

  return (
    <Card padding="md" className="sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader title="How Jami works" />
        <Button
          type="button"
          onClick={() => setOpen((value) => !value)}
          variant="secondary"
          size="sm"
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open ? (
        <div className="mt-5 grid gap-2 sm:grid-cols-4">
          {steps.map(([step, title]) => (
            <div
              key={step}
              className="app-subtle-panel flex items-center gap-3 rounded-[1.1rem] p-3"
            >
              <IconBubble size="sm" shape="circle" className="app-chip font-semibold">
                {step}
              </IconBubble>
              <div className="text-sm font-semibold text-text-primary">{title}</div>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
