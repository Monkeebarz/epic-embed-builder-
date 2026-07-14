import { useCallback, useEffect, useState } from "react";

/**
 * Simple password-gate admin auth (no OAuth). Talks to /api/admin/* endpoints.
 */
export function useAdminAuth() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null); // null = loading

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/me", { credentials: "include" });
      const body = (await res.json()) as { ok: boolean };
      setIsAdmin(body.ok);
    } catch {
      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const login = useCallback(async (password: string): Promise<boolean> => {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password }),
    });
    const ok = res.ok;
    setIsAdmin(ok);
    return ok;
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setIsAdmin(false);
  }, []);

  return { isAdmin, loading: isAdmin === null, login, logout, refresh: check };
}
