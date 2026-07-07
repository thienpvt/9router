# Technology Stack

**Analysis Date:** 2026-07-05

## Languages

**Primary:**
- JavaScript (ES2022+, mixed ESM/CommonJS) - entire codebase: Next.js dashboard/API (`src/`), provider-agnostic proxy engine (`open-sse/`), CLI (`cli/`)

**Secondary:**
- Shell script - `start.sh` (container entrypoint helper)
- No TypeScript: `jsconfig.json` provides path aliases only (`@/*` → `src/*`, `open-sse` → `open-sse/`); no `tsconfig.json`, no type-checking step

## Runtime

**Environment:**
- Node.js >=18 (`cli/package.json` `engines.node`); `Dockerfile` pins `node:22-alpine`
- Bun supported as an alternate runtime (dual-runtime design): `dev:bun` / `build:bun` / `start:bun` scripts in `package.json`; `src/lib/db/adapters/bunSqliteAdapter.js`; `src/lib/db/driver.js` branches on `process.versions.bun`

**Package Manager:**
- npm (root `package-lock.json`, 328.6K; no yarn.lock/pnpm-lock)
- Multiple independent packages in one repo, each with its own `package.json`: root app (`9router-app`, private), `cli/` (published as `9router`), `tests/` (`9router-tests`), `gitbook/` (docs site)

## Frameworks

**Core:**
- Next.js ^16.1.6 - dashboard UI + API routes, App Router (`src/app/`), standalone output (`next.config.mjs`: `output: "standalone"`)
- React 19.2.4 / React DOM 19.2.4 - UI layer (root app); `cli/package.json` pins React 19.2.1 for its own tray/setup UI
- Zustand ^5.0.10 - client-side state (`src/store/`: `providerStore.js`, `settingsStore.js`, `userStore.js`, `themeStore.js`, `notificationStore.js`, `headerSearchStore.js`)

**Testing:**
- Vitest ^4.0.0 - declared in the standalone `tests/package.json` (not root `package.json`), config at `tests/vitest.config.js`; aliases `open-sse` and `@/` back to the root `open-sse/` and `src/` directories
- Test layout: `tests/unit/`, `tests/translator/`, `tests/__baseline__/`

**Build/Dev:**
- ESLint 9 + `eslint-config-next` 16.1.6, flat config `eslint.config.mjs`
- Tailwind CSS ^4 + `@tailwindcss/postcss` ^4.1.18, `postcss.config.mjs`
- esbuild ^0.25.12 - bundles the CLI (`cli/package.json` devDependency, `cli/scripts/build-cli.js`)
- nodemon ^3.1.14 - CLI dev watch mode (`cli/package.json` `dev` script)

## Key Dependencies

**Critical:**
- `undici` ^7.19.2 - HTTP client underlying outbound provider requests
- `jose` ^6.1.3 - JWT signing/verification and remote JWKS (dashboard sessions, OIDC SSO) - `src/lib/auth/dashboardSession.js`, `src/lib/auth/oidc.js`
- `bcryptjs` ^3.0.3 - dashboard password hashing
- `sql.js` ^1.14.1 (regular dependency) + `better-sqlite3` ^12.6.2 (optionalDependency) - dual SQLite driver strategy, see INTEGRATIONS.md
- `node-forge` ^1.3.3 + `selfsigned` ^5.5.0 - local root CA + cert generation for the MITM proxy (`src/mitm/cert`)
- `socks-proxy-agent` ^8.0.5 - SOCKS5 outbound proxy support (`src/lib/network/outboundProxy.js`)
- `http-proxy-middleware` ^3.0.5 - proxying support
- `express` ^5.2.1 - listed as a dependency; no direct `require`/`import` found in `src/`, `open-sse/`, or `cli/` during this scan (not observed as actively wired into the request path)
- `node-machine-id` ^1.1.12 - machine fingerprinting (`src/shared/utils/machineId.js`)

**Infrastructure:**
- `@monaco-editor/react` + `monaco-editor` - in-dashboard code editor (JSON config editing)
- `@xyflow/react` - node-graph UI (provider-nodes visual editor)
- `@dnd-kit/core|modifiers|sortable|utilities` - drag-and-drop (dashboard list/priority reordering)
- `recharts` ^3.7.0 - usage/cost charts
- `@next/third-parties` - Google Analytics wrapper (`src/app/layout.js`)
- `uuid` ^13.0.0, `confbox` ^0.2.4, `marked` ^18.0.1 (markdown rendering), `react-is`
- CLI-only: `ora` ^9.1.0 (spinners), `open` ^11.0.0 (opens browser), `enquirer` ^2.4.1 (CLI prompts, `cli/package.json`)

## Configuration

**Environment:**
- `.env` / `.env.example` present at repo root (existence confirmed; contents not read)
- Env vars fan out across core server, auth, outbound proxying, and feature/debug toggles - full inventory in `INTEGRATIONS.md` under "Environment Configuration"

**Build:**
- `next.config.mjs` - standalone output; `serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite"]`; rewrites `/v1/*` → `/api/v1/*`, `/codex/*` → `/api/v1/responses`, `/v1beta/*` → `/api/v1beta/*`; env-tunable `proxyClientMaxBodySize` (default 128mb, for large tool payloads/base64 images) and `outputFileTracingRoot` (workspace mode for CLI bundling vs Docker mode)
- `jsconfig.json` - path aliases `@/*` → `src/*`, `open-sse`/`open-sse/*` → `open-sse/`
- `custom-server.js` - wraps Next's standalone `http.createServer`; derives client IP from the raw TCP socket and strips/re-derives `x-forwarded-for`/`x-real-ip` so downstream rate-limiting can't be spoofed by a direct client (only trusts forwarding headers when the TCP peer is a loopback reverse proxy)

## Platform Requirements

**Development:**
- Node >=18 (Bun as an alternative)
- `cp .env.example .env && npm install && npm run dev` (per `README.md`); default dashboard/API port `20128`

**Production:**
- Docker (multi-stage `Dockerfile`, `node:22-alpine`, non-root `node` user, `/app/data` volume) - published to GHCR (`ghcr.io/<repo>`) and Docker Hub (`decolua/9router`) for `linux/amd64` + `linux/arm64` via `.github/workflows/docker-publish.yml`
- `docker-compose.yml` - self-host stack pairing the app with a `headroom` sidecar container
- Global npm CLI (`npm install -g 9router`, published from `cli/`) - runs the same server locally as a desktop-style background service with a system tray (macOS/Linux via lazy-installed `systray2`; Windows via native PowerShell NotifyIcon)
- Separate static docs site `gitbook/` (own Next.js app + `package.json`) deployed to GitHub Pages via `.github/workflows/gitbook-pages.yml`

---

*Stack analysis: 2026-07-05*
