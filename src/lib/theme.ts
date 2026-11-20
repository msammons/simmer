"use client";
// Themes (defined in globals.css) and switching between them.

/** Simmer's own looks (Simmer, tomato, is the default and matches the icon), then plain iOS accent colors. swatch is CSS for the picker. */
export const THEMES = [
  { id: "simmer", label: "Simmer", swatch: "linear-gradient(160deg, #EE6A45, #D9512F 55%, #B5381F)" },
  { id: "apricot", label: "Apricot", swatch: "linear-gradient(160deg, #F6B25C, #E8803F 55%, #C9532C)" },
  { id: "blue", label: "Blue", swatch: "#007AFF" },
  { id: "indigo", label: "Indigo", swatch: "#5856D6" },
  { id: "pink", label: "Pink", swatch: "#FF2D55" },
  { id: "orange", label: "Orange", swatch: "#FF9500" },
  { id: "teal", label: "Teal", swatch: "#30B0C7" },
  { id: "green", label: "Green", swatch: "#34C759" },
] as const;
export type Theme = (typeof THEMES)[number]["id"];

/**
 * Switches the page's theme (its accent color). layout.tsx sets the saved one before the first paint. The browser bar's
 * light and dark colors stay as layout.tsx gives them (Nov 19: writing the current background into both froze the bar
 * in whichever mode the app opened in, so it didn't follow the phone switching).
 */
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
}
