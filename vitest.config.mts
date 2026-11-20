// Tests resolve "@/" as the app does (tsconfig.json paths), so route handlers can be tested as they are.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } } });
