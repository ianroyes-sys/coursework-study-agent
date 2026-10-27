import { spawn } from "node:child_process";

/**
 * "Prepare next" starts whatever agent you point `COURSEWORK_PREP_COMMAND` at — for example
 * `claude -p "$(cat agent/coursework-prep.md)"`. The agent works only through
 * `scripts/coursework-prep.mjs`, which enforces the prep policy. With no command configured
 * the button reports that instead of pretending something ran.
 */
let running = false;

export function runnable(): { ok: boolean; why?: string } {
  if (!process.env.COURSEWORK_PREP_COMMAND) return { ok: false, why: "COURSEWORK_PREP_COMMAND is not set" };
  if (running) return { ok: false, why: "a preparation run is already in progress" };
  return { ok: true };
}

export function startRun() {
  const command = process.env.COURSEWORK_PREP_COMMAND;
  if (!command || running) return;
  running = true;
  const child = spawn(command, { shell: true, cwd: process.cwd(), stdio: "ignore", detached: true });
  child.on("exit", () => { running = false; });
  child.on("error", () => { running = false; });
  child.unref();
}
