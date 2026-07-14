import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { EPIC_LOGO_PATH } from "@shared/const";

export default function Login({ onLogin }: { onLogin: (password: string) => Promise<boolean> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    const ok = await onLogin(password);
    setBusy(false);
    if (!ok) toast.error("Invalid password. The Circle denies you entry.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] px-4">
      <div className="w-full max-w-sm">
        <div className="border border-[#d4af37]/50 rounded-lg bg-[#12121a] p-8 shadow-[0_0_40px_rgba(106,13,173,0.25)]">
          <div className="flex flex-col items-center mb-8">
            <img
              src={EPIC_LOGO_PATH}
              alt="EPIC Embed"
              className="w-32 h-auto rounded-lg border border-[#d4af37]/60 mb-4 shadow-[0_0_24px_rgba(106,13,173,0.5)]"
            />
            <h1 className="text-2xl font-bold text-[#d4af37] gold-glow tracking-widest text-center">
              E.P.I.C.
            </h1>
            <p className="text-sm text-[#d4af37]/60 mt-1 tracking-wide text-center">
              Embed Builder — Inner Circle Only
            </p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#d4af37]/50" />
              <Input
                type="password"
                placeholder="Speak the secret word..."
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="pl-9 bg-[#0a0a0f] border-[#d4af37]/40 text-[#d4af37] placeholder:text-[#d4af37]/30"
                autoFocus
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full epic-btn h-10 tracking-widest">
              {busy ? "VERIFYING..." : "ENTER THE CIRCLE"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
