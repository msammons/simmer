// One line-icon set for the whole app (24px grid, round caps), drawn in the current text color. No emoji anywhere.
const PATHS = {
  pot: "M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z M2 11.5h2 M20 11.5h2 M3.5 10h17 M10.5 7.5h3 M9 5c-.8-1 .8-1.5 0-2.5 M15 5c-.8-1 .8-1.5 0-2.5",
  list: "M9 6h11 M9 12h11 M9 18h11 M4 6l1 1 2-2 M4 12l1 1 2-2 M4 18l1 1 2-2",
  book: "M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z",
  calendarPlus: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4 M12 13v5 M9.5 15.5h5",
  home: "M3 11l9-7 9 7 M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  sliders: "M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 4.5v5 M9 14.5v5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4",
  right: "M9 5l7 7-7 7",
  left: "M15 5l-7 7 7 7",
  down: "M6 9l6 6 6-6",
  check: "M5 12.5l4.5 4.5L19 7",
  close: "M6 6l12 12 M18 6L6 18",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
  external: "M7 17L17 7 M8.5 7H17v8.5",
  camera: "M4 8h3l1.5-2h7L17 8h3v11H4z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  bag: "M5 8h14l-1.2 12H6.2z M9 8V6.5a3 3 0 0 1 6 0V8",
  cart: "M3 4h2.5l2.2 11h10.6L20.5 7H7 M9.5 20a1 1 0 1 0 0-.01 M17 20a1 1 0 1 0 0-.01",
  link: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1 M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1",
  pencil: "M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4",
  refresh: "M4 12a8 8 0 1 0 2.4-5.7 M4 4v5h5",
  card: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M7 15h3",
  // Face ID (Settings → Ordering, Nov 12): the corners of the frame and a face.
  face: "M8 3H5a2 2 0 0 0-2 2v3 M16 3h3a2 2 0 0 1 2 2v3 M8 21H5a2 2 0 0 1-2-2v-3 M16 21h3a2 2 0 0 0 2-2v-3 M9 9v1.5 M15 9v1.5 M12.5 9v4h-1 M9 16c1.7 1.3 4.3 1.3 6 0",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5", strokeWidth = 1.7 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden>
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
