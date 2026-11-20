// Tabs as typed records (Nov 19). A tab is a header row and one row per record, columns found by header name in any
// order or capitalization (as on the Sheet). Each table says how a row reads as a record and what cells a record writes;
// domain code only ever sees records, never rows or row numbers. Writing keeps the stored format exactly: the tab's own
// headers (a column Simmer added since joins the end), an unchanged record's row as it was, a changed one's columns
// Simmer doesn't know kept, and rows that don't read as a record kept where they were.
import { records, rowIds } from "../parse";
import { readTab, readTabs, transact, writeTab } from "./client";

type Get = (k: string) => string;
export type Table<T> = {
  tab: string;
  /** Its columns, in order, for a new tab; any the tab lacks are added at its end. */
  headers: readonly string[];
  /** A row as a record, or null for one that doesn't read as one. `id`: the row's own, or one made by `idFrom`. */
  read(get: Get, id: string): T | null;
  /** What a record writes; a column left out (or undefined) keeps what the row had. */
  cells(x: T): Record<string, string | undefined>;
  /** What matches a record to its row when the tab is written. */
  key(x: T): string;
  /** For rows written without an id (by hand, long ago): what one is made from, the same on every read (parse.ts rowIds). */
  idFrom?: (get: Get) => string;
};
export const table = <T>(t: Table<T>): Table<T> => t;

/**
 * A table whose records are its cells as text, by header (for tabs whose rows code reads as they are: Planned, Made…).
 * Matched by id when it has one, else by its whole contents.
 */
export function strings<H extends string>(tab: string, headers: readonly H[], opts: { key?: (r: Record<H, string>) => string; idFrom?: (get: Get) => string } = {}): Table<Record<H, string>> & { row(r: Partial<Record<H, string>>): Record<H, string> } {
  const key = opts.key ?? (headers.includes("id" as H) ? (r: Record<H, string>) => r["id" as H] : (r: Record<H, string>) => JSON.stringify(r));
  return {
    tab, headers, key, idFrom: opts.idFrom,
    /** A new record: the cells given, the rest blank. */
    row: (r) => ({ ...(Object.fromEntries(headers.map((h) => [h, ""])) as Record<H, string>), ...r }),
    read: (get, id) => {
      const r = Object.fromEntries(headers.map((h) => [h, h === "id" ? id : get(h)])) as Record<H, string>;
      return headers.some((h) => r[h]) ? r : null;
    },
    cells: (r) => ({ ...r }),
  };
}

const lower = (row: string[]) => row.map((h) => h.trim().toLowerCase());

/** The tab's rows read: each record with its row's index, and the rows that don't read as one. */
function parse<T>(t: Table<T>, rows: string[][]) {
  const recs = records(rows);
  const ids = t.idFrom ? rowIds(recs, t.idFrom) : recs.map((r) => r.get("id"));
  const read: { x: T; at: number }[] = [], unread: number[] = [];
  recs.forEach((r, i) => {
    const at = r.rowNumber - 1;
    if (!rows[at].some((c) => c.trim())) return; // a blank row goes
    const x = t.read(r.get, ids[i]);
    if (x) read.push({ x, at }); else unread.push(at);
  });
  return { read, unread };
}

/** A tab's header row: its own, with the table's columns it lacks at the end. */
function headerRow(t: { headers: readonly string[] }, rows: string[][]) {
  if (!rows[0]) return [...t.headers];
  const own = lower(rows[0]);
  return [...rows[0], ...t.headers.filter((h) => !own.includes(h))];
}

const same = (a: Record<string, string | undefined>, b: Record<string, string | undefined>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => a[k] === b[k]);

/**
 * The rows for a tab holding `items`, in that order, given the rows it holds now (see the top of this file). A row that
 * doesn't read as a record stays just after the record it followed (at the top when none did; at the end when that
 * record is gone). A row without an id whose id was made up (`idFrom`) has it written in (Nov 19, review): made-up ids
 * count duplicates in order, so removing the first of two would otherwise hand the second's id to the first's.
 */
function rowsFor<T>(t: Table<T>, rows: string[][], items: T[]): string[][] {
  const head = headerRow(t, rows), headers = lower(head), idAt = t.idFrom ? headers.indexOf("id") : -1;
  const { read, unread } = parse(t, rows);
  const was = new Map<string, { x: T; at: number }[]>();
  for (const r of read) was.set(t.key(r.x), [...(was.get(t.key(r.x)) ?? []), r]);
  // Each unreadable row by the record row just above it (-1: none above).
  const after = new Map<number, number[]>();
  for (const at of unread) {
    const above = read.reduce((best, r) => (r.at < at && r.at > best ? r.at : best), -1);
    after.set(above, [...(after.get(above) ?? []), at]);
  }
  const placed = new Set<number>();
  const follow = (at: number) => (after.get(at) ?? []).map((u) => { placed.add(u); return rows[u]; });
  const out = items.flatMap((x) => {
    const c = t.cells(x), before = was.get(t.key(x))?.shift(); // the same key twice: their rows in order
    if (!before) return [headers.map((h) => c[h] ?? "")];
    const row = rows[before.at];
    let next: string[];
    if (same(c, t.cells(before.x))) next = row;
    else {
      // Cells past the header row (typed beside the table) are kept.
      const mapped = headers.map((h, i) => c[h] ?? row[i] ?? "");
      next = row.length > headers.length ? [...mapped, ...row.slice(headers.length)] : mapped;
    }
    const id = c.id;
    if (idAt >= 0 && id && !(next[idAt] ?? "").trim()) { next = [...next]; while (next.length <= idAt) next.push(""); next[idAt] = id; }
    return [next, ...follow(before.at)];
  });
  const top = follow(-1);
  return [head, ...top, ...out, ...unread.filter((at) => !placed.has(at)).map((at) => rows[at])];
}

/** A table's records. A failed read throws (read as empty, a change written after it would erase the tab). */
export async function load<T>(t: Table<T>): Promise<T[]> {
  return parse(t, await readTab(t.tab)).read.map((r) => r.x);
}

type Records<A extends Table<unknown>[]> = { [K in keyof A]: A[K] extends Table<infer T> ? T[] : never };
/** Several tables' records in one read. */
export async function loadAll<A extends Table<unknown>[]>(...ts: A): Promise<Records<A>> {
  const all = await readTabs(ts.map((t) => t.tab));
  return ts.map((t, i) => parse(t, all[i]).read.map((r) => r.x)) as Records<A>;
}

/** The table holds `items`, in that order (one write; see the top of this file). */
export function save<T>(t: Table<T>, items: T[]): Promise<void> {
  return transact(async () => writeTab(t.tab, rowsFor(t, await readTab(t.tab), items)));
}

/** The table's records changed by `f`, in one transaction (nothing is written when it answers the same array). */
export function change<T>(t: Table<T>, f: (all: T[]) => T[] | Promise<T[]>): Promise<T[]> {
  return transact(async () => {
    const all = await load(t), next = await f(all);
    if (next !== all) await save(t, next);
    return next;
  });
}

/** Records added at the end of the table (after its last row with anything in it). */
export function append<T>(t: Table<T>, items: T[]): Promise<void> {
  if (!items.length) return Promise.resolve();
  return transact(async () => {
    const rows = await readTab(t.tab);
    while (rows.length > 1 && !rows[rows.length - 1].some((c) => c.trim())) rows.pop();
    const head = headerRow(t, rows), headers = lower(head);
    await writeTab(t.tab, [head, ...rows.slice(1), ...items.map((x) => { const c = t.cells(x); return headers.map((h) => c[h] ?? ""); })]);
  });
}
