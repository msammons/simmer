"use client";
import { THEMES, type Theme } from "@/lib/client";
import { Group, Row, Sheet } from "./ui";
import { OrderingSettings } from "./Ordering";
import { SafewaySignInSettings } from "./SafewaySignIn";

/**
 * Settings: the look, ordering, Safeway sign-in, and the release. The copy to the Google Sheet left Settings (Sam, Nov 17); the export
 * still runs from the server when asked (`/api/export`).
 */
export function SettingsSheet({ theme, onTheme, onClose }: {
  theme: Theme; onTheme: (t: Theme) => void; onClose: () => void;
}) {
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
        <SafewaySignInSettings />
        {/* The release, as YY.M.D (Nov 11: the last line of Settings in every Morales app). */}
        <p className="px-4 text-center t-foot text-muted">{process.env.NEXT_PUBLIC_VERSION}</p>
      </div>
    </Sheet>
  );
}
