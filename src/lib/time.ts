// Dates and times. Everything lives in the household's time zone.

export const TZ = "America/Los_Angeles";

export const todayIn = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: TZ });
/** YYYY-MM-DD plus n calendar days (adding 24 hours goes wrong on the nights the clocks change). */
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

