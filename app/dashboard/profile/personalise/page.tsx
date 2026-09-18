"use client";

import AppPage from "@/components/layout/AppPage";
import AppFontCard from "@/components/profile/AppFontCard";
import PhotoBackgroundCard from "@/components/profile/PhotoBackgroundCard";
import ThemePreferenceCard from "@/components/profile/ThemePreferenceCard";
import HowJamiWorksCard from "@/components/study/HowJamiWorksCard";
import { TutorialAccountCard } from "@/components/onboarding/TutorialProvider";
import { PageHero } from "@/components/ui";
import { ACCOUNT_TITLE, ACCOUNT_VIEWS } from "@/lib/app/account-views";

/**
 * The half of Account that is about the app rather than the person.
 *
 * Two groups, each announced before its cards: what Jami looks like, and what
 * helps you find your way around it. They used to be four cards stacked in the
 * middle of the account page with no heading between them, so a colour picker,
 * a photo cropper, a font list and a walkthrough read as one undifferentiated
 * run of settings.
 */
export default function AccountPersonalisePage() {
  return (
    <AppPage
      title={ACCOUNT_TITLE}
      views={ACCOUNT_VIEWS}
      viewsLabel="Account views"
      backHref="/dashboard"
      backLabel="Today"
      width="2xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      <PageHero
        eyebrow="Personalise"
        title="Make Jami yours"
        description="Colour, background and type are saved to your account, so Jami looks the same on every device you sign into."
        compact
      />

      <section aria-label="How Jami looks" className="space-y-4 sm:space-y-6">
        <ThemePreferenceCard />
        <PhotoBackgroundCard />
        <AppFontCard />
      </section>

      {/*
        Finding your way around is not appearance, so it gets its own heading
        rather than being the fourth card in the run above.
      */}
      <section aria-label="Finding your way around" className="space-y-4 pt-2 sm:space-y-6">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
          Finding your way around
        </h2>
        <TutorialAccountCard />
        <HowJamiWorksCard />
      </section>
    </AppPage>
  );
}
