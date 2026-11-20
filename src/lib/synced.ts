"use client";
// Shared data the phone shows (the list, the plan, the recipes, the freezer), kept in step with the server.
// Every change shows at once and is saved behind it (Nov 11: always responsive), one at a time and in order, so two
// never cross and a later answer never undoes an earlier tap. No timers (Nov 11): reads happen on open, on coming back,
// and after changes. The app's own stores, and the hooks screens read them with, are in stores.ts.

/** A read's answer when the server's copy is still the one this phone has (a 304: nothing changed). */
export const UNCHANGED: unique symbol = Symbol("unchanged");
export type Unchanged = typeof UNCHANGED;

export type SyncedOptions<T> = {
  /**
   * The server's copy as it is now, or UNCHANGED when it's still the copy named by `etag` (the ETag of the copy this
   * phone has; null when it has none).
   */
  read: (etag: string | null) => Promise<T | Unchanged>;
  /** Keeps the server's latest copy (and its ETag) on this phone, for opening offline. */
  keep?: (v: T, etag: string | null) => void;
  /** The ETag an answer came with (Nov 19: "nothing changed" answers), if any. */
  etagOf?: (v: T) => string | null | undefined;
  /** A change didn't go through: said once the changes on their way are done, then the newest copy is read. */
  failed: (e: unknown) => void;
  /** A read didn't come back; `showing`: something (last time's copy or fresh) is on screen anyway. */
  readFailed?: (e: unknown, showing: boolean) => void;
};

/** A change waiting for its answer, and how it shows on screen until then. */
type Pending<T> = { show?: (v: T) => T };

/**
 * One kind of shared data. What shows is the server's last answer with every change still on its way laid over it, so
 * an earlier change's answer never takes a later tap off the screen, and a change that fails simply drops out. A read
 * that started before a change (or answers while one is on its way) is older than what's showing, so it's dropped.
 */
export class Synced<T> {
  private base: T | null;
  /** The ETag of `base`, the server's copy this phone has: sent with reads, so an unchanged one answers with no body. */
  private etag: string | null;
  private shown: T | null;
  private pending: Pending<T>[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private changes = 0; // counts up as each change is made and answered
  private reads = 0;
  private readApplied = 0;
  private problem: { e: unknown } | null = null;
  private reading: Promise<void> | null = null;
  private readAt = -Infinity;
  /** A read was dropped because changes were on their way: read again once they're done (Nov 19, review). */
  private stale = false;
  private listeners = new Set<() => void>();

  constructor(initial: T | null, private o: SyncedOptions<T>, etag: string | null = null) {
    this.base = this.shown = initial;
    this.etag = initial === null ? null : etag;
  }

  /** The server's copy and its ETag, kept together. */
  private take(v: T) {
    this.base = v;
    this.etag = this.o.etagOf?.(v) ?? null;
    this.o.keep?.(v, this.etag);
  }

  /** For useSyncExternalStore: the same value until something changes. */
  get = () => this.shown;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  /** Changes are on their way. */
  get busy() { return this.pending.length > 0; }

  private paint() {
    const base = this.base;
    this.shown = base === null ? null : this.pending.reduce<T>((v, p) => (p.show ? p.show(v) : v), base);
    this.listeners.forEach((fn) => fn());
  }

  /**
   * A change: `show` lays it over the screen at once; `send` saves it, after the changes before it, and answers with the
   * server's copy. Resolves once answered: `undefined` when it went through, `{ error }` when it didn't.
   */
  change(send: () => Promise<T>, show?: (v: T) => T): Promise<{ error: unknown } | undefined> {
    const p: Pending<T> = { show };
    this.pending.push(p);
    this.changes++;
    this.paint();
    const run = this.tail.then(async () => {
      let out: { error: unknown } | undefined;
      try {
        this.take(await send());
      } catch (e) {
        out = { error: e };
        this.problem = { e };
      }
      this.changes++;
      this.pending.splice(this.pending.indexOf(p), 1);
      this.paint();
      if (!this.pending.length && this.problem) {
        const { e } = this.problem;
        this.problem = null;
        this.stale = false;
        this.o.failed(e);
        void this.refresh();
      } else if (!this.pending.length && this.stale) {
        this.stale = false;
        void this.refresh();
      }
      return out;
    });
    this.tail = run;
    return run;
  }

  /** Reads the server's copy now. */
  refresh(): Promise<void> {
    const at = this.changes, mine = ++this.reads;
    const p = this.o.read(this.base === null ? null : this.etag).then((v) => {
      if (this.pending.length) { this.stale = true; return; }
      if (at !== this.changes || mine < this.readApplied) return;
      this.readApplied = mine;
      // Nothing changed since the copy showing (asked for when nothing has changed here since the read began): no repaint.
      if (v === UNCHANGED) return;
      this.take(v);
      this.paint();
    }, (e) => this.o.readFailed?.(e, this.base !== null)).finally(() => {
      this.readAt = Date.now();
      if (this.reading === p) this.reading = null;
    });
    this.reading = p;
    return p;
  }

  /**
   * On opening a screen or coming back to the app: a read already on its way, or one that answered within `ms`, is
   * enough (Nov 11: tab visits and coming back asked for the same thing over and over). Changes read directly.
   */
  settled(ms: number): Promise<void> {
    if (this.reading) return this.reading;
    if (Date.now() - this.readAt < ms) return Promise.resolve();
    return this.refresh();
  }
}
