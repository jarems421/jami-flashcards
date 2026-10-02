"use client";

import { useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui";
import { Dialog, DialogDescription, DialogPanel, DialogTitle } from "@/components/ui/Dialog";
import NightSkyBackdrop from "@/components/constellation/NightSkyBackdrop";
import CelestialBody from "@/components/billing/CelestialBody";
import { PLAN_ALLOWANCES, PLAN_LABELS, type PaidPlanId } from "@/lib/billing/plans";

/**
 * The welcome a student sees back from paying: the night Jami opens on, their
 * plan arriving -- Nova's planet with its ring drawing in, Celestial's galaxy
 * turning -- light rising around it, and what the month now holds.
 *
 * Deliberately not stars. A star in Jami means a goal the student earned
 * (docs/ui-design-system.md), and buying a plan is not that. The motes are the
 * same dust as the night sky, and nothing here blends or is promoted, so the
 * frame budget holds on an old iPad.
 */

const MOTES = 22;

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export default function PlanWelcome({ plan, onClose }: { plan: PaidPlanId; onClose: () => void }) {
  const startRef = useRef<HTMLAnchorElement>(null);
  const [motes] = useState(() => {
    const random = seeded(11);
    return Array.from({ length: MOTES }, () => ({
      left: 30 + random() * 40,
      size: 1.5 + random() * 2.5,
      delay: random() * 5,
      duration: 4 + random() * 4,
      drift: (random() - 0.5) * 120,
      opacity: 0.4 + random() * 0.6,
    }));
  });
  const allowances = PLAN_ALLOWANCES[plan];
  const label = PLAN_LABELS[plan];
  const warm = plan === "pro";

  return (
    <Dialog
      open
      initialFocusRef={startRef}
      className="fixed inset-0 z-[95] flex items-center justify-center"
      onDismiss={onClose}
    >
      <DialogPanel className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[#06041a] px-6 text-center text-white">
        <NightSkyBackdrop />
        {motes.map((mote, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="plan-welcome-mote"
            style={
              {
                left: `${mote.left}%`,
                width: mote.size,
                height: mote.size,
                animationDelay: `${mote.delay}s`,
                animationDuration: `${mote.duration}s`,
                "--mote-x": `${mote.drift}px`,
                "--mote-o": mote.opacity,
              } as React.CSSProperties
            }
          />
        ))}

        <div className="relative flex max-w-md flex-col items-center">
          <div className="relative grid h-44 w-44 place-items-center">
            <div
              aria-hidden="true"
              className={`plan-welcome-halo absolute inset-[-30%] rounded-full ${
                warm
                  ? "bg-[radial-gradient(circle,rgba(255,200,236,.38)_0%,rgba(255,170,220,.12)_40%,transparent_70%)]"
                  : "bg-[radial-gradient(circle,rgba(160,138,255,.45)_0%,rgba(120,94,255,.14)_40%,transparent_70%)]"
              }`}
            />
            <CelestialBody plan={plan} size={176} animated className="plan-welcome-planet relative" />
          </div>

          <div className="plan-welcome-rise mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-[#cfc6ff]" style={{ animationDelay: "0.9s" }}>
            You&apos;re in
          </div>
          <DialogTitle
            className="plan-welcome-rise mt-3 text-4xl font-semibold tracking-tight sm:text-5xl"
            style={{ animationDelay: "1.05s" }}
          >
            Welcome to{" "}
            <span
              className={`bg-clip-text text-transparent ${
                warm
                  ? "bg-[linear-gradient(100deg,#ffd6f6,#c9bcff)]"
                  : "bg-[linear-gradient(100deg,#c9bcff,#ffd6f6)]"
              }`}
            >
              {label}
            </span>
          </DialogTitle>
          <DialogDescription
            className="plan-welcome-rise mt-3 text-base leading-7 text-[#d9d3f7]"
            style={{ animationDelay: "1.2s" }}
          >
            This month you have {allowances.papers.limit} Jami papers,{" "}
            {allowances.tutor.limit.toLocaleString("en-GB")} Tutor messages and room for every subject.
          </DialogDescription>
          <div className="plan-welcome-rise mt-8 flex w-full flex-col gap-2 sm:w-auto sm:flex-row" style={{ animationDelay: "1.4s" }}>
            <ButtonLink ref={startRef} href="/dashboard" size="lg" className="justify-center px-8" onClick={onClose}>
              Start revising
            </ButtonLink>
            <Button variant="ghost" size="lg" className="justify-center text-white" onClick={onClose}>
              See my plan
            </Button>
          </div>
          <p className="plan-welcome-rise mt-5 text-xs text-[#a9a2d6]" style={{ animationDelay: "1.6s" }}>
            It can take a moment to show on your account.
          </p>
        </div>
      </DialogPanel>
    </Dialog>
  );
}

