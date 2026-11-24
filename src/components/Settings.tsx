"use client";
import { THEMES, type Theme } from "@/lib/client";
import { Group, Row, Sheet } from "./ui";
import { OrderingSettings } from "./Ordering";
import { SafewaySignInSettings } from "./SafewaySignIn";

/**
 * Settings: how to send feedback, ordering, Safeway sign-in, the look, and the release. The copy to the Google Sheet left Settings (Sam, Nov 17); the export
 * still runs from the server when asked (`/api/export`).
 */
export function SettingsSheet({ theme, onTheme, onClose }: {
  theme: Theme; onTheme: (t: Theme) => void; onClose: () => void;
}) {
  return (
    <Sheet label="Settings" title="Settings" onClose={onClose}>
      <div className="space-y-5 pb-2">
        {/* How Feedback is opened (Sam, Nov 24): a plain line, the same whatever the state. */}
        <p className="px-4 t-sub text-muted">Hold the Settings button on any screen to send feedback.</p>
        <OrderingSettings />
        <SafewaySignInSettings />
        {/* The look, last (Sam, Nov 24): one row, the theme picked from the phone's own list. */}
        <Group header="Look">
          <ThemeRow theme={theme} onTheme={onTheme} />
        </Group>
        {/* The release, as YY.M.D (Nov 11: the last line of Settings in every Morales app). */}
        <p className="px-4 text-center t-foot text-muted">{process.env.NEXT_PUBLIC_VERSION}</p>
      </div>
    </Sheet>
  );
}

/** Theme: the one picked, by name, opening the phone's own list of them (as ⋯ menus do); a pick shows at once and is kept. */
function ThemeRow({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  const now = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  return (
    <label className="relative block active:bg-sunk">
      <Row title="Theme" value={now.label} accessory="chevron"
        lead={<span className="block size-7 rounded-full" style={{ background: now.swatch }} aria-hidden />} />
      <select value={now.id} aria-label="Theme" onChange={(e) => onTheme(e.target.value as Theme)}
        className="absolute inset-0 w-full cursor-pointer opacity-0 text-base">
        {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
    </label>
  );
}
