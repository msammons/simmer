"use client";
import { useEffect, useState } from "react";
import { api, errorText } from "@/lib/client";
import { Alert, Button, Group, Row } from "./ui";

const FIELD = "w-full rounded-2xl bg-card px-4 py-3 text-base outline-none ring-accent focus:ring-2";
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/**
 * Settings → Safeway sign-in (Sam, Nov 24: "i want the email to be set in settings"): the Google account Simmer signs in
 * to Safeway with when Safeway signs out (docs/CHECKOUT.md). Tapping the row opens the field in place; saving shows the
 * new account at once and saves behind it. Empty turns signing in off.
 */
export function SafewaySignInSettings() {
  const [account, setAccount] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const c = new AbortController();
    api.safewaySignIn(c.signal).then((r) => setAccount(r.account), (e) => { if (!c.signal.aborted) setProblem(errorText(e)); });
    return () => c.abort();
  }, []);

  function open() { setText(account ?? ""); setEditing(true); }
  function save() {
    const before = account, next = text.trim().toLowerCase();
    setAccount(next);
    setEditing(false);
    api.setSafewaySignIn(next).then((r) => setAccount(r.account), (e) => { setAccount(before); setProblem(errorText(e)); });
  }

  const ok = text.trim() === "" || looksLikeEmail(text);
  return (
    <>
      {editing ? (
        <div className="space-y-5">
          <Group header="Google account" footer="When Safeway signs out, Simmer signs in again with this Google account. Leave it empty to sign in yourself.">
            <div className="space-y-3 p-3">
              <input className={FIELD} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={text} autoFocus onChange={(e) => setText(e.target.value)} aria-label="Google account" />
              <Button className="w-full" disabled={!ok} onClick={save}>Save</Button>
            </div>
          </Group>
          <Button variant="secondary" className="w-full" onClick={() => setEditing(false)}>Back</Button>
        </div>
      ) : (
        <Group header="Safeway sign-in">
          <Row icon="link" title="Google account" value={account === null ? "" : account || "Off"} accessory="chevron" onClick={account === null ? undefined : open} disabled={account === null} />
        </Group>
      )}
      <Alert open={Boolean(problem)} title="Safeway sign-in" message={problem} onClose={() => setProblem("")} />
    </>
  );
}
