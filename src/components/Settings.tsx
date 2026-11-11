"use client";
import { useState } from "react";
import { api, errorText, THEMES, type Theme } from "@/lib/client";
import { Group, Row, Sheet } from "./ui";

export function SettingsSheet({ theme, onTheme, onClose }: {
  theme: Theme; onTheme: (t: Theme) => void; onClose: () => void;
}) {
  // The Google Sheet is a copy now (Nov 11): the app keeps its data itself, and this writes it all over the Sheet.
  const [copy, setCopy] = useState<"idle" | "busy" | "done" | string>("idle");
  async function copyToSheet() {
    setCopy("busy");
    try { await api.exportSheet(); setCopy("done"); } catch (e) { setCopy(errorText(e)); }
  }
  const status = copy === "busy" ? "Copying…" : copy === "done" ? "Copied" : copy === "idle" ? undefined : "Didn't go through";
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
          <Row icon="external" title="Copy to Google Sheet" value={status} onClick={copy === "busy" ? undefined : copyToSheet} />
          {copy !== "idle" && copy !== "busy" && copy !== "done" && <Row title={<span className="t-sub text-muted">{copy}</span>} />}
        </Group>
      </div>
    </Sheet>
  );
}
