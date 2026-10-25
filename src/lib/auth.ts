import { timingSafeEqual } from "node:crypto";

/** Household passcode check. Every API route except the calendar file requires it. */
export function authorized(req: Request): boolean {
  const expected = process.env.HOUSEHOLD_PASSCODE;
  if (!expected) return false; // fail closed: no passcode configured, no access
  const given = req.headers.get("x-passcode") ?? "";
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const unauthorized = () => Response.json({ error: "Wrong passcode." }, { status: 401 });
