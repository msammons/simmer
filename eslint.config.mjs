import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Saved Safeway pages for working on the helper (untracked, about 83 MB).
    "safeway/**",
    // Agent worktrees: copies of the repo kept by local tools.
    ".claude/**",
  ]),
]);

export default eslintConfig;
