/** Someone in the household, from the Profile tab: who they are and what to keep in mind for them. */
export type Person = { key: string; name: string; role: string; isAdult: boolean; likes: string[]; dislikes: string[]; allergies: string[]; notes: string[]; rules: string[] };
export type Profile = { household: string[]; people: Person[] };
/** A Sheet row that was skipped, and why, so the Sheet can be fixed. */
export type IgnoredRow = { tab: string; row: number; name: string; why: string[] };
