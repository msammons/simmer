// One line-icon set for the whole app (24px grid, round caps), drawn in the current text color. No emoji anywhere.
const PATHS = {
  pot: "M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z M2 11.5h2 M20 11.5h2 M3.5 10h17 M10.5 7.5h3 M9 5c-.8-1 .8-1.5 0-2.5 M15 5c-.8-1 .8-1.5 0-2.5",
  list: "M9 6h11 M9 12h11 M9 18h11 M4 6l1 1 2-2 M4 12l1 1 2-2 M4 18l1 1 2-2",
  book: "M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z",
  heart: "M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18 14c2 .6 3.5 2.6 3.5 6",
  calendar: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
  calendarPlus: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4 M12 13v5 M9.5 15.5h5",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  home: "M3 11l9-7 9 7 M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5",
  sliders: "M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 4.5v5 M9 14.5v5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4",
  right: "M9 5l7 7-7 7",
  left: "M15 5l-7 7 7 7",
  down: "M6 9l6 6 6-6",
  check: "M5 12.5l4.5 4.5L19 7",
  close: "M6 6l12 12 M18 6L6 18",
  share: "M12 3v12 M7 8l5-5 5 5 M5 13v7h14v-7",
  food: "M7 3v8 M5 3v5a2 2 0 0 0 4 0V3 M7 11v10 M17 21V3c-2 1-3.5 4-3.5 8H17",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01",
  external: "M7 17L17 7 M8.5 7H17v8.5",
  more: "M6.5 12h.01 M12 12h.01 M17.5 12h.01",
  trash: "M4 7h16 M9.5 7V4.5h5V7 M6 7l1 13h10l1-13 M10 11v5.5 M14 11v5.5",
  plus: "M12 5v14 M5 12h14",
  link: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1 M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1",
  pencil: "M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4",
  refresh: "M4 12a8 8 0 1 0 2.4-5.7 M4 4v5h5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5", strokeWidth = 1.7 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden>
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3.4 : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
