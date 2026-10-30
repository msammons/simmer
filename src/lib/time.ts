// Dates and times. Everything lives in the household's time zone.

export const TZ = "America/Los_Angeles";

export const todayIn = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: TZ });
/** YYYY-MM-DD plus n calendar days (adding 24 hours goes wrong on the nights the clocks change). */
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** A Date for wall-clock HH:MM on YYYY-MM-DD in TZ. */
export function zoned(date: string, hhmm: string): Date {
  const probe = new Date(`${date}T12:00:00Z`);
  const off =
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
      .formatToParts(probe)
      .find((p) => p.type === "timeZoneName")!
      .value.replace("GMT", "") || "+00:00";
  return new Date(`${date}T${hhmm}:00${off}`);
}
