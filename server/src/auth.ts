import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { HttpError } from "./errors.js";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type Role = "viewer" | "analyst" | "admin";
export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
  }
}

export const SESSION_COOKIE = "soc_session";
const SESSION_HOURS = 8;

// ---- passwords -------------------------------------------------------------

/** scrypt with a random per-password salt, stored as `salt:hash` in hex. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

// ---- sessions --------------------------------------------------------------

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
    return new TextEncoder().encode("development-only-secret-do-not-use-in-production");
  }
  return new TextEncoder().encode(value);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ name: user.name, email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JavaScript, so an XSS bug cannot steal it
    sameSite: "lax", // not sent on cross-site POSTs, which blocks CSRF
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: "/",
  });
}

/** Attaches req.user when the request carries a valid session; never rejects. */
export async function loadSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
      req.user = {
        id: Number(payload.sub),
        name: String(payload.name),
        email: String(payload.email),
        role: payload.role as Role,
      };
    } catch {
      // expired or tampered token: treat as signed out
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  next();
}

/** Role guard. Roles are checked on the server for every request; the UI only hides buttons. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, "forbidden", "Your role does not allow this action.");
    }
    next();
  };
}
