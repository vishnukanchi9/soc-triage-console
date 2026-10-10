import type { Role } from "../auth.js";

/**
 * Demo accounts, created by the seed. They exist so the three roles can be tried
 * out locally; they are not created when NODE_ENV is "production" unless
 * DEMO_PASSWORD is set explicitly.
 */
export const DEMO_USERS: { email: string; name: string; role: Role }[] = [
  { email: "admin@soc.test", name: "Avery Admin", role: "admin" },
  { email: "analyst@soc.test", name: "Noor Analyst", role: "analyst" },
  { email: "analyst2@soc.test", name: "Sam Analyst", role: "analyst" },
  { email: "viewer@soc.test", name: "Riley Viewer", role: "viewer" },
];

const LOCAL_DEMO_PASSWORD = "triage-demo-2026";

/** One shared password for the demo accounts; override it with DEMO_PASSWORD. */
export function demoPassword(): string {
  const fromEnv = process.env.DEMO_PASSWORD;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Set DEMO_PASSWORD to seed demo accounts in production.");
  }
  return LOCAL_DEMO_PASSWORD;
}

/** Whether the sign-in page may offer one-click demo accounts. Never in production. */
export function demoModeEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}
