# Codebase Structure

**Analysis date:** 2026-07-05

## Directory Layout

```
9router-fork/
├── src/                        # Main Next.js application source
│   ├── app/                    # Next.js App Router — pages + API routes
│   │   ├── (dashboard)/        # Route group: dashboard pages (shared layout, no URL segment)
│   │   ├── api/                # Route handlers: /v1 gateway + /api management endpoints
│   │   ├── callback/           # OAuth redirect landing page
│   │   ├── dashboard/          # Legacy/standalone dashboard page (settings/pricing) outside the group
│   │   ├── landing/            # Marketing landing page + components
│   │   ├── login/              # Login page
│   │   ├── layout.js           # Root layout; bootstraps server-side singletons
│   │   └── page.js             # Root route
│   ├── i18n/                   # Runtime i18n config/provider (React context) — NOT translated docs
│   ├── lib/                    # Server-side library code (no React)
│   │   ├── auth/                #   dashboard session (JWT), OIDC, login rate limiting
│   │   ├── db/                  #   SQLite persistence layer (adapters/repos/migrations)
│   │   ├── headroom/            #   external compression proxy detection
│   │   ├── mcp/                 #   MCP stdio↔SSE bridge
│   │   ├── network/             #   outbound proxy config/testing
│   │   ├── oauth/                #   provider OAuth flows (per-provider services)
│   │   ├── qoder/                #   Qoder-specific auth/encoding helpers
│   │   ├── tunnel/               #   Cloudflare/Tailscale tunnel management
│   │   └── updater/              #   app self-update
│   ├── mitm/                    # Standalone TLS MITM proxy (separate process)
│   │   ├── cert/                 #   root CA + per-domain cert generation
│   │   ├── dns/                  #   DNS override config
│   │   └── handlers/             #   per-tool traffic handlers (antigravity, copilot, cursor, kiro)
│   ├── models/                  # Thin re-export shim → @/lib/localDb
│   ├── shared/                  # Cross-cutting frontend code
│   │   ├── components/           #   React components (flat, + layouts/ subfolder)
│   │   ├── constants/            #   static config/display data
│   │   ├── hooks/                #   React hooks
│   │   ├── services/             #   client-safe bootstrap/init services
│   │   └── utils/                #   generic helpers (api, machine id, cn, etc.)
│   ├── sse/                     # Orchestration layer: DB-aware glue over open-sse core
│   │   ├── handlers/              #   per-modality request entry points (chat, tts, stt, ...)
│   │   ├── services/              #   auth/model/tokenRefresh (DB-aware wrappers)
│   │   └── utils/                 #   logger
│   ├── store/                   # Zustand global state stores
│   ├── dashboardGuard.js        # Auth gate logic (called from proxy.js)
│   └── proxy.js                 # Next.js proxy/middleware entry point
├── open-sse/                    # Provider-agnostic SSE/translation engine (no package.json — aliased via jsconfig.json)
│   ├── config/                   # ALL constants/config — no hardcoding elsewhere
│   ├── executors/                 # Per-provider upstream call logic (BaseExecutor subclasses)
│   ├── handlers/                  # Per-modality cores (chatCore, imageGenerationCore, ttsCore, sttCore, ...)
│   │   └── chatCore/                #   streaming/non-streaming/sse-to-json sub-handlers
│   ├── providers/                 # Registry builder + capabilities.js + pricing.js
│   │   └── registry/                #   one file per provider (~90+ files) + auto-generated index.js
│   ├── rtk/                       # Request token-killer (compression) + filters/
│   ├── services/                  # model.js, provider.js, accountFallback.js, combo.js, tokenRefresh/, usage/
│   ├── shared/                    # Cross-provider auth/identity (clineAuth, machineId, qoder/)
│   ├── transformer/                # Chat Completions SSE ↔ Codex Responses SSE conversion
│   ├── translator/                 # Format conversion engine
│   │   ├── concerns/                 #   shared logic (thinking, modality, prefetch, tool calls...)
│   │   ├── formats/                  #   per-format helpers
│   │   ├── request/                  #   <from>-to-<to>.js request converters
│   │   ├── response/                 #   <from>-to-<to>.js response converters
│   │   └── schema/                   #   enums (roles, blocks, finish reasons)
│   ├── utils/                     # streamHandler, sse, error, sessionManager, proxyFetch, etc.
│   └── index.js                   # Public barrel (patches global fetch first)
├── cli/                          # Separate npm package: `9router` CLI/tray binary
│   ├── hooks/                     # npm lifecycle hooks (postinstall)
│   ├── scripts/                   # build-cli.js etc.
│   └── src/cli/                   # menus/, tray/, api/, utils/, terminalUI.js
├── tests/                        # Test suite (vitest), semi-independent package.json
│   ├── __baseline__/              # regression snapshot baselines + verify scripts
│   ├── translator/                # translator-focused tests (golden, bugs-*, real/)
│   └── unit/                      # everything else — one file per feature/bug
├── skills/                       # Agent skill definitions (SKILL.md per capability)
├── scripts/                      # Root-level maintenance scripts (registry migration, etc.)
├── gitbook/                      # Separate Next.js app: public docs site (own package.json/config)
├── docs/                         # ARCHITECTURE.md only (stale — see codebase/ARCHITECTURE.md notes)
├── i18n/                         # Translated README files (README.ja-JP.md, etc.) — not app code
├── public/                       # Next.js static assets
├── images/                       # README/marketing images
├── logs/                         # Runtime debug log output (gitignored, dir structure kept)
├── .planning/                    # Planning docs (config.json, quick/, codebase/ — this analysis)
├── .claude/, .cursor/, .github/  # Editor/agent config, CI workflows
├── custom-server.js              # Production process entry (wraps http.createServer for IP handling)
├── next.config.mjs               # Next.js config: rewrites, tracing, webpack tweaks
├── jsconfig.json                 # Path aliases: @/* → src/*, open-sse(/*) → open-sse
├── Dockerfile / Dockerfile.base  # Container build
└── package.json                  # Root app manifest (private, version 0.5.18)
```

## Directory Purposes

**`src/app/api/`**
- Purpose: every HTTP-reachable endpoint. Two families live side by side: `v1/*` + `v1beta/*` (OpenAI/Anthropic/Gemini-compatible gateway, consumed by CLI tools/SDKs) and everything else (dashboard management REST, consumed by the browser UI and the `cli/` package).
- Contains: one `route.js` per endpoint (Next.js App Router convention), exporting named HTTP-verb functions (`GET`, `POST`, etc.) plus optional `OPTIONS` for CORS preflight.
- Key files: `src/app/api/v1/chat/completions/route.js`, `src/app/api/v1/messages/route.js` (Claude-shape), `src/app/api/v1/responses/route.js` (OpenAI Responses-shape), `src/app/api/v1/models/[kind]/route.js`, `src/app/api/oauth/[provider]/[action]/route.js`.

**`src/lib/db/`**
- Purpose: the single persistence layer. Runtime-selected SQLite driver (`driver.js`) + one repo file per entity + declarative schema/migrations.
- Contains: `adapters/` (bun-sqlite/better-sqlite3/node-sqlite/sql.js — pick one at startup), `repos/` (one query module per entity), `migrations/` (versioned schema changes), `helpers/` (JSON column, KV store, meta store), `schema.js` (declarative table definitions), `paths.js` (`DATA_DIR`-relative file locations).
- Key files: `src/lib/db/index.js` (barrel — the only import surface other code should use), `src/lib/db/driver.js`, `src/lib/db/schema.js`.

**`src/sse/`**
- Purpose: the DB-aware orchestration layer sitting between Next.js routes and the pure `open-sse` core. Resolves model/combo/account against local persisted state, loops over fallback accounts, persists credential refreshes.
- Contains: `handlers/` (one file per modality — chat, embeddings, tts, stt, imageGeneration, search, fetch), `services/` (`auth.js` credential selection, `model.js` alias/combo resolution, `tokenRefresh.js` DB-persisting wrapper), `utils/logger.js`.
- Key files: `src/sse/handlers/chat.js` (primary chat entry, contains the account-fallback loop).

**`open-sse/`**
- Purpose: format-agnostic translation/execution engine — no knowledge of the local DB. Everything needed to turn one client request into any provider's wire format and back. Not an npm package; aliased into the app via `jsconfig.json`.
- Contains: see the annotated tree above. Full internal conventions and "how to add a provider/executor/translator" guidance already documented in `open-sse/AGENTS.md` — read that file directly rather than duplicating it here.
- Key files: `open-sse/handlers/chatCore.js`, `open-sse/translator/index.js`, `open-sse/executors/index.js`, `open-sse/providers/index.js`.

**`src/mitm/`**
- Purpose: standalone HTTPS/HTTP2 TLS-intercepting proxy that redirects specific CLI tools' native traffic through the local 9Router API, for tools without a configurable base URL. Runs as its own process, not in-process with the Next.js server.
- Contains: `server.js` (entry), `cert/` (self-signed root CA + per-domain cert generation), `handlers/` (`antigravity.js`, `copilot.js`, `cursor.js`, `kiro.js`, `base.js` shared fetch-to-router helper), `dns/`.

**`src/shared/`**
- Purpose: frontend code shared across dashboard pages — the "UI kit" plus client-safe utilities.
- Contains: `components/` (flat list of ~46 React components + a `layouts/` subfolder for page shells), `constants/`, `hooks/`, `services/` (client bootstrap), `utils/`.
- Key files: `src/shared/components/layouts/DashboardLayout.js`, `src/shared/services/bootstrap.js`.

**`cli/`**
- Purpose: separate, independently-versioned npm package (own `package.json`, bin name `9router`) that starts/stops the server process and provides a terminal menu + system tray icon. Talks to a running 9Router instance purely over HTTP.
- Contains: `src/cli/menus/` (interactive terminal screens), `src/cli/tray/` (platform tray icon, incl. Windows PowerShell script), `src/cli/api/client.js` (HTTP client to the local API), `hooks/postinstall.js` (lazy-installs native SQLite/tray deps outside the locked global-install dir).

**`tests/`**
- Purpose: Vitest suite with its own `package.json` (`type: module`) and `vitest.config.js`, run independently of the main app's build.
- Contains: `unit/` (one file per feature/provider/bug — flat, ~130+ files), `translator/` (translator-specific: `golden-*` snapshot tests, `bugs-*` regression tests, `real/` live-provider smoke tests), `__baseline__/` (JSON snapshots + verify scripts used to detect regressions across refactors).

**`gitbook/`**
- Purpose: a second, fully independent Next.js application (own `package.json`, `next.config.mjs`, `jsconfig.json`) that builds the public documentation site. Excluded from the main app's file-tracing and dev-server watcher (see `next.config.mjs` `outputFileTracingExcludes`/`watchOptions`).

**`skills/`**
- Purpose: agent-facing capability documentation consumed by AI coding assistants (not by the app itself) — one `SKILL.md` per capability (`9router-chat`, `9router-image`, `9router-tts`, etc.) plus an index skill (`skills/9router/SKILL.md`).

## Key File Locations

**Entry points:**
- `custom-server.js`: production process entry (Docker `CMD`); wraps `http.createServer` for IP-spoofing-safe header handling, then requires the Next standalone `server.js`.
- `src/app/layout.js`: Next.js root layout; fires server-only bootstrap side effects on module load.
- `src/proxy.js`: Next.js proxy/middleware entry (`config.matcher` + default export), gates requests through `src/dashboardGuard.js`.
- `open-sse/index.js`: public barrel for the translation engine; patches global `fetch` first.
- `src/sse/handlers/chat.js`: orchestration-layer entry for chat requests.
- `cli/cli.js`: bin entry for the `9router` CLI package.
- `src/mitm/server.js`: entry for the standalone MITM process.

**Configuration:**
- `next.config.mjs`: rewrites (`/v1/*` → `/api/v1/*`), output tracing, webpack watch excludes, body size limits.
- `jsconfig.json`: path aliases (`@/*` → `src/*`, `open-sse` → `open-sse/`).
- `open-sse/config/*.js`: all provider-agnostic runtime constants (timeouts, token limits, error messages) — the AGENTS.md rule is "never hardcode values elsewhere."
- `src/lib/db/paths.js`: `DATA_DIR`-relative file/dir locations (DB file, backups, legacy JSON paths).
- `.env.example`: names of all environment variables the app reads (values are placeholders — never contains real secrets).

**Core logic:**
- `open-sse/handlers/chatCore.js`: the central chat request pipeline (translate → middleware → execute → stream back).
- `open-sse/translator/index.js`: translator registry + `translateRequest`/`translateResponse` entry points.
- `open-sse/executors/base.js`: shared upstream-call/retry/fallback logic every executor inherits.
- `src/lib/db/index.js`: persistence barrel — import DB functions from here, not from individual repo files.

**Testing:**
- `tests/vitest.config.js`, `tests/package.json`: test runner config (separate from root `package.json`).
- `tests/unit/*.test.js`: primary unit test location.
- `tests/translator/*.test.js` + `tests/translator/__snapshots__/`: format-conversion regression tests.

## Naming Conventions

**Files:**
- Plain modules: camelCase — `accountFallback.js`, `oauthCredentialManager.js`, `dashboardSession.js`.
- Provider registry entries and translator converters: kebab-case, often multi-word provider ids — `open-sse/providers/registry/black-forest-labs.js`, `open-sse/translator/request/claude-to-kiro.js`, `open-sse/executors/gemini-cli.js`.
- Translator converters follow a strict `<source-format>-to-<target-format>.js` pattern in both `translator/request/` and `translator/response/` — the pair may exist in only one direction if the reverse isn't needed.
- React components: PascalCase — `Button.js`, `DashboardLayout.js`, `AddCustomEmbeddingModal.js` (`.js` extension, not `.jsx`, throughout the repo — this is a JS/JSX-in-`.js` codebase, not TypeScript).
- Next.js special files use framework-mandated lowercase names: `route.js`, `page.js`, `layout.js`.
- Test files: `<feature-or-bug-name>.test.js`, living flat under `tests/unit/` or `tests/translator/`; live/network-dependent tests are suffixed `.real.test.js` or `.live.test.js` to distinguish them from pure unit tests run in CI.
- Barrel/aggregator files are consistently named `index.js` (e.g. `open-sse/providers/index.js`, `src/lib/db/index.js`, `src/store/index.js`) — check `index.js` first when looking for a module's public surface.

**Directories:**
- Route groups use Next.js parentheses syntax to share layout without affecting the URL: `src/app/(dashboard)/`.
- Dynamic route segments use Next.js bracket syntax: `[id]`, `[kind]`, `[provider]`, `[action]`, and catch-all `[...path]`.
- Per-provider sub-handler directories are named `<modality>Providers` (plural): `open-sse/handlers/imageProviders/`, `open-sse/handlers/ttsProviders/`, `open-sse/handlers/embeddingProviders/`, each with a `_base.js` (underscore prefix signals "not a provider itself, shared base").

**Classes:**
- Executor classes: `<ProviderName>Executor` extending `BaseExecutor` — `KiroExecutor`, `CodexExecutor`, `AntigravityExecutor`. Registered under a lowercase-hyphenated key in `open-sse/executors/index.js`'s `executors` map (key does not have to match the class-name casing, e.g. `"gemini-cli": new GeminiCLIExecutor()`).

**Config-driven values:**
- `open-sse/AGENTS.md` states the project-wide rule explicitly: never hardcode model names, role strings, or block-type strings — pull them from `open-sse/config/*` or `open-sse/translator/schema/*` enums (`roles.js`, `blocks.js`, `finishReasons.js`).

## Where to Add New Code

**New provider (OpenAI/Anthropic-compatible upstream):**
- Copy `open-sse/providers/REGISTRY_TEMPLATE.js` → `open-sse/providers/registry/{id}.js`.
- Add its models to `open-sse/config/providerModels.js`.
- Regenerate `open-sse/providers/registry/index.js` (auto-generated static import list — do not hand-edit; `REGISTRY_TEMPLATE.js` is intentionally excluded from it).
- No executor needed — `DefaultExecutor` handles any standard OpenAI-compatible or Anthropic-compatible API automatically.

**New provider (non-standard upstream, e.g. binary protocol or unusual auth):**
- Subclass `BaseExecutor` in a new `open-sse/executors/{id}.js`, overriding `getBaseUrls`/`buildHeaders`/`buildUrl`/`execute` as needed.
- Register the instance in the `executors` map in `open-sse/executors/index.js`.

**New format translator:**
- Add `open-sse/translator/request/<from>-to-<to>.js` and/or `open-sse/translator/response/<from>-to-<to>.js`, each calling `register(from, to, reqFn, resFn)` on import.
- Import the new file from `open-sse/translator/index.js` (registration is an import side effect — a file that's never imported never runs).
- Reuse `open-sse/translator/schema/` and `open-sse/translator/concerns/` rather than re-implementing parsing logic.

**New gateway endpoint (`/v1/*`):**
- Add `src/app/api/v1/<path>/route.js`; for chat-shaped endpoints, delegate into `src/sse/handlers/chat.js` or a sibling handler in `src/sse/handlers/`, which in turn calls into `open-sse/handlers/*Core.js`. Don't reimplement translation/execution/fallback in the route handler itself.

**New dashboard management endpoint:**
- Add `src/app/api/<domain>/route.js` (or `[id]/route.js` for item-scoped operations), reading/writing through `src/lib/db/index.js` (never import an individual `repos/*.js` file directly from a route).

**New persisted entity:**
- Add a table to `TABLES` in `src/lib/db/schema.js`, add a `src/lib/db/repos/<entity>Repo.js`, re-export its functions from `src/lib/db/index.js`. Add a versioned file in `src/lib/db/migrations/` only for destructive changes (drop/rename/type-change); additive columns/tables are picked up automatically from the declarative schema.

**New dashboard page:**
- Add `src/app/(dashboard)/dashboard/<page>/page.js` (stays inside the route group to inherit `DashboardLayout`); colocate page-specific components in a `components/` subfolder next to `page.js` (established pattern — see `cli-tools/components/`, `endpoint/components/`).

**New shared UI component:**
- Add to `src/shared/components/` (flat namespace; only multi-file component groups get their own subfolder, e.g. `layouts/`).

**New test:**
- Provider/feature/bug-specific unit test → `tests/unit/<name>.test.js`.
- Format-conversion test → `tests/translator/` (use `golden-*` files as the pattern for snapshot-based coverage; `bugs-*` naming for regression tests tied to a specific fixed issue).

## Special Directories

**`.planning/`**
- Purpose: planning/process artifacts (this analysis, phase plans, config).
- Generated: partially — `codebase/` docs are generated by analysis tooling; `quick/`/phase docs are authored during planning workflows.
- Committed: untracked in current git status (`?? .planning/`) — check with the user before assuming it should be committed.

**`.codegraph/`**
- Purpose: local code-indexing tool state (SQLite DBs, daemon pid/log).
- Generated: yes, entirely (`.gitignore`d via its own `.codegraph/.gitignore`).
- Committed: no.

**`logs/`**
- Purpose: runtime debug output when `ENABLE_REQUEST_LOGS=true` (full request/response dumps — treat as sensitive) and MITM dump files.
- Generated: yes.
- Committed: no (`.gitignore`: `logs/*`), directory structure only.

**`open-sse.old/`** (referenced in config, not confirmed present)
- Purpose: `next.config.mjs` watch-excludes and `.gitignore` both reference `open-sse.old/` as "refactor backup reference (do not bundle/lint)" — if present locally, it is intentionally excluded from builds, linting, and file watching.

**`docs/`**
- Purpose: holds exactly one file, `docs/ARCHITECTURE.md`, explicitly excluped from the otherwise-blanket `docs/*` gitignore rule (`.gitignore`: `docs/*` then `!docs/ARCHITECTURE.md`). Contains a system-design doc that is now stale relative to the current SQLite-based persistence layer — see the note in `.planning/codebase/ARCHITECTURE.md`.
- Generated: no (hand-maintained).
- Committed: yes (the one exempted file only).

**`i18n/`** (root) vs **`src/i18n/`**
- Root `i18n/`: translated copies of the README (`README.ja-JP.md`, etc.) — documentation, not code.
- `src/i18n/`: the actual runtime i18n implementation (config, React provider) used by the dashboard UI. Don't confuse the two when navigating.

---

*Structure analysis: 2026-07-05*
