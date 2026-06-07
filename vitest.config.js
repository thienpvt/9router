import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Absolute dir path with forward slashes — Vite normalizes import specifiers to
// posix internally, so backslash paths (from fileURLToPath on Windows) would
// never match an alias. Keep everything forward-slashed.
const dir = (p) => fileURLToPath(new URL(p, import.meta.url)).replace(/\\/g, "/");
const ROOT = dir("./");

// Mirror jsconfig.json path aliases so unit tests resolve the same bare
// specifiers the Next.js bundler does (e.g. "open-sse/utils/...", "@/...").
export default defineConfig({
  resolve: {
    alias: [
      { find: /^open-sse\/(.*)$/, replacement: `${ROOT}open-sse/$1` },
      { find: /^open-sse$/, replacement: `${ROOT}open-sse/index.js` },
      { find: /^@\/(.*)$/, replacement: `${ROOT}src/$1` },
    ],
  },
  test: {
    include: ["tests/unit/**/*.test.js"],
  },
});
