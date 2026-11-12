"use client";
import { useState } from "react";
import { api, errorText, THEMES, type Theme } from "@/lib/client";
import { Alert, Group, Row, Sheet } from "./ui";

export function SettingsSheet({ theme, onTheme, onClose }: {
  theme: Theme; onTheme: (t: Theme) => void; onClose: () => void;
}) {
  // The Google Sheet is a copy now (Nov 11): the app keeps its data itself, and this writes it all over the Sheet. No
  // "Copying…" (Nov 11): the row rests while it copies, then says Copied; a problem shows as the alert.
  const [copy, setCopy] = useState<"idle" | "busy" | "done">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  async function copyToSheet() {
    setCopy("busy");
    try { await api.exportSheet(); setCopy("done"); } catch (e) { setCopy("idle"); setProblem(errorText(e)); }
  }
  return (
    <Sheet label="Settings" title="Settings" onClose={onClose}>
      <div className="space-y-5 pb-2">
        <Group header="Look">
          {THEMES.map((t) => (
            <Row
              key={t.id}
              role="radio"
              checked={theme === t.id}
              onClick={() => onTheme(t.id)}
              title={t.label}
              accessory="check"
              lead={<span className="block size-7 rounded-full" style={{ background: t.swatch }} aria-hidden />}
            />
          ))}
        </Group>
        <Group header="Data">
          <Row icon="external" title="Copy to Google Sheet" value={copy === "done" ? "Copied" : undefined} onClick={copy === "busy" ? undefined : copyToSheet} />
        </Group>
        {/* The release, as YY.M.D (Nov 11: the last line of Settings in every Morales app). */}
        <p className="px-4 text-center t-foot text-muted">{process.env.NEXT_PUBLIC_VERSION}</p>
      </div>
      <Alert open={Boolean(problem)} title="That didn't go through" message={problem ?? ""} onClose={() => setProblem(null)} />
    </Sheet>
  );
}
