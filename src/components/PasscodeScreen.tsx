"use client";
import { useState } from "react";
import { Brand, Button, Notice } from "./ui";

export function PasscodeScreen({ error, onDone }: { error: string | null; onDone: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  return (
    <form
      className="flex min-h-[85dvh] flex-col justify-center gap-8"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        // Nothing typed (Nov 3): say so, instead of a button that does nothing.
        if (!code.trim()) { setEmpty(true); return; }
        setEmpty(false);
        setBusy(true);
        await onDone(code.trim()).finally(() => setBusy(false));
      }}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <Brand size="md" />
      </div>
      <div className="space-y-3">
        {empty && !code.trim() && <Notice>Type the passcode first</Notice>}
        {error && !busy && !empty && <Notice>{error === "Wrong passcode." ? "That passcode didn't work. Try again." : error}</Notice>}
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
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Checking…" : "Get started"}</Button>
        <p className="text-center t-foot text-muted">You only need to do this once.</p>
      </div>
    </form>
  );
}
