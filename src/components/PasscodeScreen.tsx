"use client";
import { useState } from "react";
import { Brand, Button, Notice } from "./ui";

export function PasscodeScreen({ error, onDone }: { error: string | null; onDone: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex min-h-[85dvh] flex-col justify-center gap-8"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!code.trim() || busy) return;
        setBusy(true);
        await onDone(code.trim()).finally(() => setBusy(false));
      }}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <Brand size="md" />
        <p className="t-body text-muted">Family meals, planned with care.</p>
      </div>
      <div className="space-y-3">
        {error && !busy && <Notice>{error === "Wrong passcode." ? "That passcode didn't work. Try again." : error}</Notice>}
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
        <Button type="submit" disabled={!code.trim() || busy} className="w-full">{busy ? "Checking…" : "Get started"}</Button>
        <p className="text-center t-foot text-muted">You only need to do this once.</p>
      </div>
    </form>
  );
}
