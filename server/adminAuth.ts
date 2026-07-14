import { SignJWT, jwtVerify } from "jose";
import type { Request, Response } from "express";

const ADMIN_COOKIE = "epic_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function secretKey() {
  const secret = process.env.JWT_SECRET ?? "epic-fallback-secret";
  return new TextEncoder().encode(secret);
}

export function checkAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  return expected.length > 0 && password === expected;
}

export async function createAdminToken(): Promise<string> {
  const exp = Math.floor((Date.now() + SESSION_TTL_MS) / 1000);
  return new SignJWT({ scope: "epic-admin" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(exp)
    .sign(secretKey());
}

export async function verifyAdminToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload.scope === "epic-admin";
  } catch {
    return false;
  }
}

export function getAdminCookie(req: Request): string | undefined {
  const header = req.headers.cookie ?? "";
  const match = header
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${ADMIN_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(ADMIN_COOKIE.length + 1)) : undefined;
}

export function setAdminCookie(res: Response, token: string) {
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearAdminCookie(res: Response) {
  res.clearCookie(ADMIN_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: -1,
  });
}

export { ADMIN_COOKIE };
