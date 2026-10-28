// Turns raw Sheet/CSV rows into typed data. Bad rows are skipped and reported, never fatal.
// Columns are matched by header name, so they can be reordered or extended freely.
import type { IgnoredRow, Person, Profile } from "./types";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function records(rows: string[][]) {
  const headers = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r, i) => ({
    rowNumber: i + 2,
    get: (k: string) => (r[headers.indexOf(k)] ?? "").trim(),
    has: (k: string) => headers.includes(k),
  }));
}

const PERSON_TYPES = { role: "role", like: "likes", dislike: "dislikes", allergy: "allergies", note: "notes", rule: "rules" } as const;

/**
 * The Profile tab: who / type / value rows. "household" rows with type "rule" apply to everyone; a person's rows say
 * their role ("Adult", "Child, 7"), and what they like, dislike, can't eat (allergy), or anything else (note).
 */
export function parseProfile(rows: string[][]): { profile: Profile; ignored: IgnoredRow[] } {
  const ignored: IgnoredRow[] = [];
  const profile: Profile = { household: [], people: [] };
  const byKey = new Map<string, Person>();
  for (const r of records(rows)) {
    const who = r.get("who"), type = r.get("type").toLowerCase(), value = r.get("value");
    const bad = (why: string) => ignored.push({ tab: "Profile", row: r.rowNumber, name: who || "(blank)", why: [why] });
    if (!who || !type) { bad("missing who or type"); continue; }
    if (who.toLowerCase() === "household") {
      if (type === "rule" && value) profile.household.push(value);
      else bad(`household rows need type "rule" and a value`);
      continue;
    }
    const key = who.toLowerCase();
    const person = byKey.get(key) ?? { key, name: who, role: "", isAdult: false, likes: [], dislikes: [], allergies: [], notes: [], rules: [] };
    byKey.set(key, person);
    if (!value) { bad("missing value"); continue; }
    const field = PERSON_TYPES[type as keyof typeof PERSON_TYPES];
    if (!field) { bad(`unknown type "${type}" (use ${Object.keys(PERSON_TYPES).join(", ")})`); continue; }
    if (field === "role") { person.role = value; person.isAdult = /^adult/i.test(value); }
    else person[field].push(value);
  }
  for (const p of byKey.values()) {
    if (!p.role) ignored.push({ tab: "Profile", row: 0, name: p.name, why: ["no role row, so this person is left out"] });
    else profile.people.push(p);
  }
  return { profile, ignored };
}
