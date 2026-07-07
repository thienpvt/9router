# Architecture

**Analysis date:** 2026-07-05

## Overview

9Router is a local-first AI gateway and dashboard: a Next.js 16 (App Router) application that exposes an OpenAI/Anthropic/Gemini-compatible REST surface under `/v1/*` and routes requests to ~90+ upstream AI providers, with format translation, account/model fallback, OAuth token refresh, request-token compression, and usage tracking. It ships as a single Next.js app plus three auxiliary subsystems: a provider-agnostic translation/execution engine (`open-sse/`), a TLS man-in-the-middle proxy for redirecting official CLI tools (`src/mitm/`), and a separate distributable CLI/tray package (`cli/`).

`open-sse/` is not an npm package — it has no `package.json` and is aliased into the main app via `jsconfig.json` (`"open-sse": ["./open-sse"]`, `"open-sse/*": ["./open-sse/*"]`). Treat `import ... from "open-sse/..."` as same-repo source, not an external dependency.

## Pattern

Layered monolith with a plugin-style provider architecture:

- **Two API surfaces, one core** — `/v1/*` (OpenAI-compatible gateway, for CLI tools/SDKs) and `/api/*` (dashboard management REST) are both Next.js App Router route handlers; the gateway surface delegates into a shared SSE/orchestration core instead of duplicating provider logic.
- **Adapter pattern for upstream execution** — every provider is an `Executor` (`open-sse/executors/*`) implementing a common `execute()` contract; a generic `DefaultExecutor` handles any OpenAI-compatible/Anthropic-compatible upstream, so most new providers need zero new code beyond a registry entry.
- **Registry pattern for format conversion** — `open-sse/translator/index.js` is a `from:to` keyed map of converter functions that self-register as an import side effect; unregistered pairs pivot through OpenAI as an intermediate format.
- **Repository pattern for persistence** — `src/lib/db/repos/*` isolate SQL per entity behind a barrel (`src/lib/db/index.js`); older modules (`localDb.js`, `usageDb.js`) are compatibility shims over this layer.
- **Runtime-detected adapter chain for the DB driver itself** — SQLite backend is chosen at startup, not compile time (see Key Abstractions).

## Layers

**Route/API layer**
- Location: `src/app/api/**/route.js`
- Purpose: Next.js route handlers; parse request, enforce auth, delegate to orchestration layer, shape HTTP response.
- Depends on: `src/sse/handlers/*`, `src/lib/db/*`, `open-sse` (via barrel).
- Used by: external HTTP clients (CLI tools, browser dashboard).

**Orchestration layer**
- Location: `src/sse/handlers/*`, `src/sse/services/*`
- Purpose: DB-aware glue between the Next.js route and the pure `open-sse` core — resolves model/combo/account from local state, loops over fallback accounts, persists credential refreshes.
- Depends on: `open-sse/*` (core, format-agnostic), `src/lib/db/*`.
- Used by: `src/app/api/v1/*` route handlers.

**Translation + execution core (`open-sse/`)**
- Location: `open-sse/handlers/chatCore.js` (+ `imageGenerationCore.js`, `embeddingsCore.js`, `ttsCore.js`, `sttCore.js`, `responsesHandler.js`), `open-sse/translator/*`, `open-sse/executors/*`
- Purpose: format-agnostic request pipeline — detect source format, translate to provider format, dispatch to the right executor, translate the response back, stream to client. Has no knowledge of the local DB (credentials/config are passed in as plain objects).
- Depends on: `open-sse/providers/*`, `open-sse/config/*`, `open-sse/rtk/*`.
- Used by: `src/sse/handlers/*`.

**Provider registry**
- Location: `open-sse/providers/registry/*.js` (one file per provider), aggregated by `open-sse/providers/index.js` into `PROVIDERS`/`PROVIDER_MODELS`/`PROVIDER_OAUTH`/`PROVIDER_MEDIA`.
- Purpose: single source of truth for each provider's transport (base URLs, auth format, headers), model list, and media capabilities.
- Depends on: nothing (leaf config).
- Used by: executors, translators, model resolution, capability checks.

**Persistence layer**
- Location: `src/lib/db/*`
- Purpose: SQLite-backed storage for settings, provider connections, provider nodes, proxy pools, API keys, combos, aliases, pricing, usage history, request details.
- Depends on: one of four SQLite drivers (runtime-selected).
- Used by: every route handler and orchestration module that reads/writes persistent state.

**Frontend/dashboard UI**
- Location: `src/app/(dashboard)/dashboard/*`, `src/shared/components/*`, `src/store/*`
- Purpose: React (Next.js App Router) admin UI for configuring providers, keys, combos, usage, MITM, tunnels, CLI tool integration.
- Depends on: `src/app/api/*` (fetched client-side), `src/store/*` (zustand), `src/shared/*`.
- Used by: browser.

**Auxiliary: MITM proxy**
- Location: `src/mitm/*`
- Purpose: standalone TLS-intercepting HTTPS/HTTP2 server that redirects specific CLI tools' native traffic (Antigravity, Copilot, Cursor, Kiro) through the local 9Router API, for tools that don't support a configurable base URL.
- Depends on: locally running 9Router HTTP API (calls back into it via `fetch`).
- Used by: nothing in-process — runs as its own child process (see Dockerfile).

**Auxiliary: CLI/tray package**
- Location: `cli/*`
- Purpose: separate npm package (`9router` bin) that starts/manages the server process, provides a terminal menu UI and system tray icon.
- Depends on: the running 9Router HTTP API (`cli/src/cli/api/client.js`).
- Used by: end users installing via `npm install -g 9router` / `npx 9router`.

## Data Flow

### Primary request path (`POST /v1/chat/completions`)

1. Client sends request to `/v1/chat/completions`; `next.config.mjs` `rewrites()` maps `/v1/*` → `/api/v1/*` (no redirect, same-request rewrite).
2. `src/app/api/v1/chat/completions/route.js` — `POST` handler lazily calls `initTranslators()` once (module-level `initialized` flag), then calls `handleChat(request)`.
3. `src/sse/handlers/chat.js` `handleChat()`:
   - Parses JSON body; builds `clientRawRequest` (endpoint, body, headers) for logging.
   - Enforces API key if `settings.requireApiKey` (`src/sse/services/auth.js` `extractApiKey`/`isValidApiKey`).
   - Checks bypass patterns (warmup/skip/naming probes) via `open-sse/utils/bypassHandler.js`.
   - Resolves `model` string to `{ provider, model }` via `src/sse/services/model.js` `getModelInfo()` (handles aliases).
   - If the model string is a combo name, dispatches to `handleComboChat`/`handleFusionChat` (`open-sse/services/combo.js`) instead of step 4.
4. `handleSingleModelChat()` loops: `getProviderCredentials()` (`src/sse/services/auth.js`) picks the next available account/connection for the provider, proactively refreshes near-expiry tokens (`checkAndRefreshToken`), then calls `handleChatCore()`.
5. `open-sse/handlers/chatCore.js` `handleChatCore()`:
   - Detects source format (`detectFormat`/`detectFormatByEndpoint`) and resolves target format from provider/model config.
   - If client tool and provider are the same ecosystem (`isNativePassthrough`), skips translation entirely — only model id and Bearer token are swapped.
   - Otherwise: strips unsupported modalities, prefetches remote images to base64, then `translateRequest()` (`open-sse/translator/index.js`) converts the body to the provider's wire format.
   - Applies request-mutation middleware in order: tool dedupe → RTK compression (`open-sse/rtk/index.js`) → Headroom external compression (fail-open) → Caveman/Ponytail system-prompt injection.
   - `getExecutor(provider)` (`open-sse/executors/index.js`) resolves the specialized executor or falls back to `DefaultExecutor`; `executor.execute()` makes the upstream HTTP call, retrying across configured base URLs/status codes.
   - On `401`/`403`, attempts one credential refresh + retry via `executor.refreshCredentials()`.
6. Response path: non-streaming responses go through `handleNonStreamingResponse`; forced-stream-but-client-wants-JSON goes through `handleForcedSSEToJson`; true streaming goes through `handleStreamingResponse`, which uses `translateResponse()` to convert provider SSE chunks back into the client's expected format and pipes them through a disconnect-aware `StreamController`.
7. Throughout, usage/logging side effects fire: `trackPendingRequest`, `appendRequestLog`, `saveRequestDetail` (all `src/lib/db/*` under the hood via `@/lib/usageDb.js`).
8. On failure, `markAccountUnavailable()` (`src/sse/services/auth.js`, using cooldown/backoff logic from `open-sse/services/accountFallback.js`) decides whether to retry the next account for the same provider or the next model in a combo sequence (back in `src/sse/handlers/chat.js`'s loop).

### OAuth connection flow

1. Dashboard UI calls `src/app/api/oauth/[provider]/[action]/route.js` (or provider-specific routes like `kiro/social-authorize`) to start an authorize/device-code flow against the provider's auth server.
2. On callback/exchange, tokens are persisted via `createProviderConnection`/`updateProviderConnection` (`src/lib/db/repos/connectionsRepo.js`).
3. `src/app/api/providers/[id]/test/route.js` validates the new connection by invoking the executor's credential check/refresh path.
4. Live traffic refresh (expired token mid-request) happens inside `open-sse/handlers/chatCore.js` step 5 above, not through this route.

### Dashboard auth flow

1. `src/proxy.js` (Next.js proxy/middleware entry — default export + `config.matcher`) delegates to `src/dashboardGuard.js` on every request except static assets.
2. `dashboardGuard.js` allowlists `PUBLIC_API_PATHS` (health, init, locale, etc. — the `/v1/*` gateway has its own API-key auth, not this cookie auth), accepts a local CLI token (`x-9r-cli-token` header, HMAC'd against machine ID) or a signed JWT dashboard session cookie (`src/lib/auth/dashboardSession.js`, `jose` HS256, 24h expiry).
3. Login (`src/app/api/auth/login/route.js`) checks password via `bcryptjs` against a hash derived from `INITIAL_PASSWORD` (default `"123456"` if unset) or a stored hash, then issues the JWT cookie.

## Key Abstractions

**Executor** (`open-sse/executors/base.js` `BaseExecutor`)
- Represents "how to call one upstream provider." Subclasses override `getBaseUrls()`, `buildUrl()`, `buildHeaders()`, `transformRequest()`, `refreshCredentials()`, `shouldRetry()`.
- `BaseExecutor.execute()` implements the shared fallback loop: iterate configured base URLs, apply per-status retry config (`open-sse/config/runtimeConfig.js` `RETRY_CONFIG`), enforce a connect timeout via `AbortController`, and use `proxyAwareFetch` (`open-sse/utils/proxyFetch.js`, which patches global `fetch` at import time) so outbound calls respect user-configured HTTP/SOCKS proxies.
- Registered in `open-sse/executors/index.js`'s `executors` map (keyed by provider id); `getExecutor(provider)` falls back to a cached `DefaultExecutor` instance for any unregistered id.

**Translator registry** (`open-sse/translator/index.js`)
- `register(from, to, requestFn, responseFn)` populates two `Map`s (`requestRegistry`, `responseRegistry`) keyed by `"from:to"`. Translator modules call `register()` as an import side effect, so every request/response converter file must be imported somewhere reachable from `translator/index.js` or it silently never runs.
- `translateRequest`/`translateResponse` check for an exact `source:target` match first (a "direct route," e.g. `claude:kiro`); if absent, they pivot through OpenAI as an intermediate format (two translations instead of one). The OpenAI pivot is lossy for thinking blocks, non-base64 images, tool-call ids, and `is_error` — direct routes exist specifically to avoid this for fragile pairs.
- Shared logic lives in `open-sse/translator/schema/` (role/block/finish-reason enums) and `open-sse/translator/concerns/` (thinking, modality stripping, image prefetch, tool-call fixups) so individual `<from>-to-<to>.js` files stay thin.

**Provider registry entry** (`open-sse/providers/registry/{id}.js`)
- One file per provider declares `transport` (base URL(s), wire format, auth), optional `oauth` block, and `models[]`. `open-sse/providers/index.js` folds all entries into `PROVIDERS`, `PROVIDER_MODELS`, `PROVIDER_OAUTH`, `PROVIDER_MEDIA`.
- `open-sse/providers/registry/index.js` is auto-generated (a flat list of `import p0 from "./alicode-intl.js"; ...`) — it must be regenerated (via `scripts/migrate-registry.mjs` or similar) after adding a registry file, never hand-edited. `REGISTRY_TEMPLATE.js` in the same directory is excluded from aggregation by design.

**DB adapter chain** (`src/lib/db/driver.js`)
- The SQLite backend is chosen at runtime, not statically: `bun:sqlite` (Bun runtime only) → `better-sqlite3` (optional native dependency) → `node:sqlite` (built into Node ≥22.5) → `sql.js` (pure-JS/WASM, always works, final fallback). This is why `better-sqlite3` is an `optionalDependency` in `package.json` — install must succeed even without native build tools.
- The resolved adapter instance is cached on `global._dbAdapter` specifically so Next.js dev-mode hot-reload (which resets module state) doesn't reopen the database file repeatedly.
- Each adapter (`src/lib/db/adapters/*.js`) implements a uniform interface consumed by `src/lib/db/repos/*.js`.

**Repository** (`src/lib/db/repos/*Repo.js`)
- One file per entity (`settingsRepo`, `connectionsRepo`, `nodesRepo`, `proxyPoolsRepo`, `apiKeysRepo`, `combosRepo`, `aliasRepo`, `pricingRepo`, `disabledModelsRepo`, `usageRepo`, `requestDetailsRepo`) contains that entity's queries. `src/lib/db/index.js` re-exports all of them as one barrel — this barrel is the only import surface the rest of the app should use.
- `src/lib/localDb.js`, `src/lib/usageDb.js`, `src/models/index.js` are explicitly-labeled compatibility shims ("Shim → re-export from new SQLite-based DB layer") kept only so older `@/lib/localDb` imports keep working.

**Fail-open request middleware** (`open-sse/rtk/*`)
- RTK (`open-sse/rtk/index.js` `compressMessages`) and Headroom (`open-sse/rtk/headroom.js` `compressWithHeadroom`) mutate the translated request body in place to shrink token usage, immediately before dispatch. Both are contractually fail-open: any internal error must return `null`/leave the body untouched rather than throw, since a compression bug should never break a chat request. `open-sse/rtk/applyFilter.js` `safeApply` centralizes this guarantee for per-tool filters in `open-sse/rtk/filters/*`.

## Entry Points

**`custom-server.js`** (repo root)
- Production process entry (`Dockerfile` `CMD ["node", "custom-server.js"]`; `package.json` `start:bun` uses the Next-generated standalone server directly instead).
- Wraps `http.createServer` to derive client IP from the raw TCP socket and strip client-supplied `x-forwarded-for`/`x-real-ip` headers unless the socket peer is a trusted local reverse proxy (`127.0.0.1`/`::1`), replacing them with internal `x-9r-real-ip`/`x-9r-via-proxy` headers. This exists so downstream rate-limiting/IP keying can't be spoofed by a client. Then `require("./server.js")` — the Next.js standalone build's own generated entry.

**`src/app/layout.js`**
- Next.js root layout. Triggers server-only side effects at module load: `initConsoleLogCapture()` (console hooking), and imports `@/lib/network/initOutboundProxy` and `@/shared/services/bootstrap` purely for their side effects (the latter calls `initializeApp()` guarded by `global.__appBootstrapped`, skipped during the Next.js build phase via `NEXT_PHASE` checks).

**`open-sse/index.js`**
- Public barrel for the translation/execution engine. First line patches global `fetch` (`import "./utils/proxyFetch.js"`) before anything else runs. Everything `src/sse/*` needs from `open-sse` is imported through this file or direct sub-paths.

**`src/sse/handlers/chat.js`**
- Entry point for the orchestration layer; `import "open-sse/index.js"` is its first statement (ensures the proxy-fetch patch and translator/executor modules are loaded before any DB-aware logic runs).

**`src/proxy.js`**
- Next.js proxy/middleware entry (default export function + `config.matcher`), gates almost every request through `src/dashboardGuard.js` before it reaches a route handler.

**`cli/cli.js`**
- Bin entry for the separate `9router` npm package; starts/stops the server process, renders the terminal menu (`cli/src/cli/*`), manages the system tray icon.

**`src/mitm/server.js`**
- Entry point for the MITM companion process (started separately from the Next.js app; see `Dockerfile`'s comment that "MITM runs server.js as a separate process").

## Architectural Constraints

- **`open-sse/` has no `package.json`** — it is not an installable/versioned unit, just an aliased source directory (`jsconfig.json`). Any refactor that tries to `npm install` or version it independently will not work as expected.
- **Global mutable state for HMR safety** — `src/lib/db/driver.js` (`global._dbAdapter`) and `src/shared/services/bootstrap.js` (`global.__appBootstrapped`) intentionally use `global` to survive Next.js dev-mode hot module reload, which otherwise resets module-level state on every edit.
- **Two parallel `model.js`/`tokenRefresh.js` modules** — `src/sse/services/model.js` and `src/sse/services/tokenRefresh.js` are DB-aware wrappers; `open-sse/services/model.js` and `open-sse/services/tokenRefresh.js` are the pure, format/provider-only logic underneath. This is intentional layering, not duplication — don't merge them.
- **Translator self-registration requires a live import** — a new `translator/request|response/<from>-to-<to>.js` file does nothing until it is imported (directly or transitively) from `open-sse/translator/index.js`, because `register()` only runs as an import side effect.
- **RTK/Headroom must never throw** — both mutate request bodies in place before the upstream call; an uncaught exception there would break otherwise-working chat requests, so all internal errors are swallowed and the body is returned untouched.
- **`docs/ARCHITECTURE.md` is stale** — the pre-existing doc at `docs/ARCHITECTURE.md` (dated 2026-02-06) describes a JSON-file persistence model (`db.json`, `usage.json`, `log.txt`). The code has since migrated to the SQLite-based layer described above (`src/lib/db/*`); `localDb.js`/`usageDb.js` are now shims over it. Treat that document as historical context only, not current architecture.

## Cross-Cutting Concerns

**Logging**
- `src/sse/utils/logger.js` — structured console logger (`log.info/warn/debug/request`, ANSI `COLORS`) used across the orchestration layer and route handlers.
- `open-sse/utils/requestLogger.js` `createRequestLogger()` — per-request logger that can dump raw client request, translated request, target (upstream) request, and errors; gated by `ENABLE_REQUEST_LOGS` env var, writes under `logs/` when enabled (treat as sensitive — full headers/bodies).
- `open-sse/utils/debugLog.js` `dbg()` — low-level fetch/wire tracing inside `BaseExecutor`; `DEBUG_WIRE_BODY=1` env var opts into dumping the exact outbound JSON body.

**Error handling**
- `open-sse/utils/error.js` centralizes `errorResponse`, `createErrorResult`, `parseUpstreamError`, `formatProviderError` — every failure path in `chatCore.js` funnels through these so client-facing error shape and status code stay consistent regardless of which provider failed.
- Provider/account failures are recoverable by design: `markAccountUnavailable()` classifies the error (rate limit vs auth vs hard failure), computes a cooldown, and the caller (`src/sse/handlers/chat.js`) decides whether to retry with a different account or combo model rather than failing the client request outright.

**Authentication**
- Two independent auth mechanisms, not one: dashboard/browser auth is cookie+JWT based (`src/lib/auth/dashboardSession.js`, gated by `src/proxy.js` → `src/dashboardGuard.js`); gateway (`/v1/*`) auth is a local API key checked inline in `src/sse/handlers/chat.js` (`extractApiKey`/`isValidApiKey`) only when `settings.requireApiKey` is true. A request can be valid for one and not the other.
- `INITIAL_PASSWORD` defaults to `"123456"` when unset — must be overridden for any real deployment; this is a genuine security-sensitive default, not a placeholder.

---

*Architecture analysis: 2026-07-05*
