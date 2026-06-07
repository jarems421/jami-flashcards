export function getDemoEntryBlockReason(input: {
  hasCurrentUser: boolean;
  currentUserIsDemo: boolean;
}) {
  if (input.hasCurrentUser && !input.currentUserIsDemo) {
    return "Sign out of your current account before opening the shared demo.";
  }

  return null;
}
