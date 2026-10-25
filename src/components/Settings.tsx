"use client";
import { THEMES, type Theme } from "@/lib/client";
import { Group, Row, Sheet } from "./ui";

export function SettingsSheet({ theme, onTheme, onClose }: { theme: Theme; onTheme: (t: Theme) => void; onClose: () => void }) {
  return (
    <Sheet label="Settings" title="Settings" onClose={onClose}>
      <div className="pb-2">
        <Group header="Look" footer="Light or dark follows your iPhone. Simmer & Sage is Simmer by day and Sage by night.">
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
      </div>
    </Sheet>
  );
}
