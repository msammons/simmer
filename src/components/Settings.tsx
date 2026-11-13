"use client";
import { useRef, useState } from "react";
import { api, errorText, THEMES, type Theme } from "@/lib/client";
import { Alert, Group, Row, Sheet } from "./ui";
import { OrderingSettings } from "./Ordering";

export function SettingsSheet({ theme, onTheme, onClose }: {
  theme: Theme; onTheme: (t: Theme) => void; onClose: () => void;
}) {
  // The Google Sheet is a copy now (Nov 11): the app keeps its data itself, and this writes it all over the Sheet. It says
  // Copied at once and copies behind it (Nov 11: always responsive, as in every Morales app); if that fails, the row goes
  // back and the alert says why.
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const copying = useRef(false);
  function copyToSheet() {
    if (copying.current) return;
    copying.current = true;
    setCopied(true);
    api.exportSheet().catch((e) => { setCopied(false); setProblem(errorText(e)); }).finally(() => { copying.current = false; });
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
        <OrderingSettings />
        <Group header="Data">
          <Row icon="external" title="Copy to Google Sheet" value={copied ? "Copied" : undefined} onClick={copyToSheet} />
        </Group>
        {/* The release, as YY.M.D (Nov 11: the last line of Settings in every Morales app). */}
        <p className="px-4 text-center t-foot text-muted">{process.env.NEXT_PUBLIC_VERSION}</p>
      </div>
      <Alert open={Boolean(problem)} title="That didn't go through" message={problem ?? ""} onClose={() => setProblem(null)} />
    </Sheet>
  );
}
