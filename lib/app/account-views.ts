/** Structurally what `ViewTabs` renders, without reaching into it. */
export type AccountView = {
  href: string;
  label: string;
  detail: string;
};

/**
 * Account in two views: who you are, and how Jami feels.
 *
 * One page carried both, and the two have nothing to do with each other. A
 * student changing the colour of the app scrolled past their sign-in and the
 * button that deletes everything to reach it, and a student who came to sign
 * out met six appearance cards first. Neither half is long on its own, so the
 * split is what gives each one room rather than a way of hiding length.
 *
 * Personalise lives under Account's own address, so the sidebar entry stays
 * lit on both and every existing link to /dashboard/profile still lands on the
 * account half it was written for.
 */
export const ACCOUNT_VIEWS: AccountView[] = [
  {
    href: "/dashboard/profile",
    label: "Account",
    detail: "Your profile, reminders and sign-in",
  },
  {
    href: "/dashboard/profile/personalise",
    label: "Personalise",
    detail: "How Jami looks and shows you around",
  },
];

export const ACCOUNT_TITLE = "Account";
