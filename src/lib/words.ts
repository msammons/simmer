// Text helpers shared by the server and the phone (nothing here touches the server's files or services).

/** The words for an item, the same however it's typed ("Lemons", "lemon"), for matching and merging. */
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/(?<=[a-z]{2})ies$/, "y").replace(/(?<=[a-z]{2}(?:ss|x|z|ch|sh|o))es$/, "").replace(/(?<=[a-z]{2}[^s])s$/, "");
