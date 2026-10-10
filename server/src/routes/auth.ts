import { Router } from "express";
import { z } from "zod";
import {
  SESSION_COOKIE,
  createSessionToken,
  requireAuth,
  setSessionCookie,
  verifyPassword,
  type Role,
} from "../auth.js";
import type { Db } from "../db/index.js";
import { HttpError } from "../errors.js";
import { DEMO_USERS, demoModeEnabled } from "../seed/demo-users.js";

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

// Simple in-memory throttle: 10 failed sign-ins per address per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();

function throttled(key: string): boolean {
  const entry = failures.get(key);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const entry = failures.get(key);
  if (!entry || entry.resetAt < Date.now()) failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else entry.count += 1;
}

export function authRoutes(db: Db): Router {
  const router = Router();

  router.post("/login", async (req, res) => {
    const { email, password } = loginBody.parse(req.body);
    const key = `${req.ip}:${email}`;
    if (throttled(key)) {
      throw new HttpError(429, "too_many_attempts", "Too many failed sign-ins. Try again in a few minutes.");
    }

    const [user] = await db.query<{ id: number; name: string; email: string; role: Role; password_hash: string }>(
      "SELECT id, name, email, role, password_hash FROM users WHERE email = $1",
      [email],
    );
    // Same response whether the email or the password is wrong.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      recordFailure(key);
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    failures.delete(key);

    const session = { id: user.id, name: user.name, email: user.email, role: user.role };
    setSessionCookie(res, await createSessionToken(session));
    res.json({ user: session });
  });

  // Demo mode (never in production): lists the seeded accounts and signs in as one
  // of them without a password, so each role can be tried with one click.
  router.get("/demo", (_req, res) => {
    res.json({ enabled: demoModeEnabled(), accounts: demoModeEnabled() ? DEMO_USERS : [] });
  });

  router.post("/demo", async (req, res) => {
    if (!demoModeEnabled()) throw new HttpError(404, "not_found", "No such endpoint.");
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    if (!DEMO_USERS.some((u) => u.email === email)) {
      throw new HttpError(400, "invalid_request", "Not a demo account.");
    }
    const [user] = await db.query<{ id: number; name: string; email: string; role: Role }>(
      "SELECT id, name, email, role FROM users WHERE email = $1",
      [email],
    );
    if (!user) throw new HttpError(404, "not_found", "Demo accounts have not been seeded.");
    setSessionCookie(res, await createSessionToken(user));
    res.json({ user });
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
