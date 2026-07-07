# Coding Conventions

**Analysis Date:** 2026-07-05

## Naming Patterns

**Files:**
- Multi-word single-concept files: camelCase — `src/lib/db/repos/apiKeysRepo.js`, `src/store/providerStore.js`, `open-sse/utils/debugLog.js`, `src/shared/utils/machineId.js`
- Executors / provider-specific integration files: kebab-case — `open-sse/executors/codebuddy-cn.js`, `grok-web.js`, `mimo-free.js`, `ollama-local.js`, `opencode-go.js`, `perplexity-web.js`, `xiaomi-tokenplan.js`
- Translator request/response files: kebab-case `<source>-to-<target>.js` — `open-sse/translator/request/openai-to-claude.js`, `open-sse/translator/response/kiro-to-openai.js`, `claude-to-openai.js`
- React components: PascalCase, `.js` extension (not `.jsx`) even though they contain JSX — `src/shared/components/Button.js`, `Avatar.js`, `Badge.js`, `CapacityBadges.js`
- Next.js route handlers: always `route.js` inside the route segment folder — `src/app/api/keys/route.js`, `src/app/api/providers/validate/route.js`
- Barrel/re-export files: always `index.js` (25 across `src/` and `open-sse/`) — `src/models/index.js`, `src/store/index.js`, `src/shared/hooks/index.js`
- Test files: `<subject>.test.js`; real-network smoke tests `<subject>.real.test.js`; end-to-end tests `<subject>.e2e.test.js`

**Functions:**
- camelCase throughout, verb-first for actions — `createApiKey`, `validateApiKey`, `refreshCodexToken`, `deleteProviderConnection`
- `get`/`build`/`resolve`/`normalize` prefixes for pure helpers — `getAdapter`, `buildEmbeddingsUrl`, `resolveTargetFormat`, `normalizeProviderId` (`src/lib/providerNormalization.js`)
- Row-mapping helpers in repo files named `rowTo<Thing>` — `rowToKey` in `src/lib/db/repos/apiKeysRepo.js`
- Boolean converters/predicates prefixed `is`/`has` — `isOpenAICompatibleProvider`, `isAnthropicCompatibleProvider`, `isCustomEmbeddingProvider` (`src/shared/constants/providers.js`)

**Variables:**
- camelCase; boolean flags read as predicates — `isValid`, `isOpenAiFormat`, `isDev`, `isDebugEnabled`, `isNoAuth`
- Module-level constants in SCREAMING_SNAKE_CASE — `EFFORT_LEVELS`, `LEVEL_TO_BUDGET` (`open-sse/translator/concerns/thinking.js`), `LOG_LEVELS` (`src/sse/utils/logger.js`), `RUN_REAL`, `MAX_TOKENS`, `TIMEOUT_MS` (test files)

**Types:**
- No TypeScript anywhere in the codebase — `jsconfig.json` provides path aliases only, no `tsconfig.json`, no type-checking step. No type/interface naming convention applies; shapes are documented informally via JSDoc comments or by example (e.g. `rowToKey()` return shape).

**Classes:**
- PascalCase, `<Provider>Executor` suffix for provider integrations extending `BaseExecutor` — `open-sse/executors/base.js` (`BaseExecutor`), `open-sse/executors/codex.js` (`CodexExecutor`), `open-sse/executors/antigravity.js` (`AntigravityExecutor`)

## Code Style

**Formatting:**
- No Prettier config in the repo (`.prettierrc*` does not exist) — formatting is convention-driven, not tool-enforced
- Double-quoted strings are the norm (verified: 548 files use `"..."` on their first `import` statement vs. 1 file using `'...'`) — treat single-quote style as a deviation to avoid introducing
- Semicolons used consistently as statement terminators

**Linting:**
- ESLint 9, flat config at `eslint.config.mjs`:
```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
```
- Extends `eslint-config-next/core-web-vitals` only — no project-specific custom rules layered on top. Run via `npx eslint .` (no dedicated `lint` script in root `package.json`).

## Import Organization

**Order (observed, not lint-enforced):**
1. External packages — `next/server`, `uuid`, `zustand`
2. Path-aliased internal imports — `@/lib/...`, `@/shared/...`, `@/models`, or bare `open-sse/...`
3. Relative imports — `../../open-sse/...`, `./formats.js`

Example, `src/app/api/providers/route.js`:
```js
import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  getProviderNodeById,
} from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";
```

**Path Aliases** (`jsconfig.json`):
- `@/*` → `src/*`
- `open-sse`, `open-sse/*` → `open-sse/` (a sibling package at the repo root, outside `src/`)

Inside `open-sse/` itself, files use deep relative imports (`../services/provider.js`, `../executors/antigravity.js`) rather than the `open-sse` alias, since that alias is resolved by Next.js/webpack (or the Vitest config alias) and doesn't apply within `open-sse/`'s own module graph — see `open-sse/translator/index.js`. Route handlers under `src/app/api/**/route.js` do use the bare `open-sse/...` specifier freely, e.g. `import { getDefaultModel } from "open-sse/config/providerModels.js";` in `src/app/api/providers/validate/route.js`.

## Error Handling

**Patterns:**
- Two distinct error-handling zones:
  1. **API routes** (`src/app/api/**/route.js`) — every handler wraps its body in `try/catch`, logs with `console.log("Error <action>:", error)`, and returns `NextResponse.json({ error: "<message>" }, { status: <code> })`. No custom Error classes; errors are plain `Error` objects read via `error.message`. Example, `src/app/api/keys/route.js`:
```js
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}
```
  2. **open-sse engine layer** (`open-sse/executors/*.js`, `open-sse/utils/*.js`) — throws plain `new Error("<descriptive message>")` for unrecoverable config/credential problems, letting the caller (ultimately an API route or the SSE handler) catch it. Examples: `open-sse/executors/vertex.js:78` (`"Vertex partner models require a project_id..."`), `open-sse/executors/cursor.js:164` (`"Machine ID is required for Cursor API"`), `open-sse/executors/mimo-free.js:94/99`.
- No custom Error subclasses exist anywhere in `src/` or `open-sse/` (verified via search for `class.*Error extends` — zero matches). Error differentiation is done by message-string matching or HTTP status code, never by error type/instanceof.
- Retry/fallback is config-driven, not exception-driven: `BaseExecutor.execute()` (`open-sse/executors/base.js`) reads a `retry: { <status>: { attempts, delayMs } }` map (backed by `open-sse/config/runtimeConfig.js`: `RETRY_CONFIG`, `DEFAULT_RETRY_CONFIG`, `resolveRetryEntry`) plus a `baseUrls` fallback array, so most transient upstream failures (502/429/etc.) are absorbed without throwing. See `tests/unit/base-executor-retry.test.js` for the full contract.
- User-facing error-message mapping is inlined per-case rather than centralized through a shared error-code table — e.g. `src/app/api/providers/validate/route.js` has ~15 provider-specific cases each computing its own `isValid`/`error` string (401/403 → "API key unauthorized", `ECONNREFUSED` → "Connection refused...", etc.). Follow this same inline-mapping style when adding a new provider rather than introducing a shared error-code enum.

## Logging

**Framework:** No external logging library. Two small hand-rolled loggers, plus raw `console.log` in most API routes.

**Patterns:**
- `src/sse/utils/logger.js` — leveled logger (`DEBUG`/`INFO`/`WARN`/`ERROR`, controlled by `LOG_LEVEL` env var), emoji-tagged output (🔍 debug, ℹ️ info, ⚠️ warn, ❌ error, 📥 request, 📤 response, 🌊 stream), plus a `maskKey(key)` helper that truncates secrets to `xxxx...xxxx` before logging. Never log a raw API key or token — always pass it through `maskKey()` first.
- `open-sse/utils/debugLog.js` — single `dbg(tag, msg)` function, active only when `NODE_ENV !== "production"`, output tagged `[DBG:tag]`.
- Dashboard/CRUD API routes mostly use bare `console.log("Error doing X:", error)` (see Error Handling) rather than either dedicated logger — the leveled loggers are reserved for the SSE/proxy hot path (`src/sse/`, `open-sse/`), not simple dashboard CRUD.

## Comments

**When to Comment:**
- Sparse and purposeful — explain *why*, not *what*. Example, `open-sse/translator/concerns/thinking.js`: `// Central source of truth for level↔budget maps (web-standard values).`
- File-header comments describe the concern a module owns (its single responsibility), not a changelog or author history.
- A subset of translator golden-test files are commented in Vietnamese — `tests/translator/golden-request.test.js`, `golden-response-stream.test.js` (e.g. `// Sau refactor chạy lại phải khớp y hệt.` — "must match exactly after refactor"). When editing those specific files, match the existing Vietnamese comments; use English for all new files elsewhere in the codebase.

**JSDoc/TSDoc:**
- Used sparingly and inconsistently — roughly 202 of 759 JS files under `src/`/`open-sse/` contain any `/** */` block. Applied mainly to exported service functions and class definitions, e.g. `open-sse/executors/base.js`:
```js
/**
 * BaseExecutor - Base class for provider executors
 */
export class BaseExecutor {
```
Not enforced by lint; most small helpers use a single `//` line instead of a full JSDoc block.

## Function Design

**Size:** Small, single-purpose functions are the norm — most functions in `open-sse/translator/concerns/*.js` and `src/lib/db/repos/*.js` are under 15 lines and do one transformation or one query.

**Parameters:** Plain positional parameters for 1-3 simple args — `createApiKey(name, machineId)`, `getApiKeyById(id)`. Object destructuring for larger or optional parameter sets — `execute({ model, body, stream, credentials })` on `BaseExecutor`.

**Return Values:** Repos and services return plain objects/arrays and use `null` for "not found" rather than throwing — `getApiKeyById` → `rowToKey(row)` returns `null` when `row` is falsy. Boolean-returning validators return `true`/`false` directly (`validateApiKey`, `isValidUrl`).

## Module Design

**Exports:** Named exports (`export function ...`, `export const ...`) are the default across `open-sse/` and `src/lib/`. Default exports are reserved for React components (`export default function Button(...)`) and Next.js route/page files, matching Next.js App Router conventions.

**Barrel Files:** Heavily used — 25 `index.js` re-export files across `src/` and `open-sse/`. Examples: `src/models/index.js` re-exports the entire `src/lib/localDb` surface; `src/store/index.js` re-exports all Zustand stores. Prefer importing from the barrel (`@/models`) over deep-importing the underlying file, matching existing call sites.

**Client Components/Stores:** Files that run in the browser start with the `"use client";` directive as the first line — `src/shared/components/Button.js`, `src/store/providerStore.js`. Zustand stores follow a consistent `create((set, get) => ({ ...state, action: (...) => set(...) }))` shape.

---

*Convention analysis: 2026-07-05*
