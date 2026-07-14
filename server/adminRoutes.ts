/**
 * Simple password-gated admin auth endpoints (no OAuth).
 */
import type { Express, Request, Response } from "express";
import {
  checkAdminPassword,
  createAdminToken,
  verifyAdminToken,
  getAdminCookie,
  setAdminCookie,
  clearAdminCookie,
} from "./adminAuth";

export function registerAdminRoutes(app: Express) {
  app.post("/api/admin/login", async (req: Request, res: Response) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!checkAdminPassword(password)) {
      return res.status(401).json({ ok: false, error: "Invalid password" });
    }
    const token = await createAdminToken();
    setAdminCookie(res, token);
    return res.json({ ok: true });
  });

  app.post("/api/admin/logout", (req: Request, res: Response) => {
    clearAdminCookie(res);
    return res.json({ ok: true });
  });

  app.get("/api/admin/me", async (req: Request, res: Response) => {
    const ok = await verifyAdminToken(getAdminCookie(req));
    return res.json({ ok });
  });
}
