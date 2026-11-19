"use client";
import { useState } from "react";
import { errorText } from "@/lib/client";
import { Alert, Brand, Button } from "./ui";

// The one passcode screen of every Morales app: the button waits for a passcode, and a wrong one is the shared alert.
export function PasscodeScreen({ error, onClearError, onDone }: { error: string | null; onClearError: () => void; onDone: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null); // onDone itself failed: said here, never left unhandled
  const shown = error ?? failed;
  return (
    <form
      className="flex min-h-[85dvh] flex-col justify-center gap-8"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!code.trim() || busy) return;
        setBusy(true);
        try { await onDone(code.trim()); } catch (err) { setFailed(errorText(err)); } finally { setBusy(false); }
      }}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <Brand size="md" />
      </div>
      <div className="space-y-3">
        <input
          autoFocus
          type="password"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Household passcode"
          aria-label="Household passcode"
          className="h-[52px] w-full rounded-full bg-card px-5 text-center text-base outline-none ring-accent focus:ring-2"
        />
        <Button type="submit" disabled={!code.trim() || busy} className="w-full">Get started</Button>
        <p className="text-center t-foot text-muted">You only need to do this once.</p>
      </div>
      <Alert open={Boolean(shown) && !busy} title={shown === "Wrong passcode." ? "That passcode didn't work" : "That didn't go through"} message={shown === "Wrong passcode." ? "Check it and try again." : shown ?? ""} onClose={() => { setFailed(null); onClearError(); }} />
    </form>
  );
}
