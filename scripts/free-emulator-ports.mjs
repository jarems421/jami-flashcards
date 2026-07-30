#!/usr/bin/env node
/**
 * Frees the Firebase emulator ports before a suite starts.
 *
 * `firebase emulators:exec` occasionally leaves its Java child listening after
 * the script it wrapped has exited — reliably so on Windows, where the Firestore
 * emulator logs a shutdown NullPointerException and the process survives. The
 * next suite then dies with "Could not start Firestore Emulator, port taken".
 *
 * Only processes actually listening on a port declared in firebase.json are
 * terminated, so this cannot touch an unrelated dev server.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(repoRoot, "firebase.json"), "utf8"));
const ports = Object.values(config.emulators ?? {})
  .map((entry) => (typeof entry === "object" ? entry?.port : null))
  .filter((port) => typeof port === "number");

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: "pipe" });
  } catch {
    return "";
  }
}

/** PIDs listening on `port`, excluding this process. */
function listenersOn(port) {
  const pids = new Set();
  if (process.platform === "win32") {
    for (const line of run("netstat", ["-ano", "-p", "TCP"]).split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5 || parts[3] !== "LISTENING") continue;
      if (!parts[1].endsWith(`:${port}`)) continue;
      pids.add(parts[4]);
    }
  } else {
    for (const pid of run("lsof", [`-ti`, `tcp:${port}`, "-sTCP:LISTEN"]).split(
      /\s+/
    )) {
      if (pid) pids.add(pid);
    }
  }
  pids.delete(String(process.pid));
  return [...pids];
}

let freed = 0;
for (const port of ports) {
  for (const pid of listenersOn(port)) {
    if (process.platform === "win32") {
      run("taskkill", ["/PID", pid, "/F", "/T"]);
    } else {
      run("kill", ["-9", pid]);
    }
    freed += 1;
    console.log(`Freed emulator port ${port} (pid ${pid}).`);
  }
}

if (freed === 0) {
  console.log(`Emulator ports already free: ${ports.join(", ")}.`);
}
