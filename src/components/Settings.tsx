"use client";
import { THEMES, type Person, type Theme } from "@/lib/client";
import { Group, Row, Sheet } from "./ui";

export function SettingsSheet({ theme, onTheme, onClose, people = [], me = "", onMe }: { theme: Theme; onTheme: (t: Theme) => void; onClose: () => void; people?: Person[]; me?: string; onMe?: (name: string) => void }) {
  return (
    <Sheet label="Settings" title="Settings" onClose={onClose}>
      <div className="space-y-5 pb-2">
        {onMe && people.some((p) => p.isAdult) && (
          <Group header="Who's using this?" footer="So the list shows who added what.">
            {people.filter((p) => p.isAdult).map((p) => (
              <Row key={p.key} role="radio" checked={me === p.name} onClick={() => onMe(p.name)} title={p.name} accessory="check" />
            ))}
          </Group>
        )}
        <Group header="Look" footer="Light or dark follows your settings.">
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
