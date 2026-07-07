# External Integrations

**Analysis Date:** 2026-07-05

## APIs & External Services

**AI Provider Backends (chat/completion), routed through `open-sse/providers/registry/*.js` (~95 registry entries, one file per provider):**
- Anthropic Claude (`registry/claude.js`, `registry/anthropic.js`), OpenAI (`registry/openai.js`), Google Gemini / Vertex (`registry/gemini.js`, `registry/vertex.js`, `registry/vertex-partner.js`), Azure OpenAI (`registry/azure.js`), xAI/Grok (`registry/xai.js`, `registry/grok-web.js`), Qwen (`registry/qwen.js`), GitHub Copilot (`registry/github.js`), Groq, Cerebras, Fireworks, Together, Mistral, Cohere, DeepSeek, GLM/GLM-CN, Kimi/Kimi-Coding, MiniMax/MiniMax-CN, Nebius, Nvidia, OpenRouter, Vercel AI Gateway, Hyperbolic, SiliconFlow, Chutes, Volcengine Ark, BytePlus, Perplexity/Perplexity-Web, iFlow, Qoder, Antigravity, Cursor, CodeBuddy-CN, Kilocode, Cline/ClinePass, Kimchi, GitLab Duo, Ollama (local + hosted), OpenCode/OpenCode-Go, Alicode/Alicode-Intl, Blackbox, Venice, Xiaomi Mimo/Tokenplan
  - SDK/Client: none — hand-rolled HTTP via `undici`/native `fetch`, one executor per provider family in `open-sse/executors/*.js` (e.g. `codex.js`, `kiro.js`, `cursor.js`, `vertex.js`, `azure.js`, `qwen.js`, `iflow.js`, `gemini-cli.js`, `commandcode.js`, `grok-web.js`, `perplexity-web.js`, `qoder.js`, `opencode.js`, `ollama-local.js`)
  - Auth: per-connection, stored encrypted-at-rest in the `providerConnections` table (`src/lib/db/schema.js`); OAuth flows in `src/lib/oauth/services/*.js`; static client IDs/secrets in `open-sse/providers/shared.js` and `open-sse/providers/registry/*.js`; user-supplied API keys entered via dashboard
  - Request/response normalization: `open-sse/translator/` (formats, request/response adapters, concerns) translates between OpenAI/Anthropic/Gemini/Cursor/Codex wire formats

**Image Generation (`open-sse/handlers/imageProviders/*.js`):**
- OpenAI Images, Google Gemini (Nano Banana via `nanobanana.js`), Black Forest Labs (Flux), Stability AI, Runway ML, fal.ai, Hugging Face, Cloudflare AI, ComfyUI (self-hosted), SD WebUI (self-hosted), Codex/Sora
  - Auth: per-connection API key, same `providerConnections` store

**Text-to-Speech (`open-sse/handlers/ttsProviders/*.js`):**
- ElevenLabs, OpenAI TTS, Google TTS, MiniMax, Edge TTS (Microsoft, unofficial/no-key), OpenRouter TTS, local device voices, generic-format providers (Deepgram, Inworld voices surfaced via `src/app/api/media-providers/tts/*/voices/route.js`)
  - Auth: per-connection API key; Edge TTS requires none

**Speech-to-Text / Embeddings:**
- Embeddings: OpenAI-compatible node providers, Google Gemini embeddings (`open-sse/handlers/embeddingProviders/{openai,gemini,openaiCompatNode}.js`)
- STT: `open-sse/handlers/sttCore.js` (AssemblyAI registry entry present: `registry/assemblyai.js`)

**Web Search (`open-sse/handlers/search/callers.js`, `registry/*.js`):**
- Serper, Brave Search, Perplexity, Exa, Tavily, Google Programmable Search Engine (PSE), Linkup, SearchAPI, You.com, SearXNG (self-hosted)
  - Auth: per-provider API key/token passed as `params.token`; Google PSE additionally needs `cx` search engine ID

**Web Fetch / Scraping (`open-sse/handlers/fetch/index.js`):**
- Firecrawl (`api.firecrawl.dev`), Jina Reader (`r.jina.ai`), Tavily (`api.tavily.com/extract`), Exa (`api.exa.ai/contents`)
  - Auth: Bearer token / `x-api-key` per provider, from stored credentials

**Cloud deploy targets for outbound relay/proxy pools (`src/app/api/proxy-pools/*/route.js`):**
- Cloudflare Workers (`cloudflare-deploy/route.js`) - uploads a relay Worker script via `api.cloudflare.com/client/v4/accounts/{accountId}/workers/scripts/*`, enables `workers.dev` subdomain; requires user-supplied Account ID + API Token
- Deno Deploy (`deno-deploy/route.js`)
- Vercel (`vercel-deploy/route.js`)
  - Purpose: user deploys a small HTTP relay worker to get an outbound egress IP not shared with 9router's own host

**Cloudflare Tunnel (`src/lib/tunnel/cloudflare/*.js`):**
- `cloudflared` binary managed as a child process (`cloudflared.js`, `manager.js`, `healthCheck.js`, `pid.js`) to expose the local dashboard/API publicly without port forwarding
- `WORKER_URL` (`src/lib/tunnel/cloudflare/config.js`) defaults to `https://abc-tunnel.us`, overridable via `TUNNEL_WORKER_URL` env var — coordinates quick-tunnel setup

**Tailscale (`src/lib/tunnel/tailscale/*.js`):**
- `tailscale`/`tailscaled` binaries managed as child processes for private-network tunnel exposure; userspace networking socket at `<DATA_DIR>/tailscale/tailscaled.sock`; also probes system-installed daemon socket (`/var/run/tailscale/tailscaled.sock`)

**Headroom sidecar (`src/lib/headroom/{detect,process}.js`):**
- External Python-based proxy (`ghcr.io/chopratejas/headroom` in `docker-compose.yml`, or local `headroom` CLI/pip package) — 9router detects/launches it and proxies through `HEADROOM_URL` (default `http://localhost:8787`) for a request-shaping feature; requires Python >=3.10 when run locally

**MITM local proxy (`src/mitm/`):**
- Not a third-party API — an in-repo TLS-intercepting proxy (own root CA generated via `node-forge`/`selfsigned` in `src/mitm/cert/`) that rewrites traffic from CLI tools (Antigravity, GitHub Copilot, Cursor, Kiro) so their native AI requests route through 9router. Handlers: `src/mitm/handlers/{antigravity,copilot,cursor,kiro,base}.js`

**MCP (Model Context Protocol) bridge (`src/lib/mcp/stdioSseBridge.js`):**
- Spawns local stdio MCP plugin processes (allowlist-only, `LOCAL_STDIO_PLUGINS` from `@/shared/constants/coworkPlugins`) and bridges them to HTTP/SSE at `src/app/api/mcp/[plugin]/{sse,message}/route.js`; explicit comment notes this is restricted to preset commands as an RCE-prevention control

**Kilo Code free models (`src/app/api/providers/kilo/free-models/route.js`):**
- Fetches a curated free-model list from the Kilo Code service for the provider picker

## Data Storage

**Databases:**
- SQLite (single embedded file, path resolved by `src/lib/db/paths.js` under `DATA_DIR`) — no external database server
  - Connection: none (file-based); location configurable via `DATA_DIR` env var
  - Client: custom multi-driver adapter layer (`src/lib/db/driver.js`) that tries, in order: `bun:sqlite` (Bun runtime) → `better-sqlite3` (native, optionalDependency) → `node:sqlite` (Node >=22.5 built-in) → `sql.js` (pure-WASM fallback, always available) — see `src/lib/db/adapters/*.js`
  - Schema: declarative table definitions in `src/lib/db/schema.js` (`providerConnections`, `providerNodes`, `proxyPools`, `apiKeys`, `combos`, `kv`, `usageHistory`, `usageDaily`, `requestDetails`, `settings`, `_meta`); versioned migrations in `src/lib/db/migrations/*.js` + declarative sync via `syncSchemaFromTables()`
  - Repos: `src/lib/db/repos/*.js` (one per table: `apiKeysRepo`, `combosRepo`, `connectionsRepo`, `nodesRepo`, `proxyPoolsRepo`, `settingsRepo`, `usageRepo`, `requestDetailsRepo`, `pricingRepo`, `disabledModelsRepo`, `aliasRepo`)
  - Backup: `src/lib/db/backup.js`

**File Storage:**
- Local filesystem only, under `DATA_DIR` (default resolved by `src/lib/dataDir.js`; overridable via `DATA_DIR` env var, defaults to platform-specific app-data dir or `/app/data` in Docker) — no S3/GCS/blob storage integration found

**Caching:**
- In-process only: module-level globals used as caches to survive Next.js dev hot-reload (e.g. `global._dbAdapter` in `src/lib/db/driver.js`, `src/lib/mitmAliasCache.js`, `open-sse/utils/claudeHeaderCache.js`). No Redis/Memcached.

## Authentication & Identity

**Dashboard Auth (custom, not a third-party provider):**
- Password-based login, bcrypt-hashed (`bcryptjs`), stored in `settings` table; falls back to `INITIAL_PASSWORD` env var or hardcoded default `"123456"` on first run (`src/lib/auth/dashboardSession.js`)
- Session token: JWT (HS256, via `jose`), secret loaded from `JWT_SECRET` env var or generated once and persisted to `<DATA_DIR>/jwt-secret` (0600 perms) — `src/lib/auth/dashboardSession.js`
- Cookie: `auth_token`, httpOnly, `sameSite=lax`, `secure` flag forced by `AUTH_COOKIE_SECURE=true` or auto-detected from `x-forwarded-proto: https`
- Login rate limiting: `src/lib/auth/loginLimiter.js`, keys on real client IP (see `custom-server.js` IP-derivation wrapper), honors `TRUST_PROXY` env var

**OIDC SSO (optional, self-configured by the operator):**
- Generic OIDC client implementation, not tied to one vendor — `src/lib/auth/oidc.js`
- Discovery via `{issuer}/.well-known/openid-configuration`; Authorization Code + PKCE (S256) flow; ID token verified with `jose` `createRemoteJWKSet` + `jwtVerify` (issuer/audience/nonce checked)
- Configured entirely through dashboard settings (`oidcIssuerUrl`, `oidcClientId`, `oidcClientSecret`, `oidcScopes`, `oidcLoginLabel`), stored in the `settings` table — no dedicated env vars required
- Routes: `src/app/api/auth/oidc/{start,callback,test}/route.js`

**Per-Provider OAuth (for connecting AI provider accounts, not dashboard login):**
- `src/lib/oauth/services/*.js` implements OAuth/device flows per provider: Claude, Codex/OpenAI, Gemini CLI, Qwen, iFlow, Qoder, Antigravity, GitHub (Copilot device flow), Kiro (AWS Builder ID / IDC / social / import-token), Cursor (local token import), xAI
- Shared helpers/constants: `src/lib/oauth/providerHelpers.js`, `src/lib/oauth/constants/oauth.js`, `src/lib/oauth/utils/{pkce,banner,ui,server}.js`
- PKCE implemented locally (`src/lib/oauth/utils/pkce.js`), not delegated to an SDK
- Kiro also has an external IdP path: `src/lib/oauth/kiroExternalIdp.js`
- One provider's client ID is env-overridable: `KIMI_CODING_OAUTH_CLIENT_ID` (`src/lib/oauth/constants/oauth.js`)
- AWS region values used in Kiro OAuth URLs are validated against an allowlist regex (`AWS_REGION_PATTERN`) to prevent SSRF via region injection (`src/lib/oauth/constants/oauth.js`, referencing GHSA-6mwv-4mrm-5p3m)

**API Key Auth (for 9router's own `/v1/*` proxy endpoints):**
- Separate from dashboard auth — `apiKeys` table (`src/lib/db/schema.js`), managed via `src/app/api/keys/*`, checked when external clients call `/v1/chat/completions`, `/v1/messages`, etc.

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/Bugsnag/etc. found)

**Logs:**
- Console-based, in-process ring buffer for the dashboard log viewer: `src/lib/consoleLogBuffer.js`
- Structured request logging: `open-sse/utils/requestLogger.js`, `open-sse/utils/debugLog.js` (gated by `NODE_ENV`)
- Debug toggles via env vars: `DEBUG_MITM`, `DEBUG_KIRO_EFFORT`, `DEBUG_WIRE_BODY`, `CURSOR_STREAM_DEBUG`, `CURSOR_PROTOBUF_DEBUG`
- Per-request detail capture (opt-in, local only): `requestDetails` table, governed by `OBSERVABILITY_ENABLED`, `OBSERVABILITY_MAX_RECORDS`, `OBSERVABILITY_BATCH_SIZE`, `OBSERVABILITY_FLUSH_INTERVAL_MS`, `OBSERVABILITY_MAX_JSON_SIZE` (`src/lib/db/repos/requestDetailsRepo.js`)
- Usage/cost tracking (not third-party APM): `usageHistory`/`usageDaily` tables, exposed via `src/app/api/usage/*` routes and dashboard charts (`recharts`)

## CI/CD & Deployment

**Hosting:**
- Self-hosted by design: Docker container (`Dockerfile`, `node:22-alpine`), or global npm CLI (`9router` package from `cli/`) running as a local background service, or bare `next start`
- No first-party managed cloud hosting (the app itself is the product operators self-host); Cloudflare/Deno/Vercel integrations above are for *outbound relay*, not for hosting the app

**CI Pipeline:**
- GitHub Actions:
  - `.github/workflows/docker-publish.yml` — builds and pushes multi-arch (`linux/amd64,linux/arm64`) Docker images to GHCR (`ghcr.io/<repo>`) and Docker Hub (`decolua/9router`) on `v*` tag push or manual dispatch; uses `docker/build-push-action@v6` with registry-cached layers
  - `.github/workflows/gitbook-pages.yml` — deploys the `gitbook/` docs site to GitHub Pages
  - `.github/dependabot.yml` — dependency update automation
- No test-running CI workflow found (Vitest suite in `tests/` is not wired into a GitHub Actions job in `.github/workflows/`)

**Registries:**
- npm registry — publishes `9router` CLI package (`cli/package.json`, `cli:pack`/`cli:publish` scripts in root `package.json`)
- GHCR + Docker Hub — container images (see above)

## Environment Configuration

**Core server:**
- `PORT` (default 20128), `HOSTNAME`, `NODE_ENV`, `DATA_DIR` (SQLite file + app data location), `NEXT_DIST_DIR`, `NEXT_TRACING_ROOT_MODE`, `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (default 128mb)

**Auth/security:**
- `JWT_SECRET`, `AUTH_COOKIE_SECURE`, `INITIAL_PASSWORD`, `TRUST_PROXY`, `SHUTDOWN_SECRET`, `API_KEY_SECRET`, `MACHINE_ID_SALT`, `BASE_URL` / `NEXT_PUBLIC_BASE_URL` (OIDC redirect origin)

**Outbound networking / proxy:**
- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (standard), plus 9router-managed overrides: `NINE_ROUTER_PROXY_MANAGED`, `NINE_ROUTER_PROXY_URL`, `NINE_ROUTER_NO_PROXY` (`src/lib/network/outboundProxy.js`, `open-sse/utils/proxyFetch.js`)

**Feature/integration toggles:**
- `HEADROOM_URL` (default `http://localhost:8787`), `TUNNEL_WORKER_URL` (Cloudflare quick-tunnel), `CLOUDFLARED_PROTOCOL` / `TUNNEL_TRANSPORT_PROTOCOL`, `KIMI_CODING_OAUTH_CLIENT_ID`, `KIRO_THINKING_FIELD`, `ENABLE_REQUEST_LOGS`, `ENABLE_TRANSLATOR`, `CLOUD_URL` / `NEXT_PUBLIC_CLOUD_URL`

**Observability:**
- `OBSERVABILITY_ENABLED`, `OBSERVABILITY_MAX_RECORDS`, `OBSERVABILITY_BATCH_SIZE`, `OBSERVABILITY_FLUSH_INTERVAL_MS`, `OBSERVABILITY_MAX_JSON_SIZE`, `LOG_LEVEL`, `DEBUG_MITM`, `DEBUG_KIRO_EFFORT`, `DEBUG_WIRE_BODY`

**Updater/CLI/tray (desktop-style service):**
- `UPDATER_PKG_NAME`, `UPDATER_PORT`, `UPDATER_SCRIPT_PATH`, `UPDATER_RETRIES`, `UPDATER_RETRY_DELAY_MS`, `UPDATER_LINGER_MS`, `UPDATER_WAIT_MIN_MS`, `UPDATER_WAIT_MAX_MS`, `UPDATER_WAIT_CHECK_MS`, `UPDATER_APP_PORT`, `TRAY_MODE`

**MITM proxy:**
- `MITM_ROUTER_BASE`, `ROUTER_API_KEY`, `MITM_SERVER_PATH`

**Secrets location:**
- `.env` file at repo root (present; `.env.example` documents the shape, contents not read by this analysis — see forbidden-files policy)
- Generated secrets persisted under `DATA_DIR` (e.g. `<DATA_DIR>/jwt-secret`), not committed
- Per-provider OAuth tokens and dashboard password hash stored inside the SQLite DB (`providerConnections.data`, `settings.data`), not in env vars

## Webhooks & Callbacks

**Incoming:**
- OAuth redirect callbacks (browser-driven, not server-to-server webhooks): `src/app/callback/page.js` (generic OAuth landing page), `src/app/api/auth/oidc/callback/route.js` (OIDC), plus per-provider exchange endpoints under `src/app/api/oauth/{provider}/...` and `src/app/api/oauth/kiro/social-exchange/route.js`
- No inbound webhook receivers from third-party SaaS (e.g. Stripe, GitHub App webhooks) were found

**Outgoing:**
- None found — no code pushes events to an external webhook URL; all external calls are synchronous request/response (provider chat calls, search/fetch calls, OAuth token exchanges, Cloudflare/Deno/Vercel deploy API calls)

---

*Integration audit: 2026-07-05*
