// Simmer's data layer (Nov 19). Tabs of rows, kept in Redis or in memory (client.ts), changed in transactions (tabs.ts),
// read and written by domain code as typed records (table.ts).
export { allTabs, atomically, readTab, readTabs, redis, resetTabs, store, tabVersions, transact, transactAt, useTabStore, writeTab } from "./client";
export { NS, inTransaction, memo, outside, type TabStore } from "./tabs";
export { append, change, load, loadAll, save, strings, table, type Table } from "./table";
