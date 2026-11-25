// The List's groups, kept in their own place (Sam, Nov 24: "If there are no items in a list group is the group deleted?
// That seems odd."). A group used to be only the group name on its things, so one whose things were all removed was
// gone. Now each group is a name in a section (the Groups tab), kept until Remove group, and these rules work out the
// groups after any change to the kept things. The same rules run on the phone (shown at once) and on the server.
import type { Section, Staple } from "./groceries";
import { norm } from "./words";

/** A group: its name as she wrote it, and the part of the list it sits in. */
export type Group = { section: Section; name: string };

const keyOf = (section: string, name: string) => `${section}|${norm(name)}`;
const tidy = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, 40);

/** The groups the kept things are in, each once per section. */
export function groupsIn(staples: Pick<Staple, "section" | "group">[]): Group[] {
  const out = new Map<string, Group>();
  for (const s of staples) { const name = tidy(s.group); if (name && !out.has(keyOf(s.section, name))) out.set(keyOf(s.section, name), { section: s.section, name }); }
  return [...out.values()];
}

/** Every group in these lists, each once per section (the first spelling wins), A to Z. */
export function union(...lists: Group[][]): Group[] {
  const out = new Map<string, Group>();
  for (const g of lists.flat()) { const name = tidy(g.name); if (name && !out.has(keyOf(g.section, name))) out.set(keyOf(g.section, name), { section: g.section, name }); }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.section.localeCompare(b.section));
}

/**
 * The groups to show: the ones kept, and any group a thing is in (so the groups in use before the Groups tab existed
 * show as they always did, with nothing to run by hand: the next change to the kept things writes them down).
 */
export const groupsOf = (kept: Group[] | undefined, staples: Pick<Staple, "section" | "group">[]): Group[] => union(kept ?? [], groupsIn(staples));

/**
 * The groups after the kept things change from `before` to `after`. A group stays when its last thing is removed,
 * ungrouped or put in another group (it goes only with Remove group). A group whose things all moved to another part
 * of the list goes with them, rather than leaving an empty copy behind.
 */
export function afterChange(kept: Group[] | undefined, before: Pick<Staple, "section" | "group">[], after: Pick<Staple, "section" | "group">[]): Group[] {
  const was = groupsIn(before), now = groupsIn(after);
  const nowKeys = new Set(now.map((g) => keyOf(g.section, g.name)));
  const wasKeys = new Set(was.map((g) => keyOf(g.section, g.name)));
  // Sections a group's things arrived in with this change.
  const arrived = new Set(now.filter((g) => !wasKeys.has(keyOf(g.section, g.name))).map((g) => norm(g.name)));
  const left = new Set(was.filter((g) => !nowKeys.has(keyOf(g.section, g.name)) && arrived.has(norm(g.name))).map((g) => keyOf(g.section, g.name)));
  return union(kept ?? [], was, now).filter((g) => !left.has(keyOf(g.section, g.name)));
}

/** A group renamed, or removed with `to` "": every section's copy of it (her things move with it, in groceries.ts). */
export function renamed(groups: Group[], from: string, to: string): Group[] {
  const name = tidy(to);
  return union(groups.flatMap((g) => (norm(g.name) !== norm(from) ? [g] : name ? [{ ...g, name }] : [])));
}

/** Each group's name once, A to Z (for the pickers, which don't care which part of the list it's in). */
export function namesOf(groups: Group[]): string[] {
  const out = new Map<string, string>();
  for (const g of groups) if (!out.has(norm(g.name))) out.set(norm(g.name), g.name);
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}

/** Where a group sits: the section of its first copy, if it has one. */
export const sectionOf = (groups: Group[], name: string): Section | undefined => groups.find((g) => norm(g.name) === norm(name))?.section;

/**
 * A kept thing put in a group ("" takes it out of one): it moves to the part of the list the group sits in (review, Nov
 * 24: a thing put in a group from another section split the group across two sections). A group that's new, or one
 * already in the thing's own section, leaves it where it is.
 */
export function putInGroup<S extends Pick<Staple, "item" | "section" | "group">>(staples: S[], kept: Group[] | undefined, item: string, group: string): S[] {
  const others = staples.filter((s) => norm(s.item) !== norm(item));
  const here = group ? groupsOf(kept, others).filter((g) => norm(g.name) === norm(group)) : [];
  return staples.map((s) => {
    if (norm(s.item) !== norm(item)) return s;
    const to = here.some((g) => g.section === s.section) ? s.section : here[0]?.section ?? s.section;
    return { ...s, group, section: to };
  });
}
