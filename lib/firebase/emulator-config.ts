export type FirebaseEmulatorConfig =
  | { enabled: false }
  | {
      enabled: true;
      host: "127.0.0.1";
      authPort: 9099;
      firestorePort: 8085;
      storagePort: 9199;
    };

export function resolveFirebaseEmulatorConfig(input: {
  enabled: string | undefined;
  projectId: string;
}): FirebaseEmulatorConfig {
  if (input.enabled?.trim().toLowerCase() !== "true") {
    return { enabled: false };
  }

  const projectId = input.projectId.trim();
  if (!projectId.startsWith("demo-")) {
    throw new Error(
      "Firebase emulator mode requires a demo-* project ID to prevent live-service access."
    );
  }

  return {
    enabled: true,
    host: "127.0.0.1",
    authPort: 9099,
    firestorePort: 8085,
    storagePort: 9199,
  };
}
