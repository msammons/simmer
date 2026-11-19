"use client";
// Shared data the phone shows (the list, the plan, the recipes, the freezer), kept in step with the server.
// Every change shows at once and is saved behind it (Nov 11: always responsive), one at a time and in order, so two
// never cross and a later answer never undoes an earlier tap. No timers (Nov 11): reads happen on open, on coming back,
// and after changes.
import { useState, useSyncExternalStore } from "react";

export type SyncedOptions<T> = {
  /** The server's copy as it is now. */
  read: () => Promise<T>;
  /** Keeps the server's latest copy on this phone, for opening offline. */
  keep?: (v: T) => void;
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

  constructor(initial: T | null, private o: SyncedOptions<T>) {
    this.base = this.shown = initial;
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
        const v = await send();
        this.base = v;
        this.o.keep?.(v);
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
    const p = this.o.read().then((v) => {
      if (this.pending.length) { this.stale = true; return; }
      if (at !== this.changes || mine < this.readApplied) return;
      this.readApplied = mine;
      this.base = v;
      this.o.keep?.(v);
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

const none = () => null;
/** A Synced made once, and its value, re-rendering as it changes. The server renders nothing from it. */
export function useSynced<T>(make: () => Synced<T>): [T | null, Synced<T>] {
  const [s] = useState(make);
  return [useSyncExternalStore(s.subscribe, s.get, none), s];
}
