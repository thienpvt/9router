# Codebase Concerns

**Analysis Date:** 2026-07-05

## Tech Debt

**Stale historical architecture doc:**
- Issue: `docs/ARCHITECTURE.md` (dated 2026-02-06) describes a JSON-file persistence model (`db.json`, `usage.json`, `log.txt`) that no longer exists. The app migrated to a SQLite-based layer (`src/lib/db/*`); this fact is already flagged inside the current `.planning/codebase/ARCHITECTURE.md`.
- Files: `docs/ARCHITECTURE.md`
- Impact: anyone reading `docs/ARCHITECTURE.md` first gets a materially wrong mental model of persistence.
- Fix approach: delete it or replace with a pointer to `.planning/codebase/ARCHITECTURE.md`.

**Compatibility shims kept indefinitely:**
- Issue: `src/lib/localDb.js`, `src/lib/usageDb.js`, `src/models/index.js` are explicitly labeled as shims re-exporting the SQLite repo layer (`src/lib/db/*`), kept only so old imports keep working.
- Files: `src/lib/localDb.js`, `src/lib/usageDb.js`, `src/models/index.js`
- Impact: two import paths exist for the same functionality; new code can accidentally import the shim instead of `src/lib/db/index.js`, making a future removal of the shim riskier than it should be.
- Fix approach: grep for remaining shim imports outside `src/lib/db/*` and migrate them, then delete the shims in one pass.

**Oversized, hard-to-navigate files:**
- Issue: several files exceed 900-1700 lines, mixing many concerns in one module.
- Files: `src/app/(dashboard)/dashboard/providers/[id]/page.js` (1731 lines), `src/lib/oauth/providers.js` (1561 lines), `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js` (1438 lines), `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` (1295 lines), `src/app/(dashboard)/dashboard/profile/page.js` (1182 lines), `src/app/(dashboard)/dashboard/proxy-pools/page.js` (1063 lines), `open-sse/utils/cursorProtobuf.js` (904 lines), `src/mitm/manager.js` (877 lines), `src/lib/tunnel/tailscale/tailscale.js` (859 lines), `cli/src/cli/menus/providers.js` (847 lines), `cli/cli.js` (830 lines)
- Impact: harder to review changes safely, higher chance of merge conflicts and hidden coupling within a single file.
- Fix approach: split by concern (e.g., separate data-fetching/state from render in the dashboard pages; split `oauth/providers.js` per-provider).

**Dead/unused dependencies in `package.json`:**
- Issue: `express` (`^5.2.1`) and `fs` (`^0.0.1-security`) are declared as direct dependencies but have no `require`/`import` anywhere in `src/`, `open-sse/`, or `cli/`. `fs` on npm is a well-known placeholder/squat package (version literally tagged `-security`) that Node's builtin `fs` module always shadows at resolution time, so installing it from npm has no effect — its presence usually indicates someone once ran `npm install fs` by mistake, thinking they needed to add the builtin. `http-proxy-middleware` (`^3.0.5`) also has no direct source usage; it only appears inside generated `.next/` build output, consistent with being pulled in transitively by Next.js itself rather than by 9router's own code.
- Files: `package.json`
- Impact: dead weight in the dependency tree and `npm audit` noise (see Dependencies at Risk — `http-proxy-middleware` carries a high-severity advisory).
- Fix approach: remove `express` and `fs` outright; verify `http-proxy-middleware` really is unused before removing it (it may be an intentional pin for a transitive Next.js need).

**Provider-specific hardcoded guesses:**
- Issue: `KIRO_DEFAULT_PROFILE_ARNS` hardcodes two AWS CodeWhisperer profile ARNs (Builder ID / social sign-in) as shared fallbacks. Separately, the upstream model id for `claude-sonnet-5` in the Kiro registry is a static guess rather than sourced from the live model catalog the way other Kiro models are (per `.planning/debug/kiro-sonnet-5-malformed.md`, which explicitly flags this as unresolved).
- Files: `open-sse/config/kiroConstants.js:28-31`, `open-sse/providers/registry/kiro.js` (sonnet-5 entry), `open-sse/config/kiroModels.js` (live-catalog path used by other models)
- Impact: if AWS rotates/deprecates these ARNs or the `claude-sonnet-5` upstream id is simply wrong, requests fail with upstream errors that look like a 9router bug rather than a stale hardcoded value.
- Fix approach: source `claude-sonnet-5`'s upstream id from the same live catalog mechanism (`kiroModels.js`) used by the other Kiro models instead of a static registry entry.

**Inert dependency-update automation:**
- Issue: `.github/dependabot.yml` exists but its `updates:` list is empty, so it performs no actual scanning or PRs.
- Files: `.github/dependabot.yml`
- Impact: the presence of the file gives a false impression that dependency updates are automated when they are not — no automated signal exists for any of the vulnerabilities listed under "Dependencies at Risk" below.
- Fix approach: add at least one `package-ecosystem: npm` entry covering the root, `cli/`, and `tests/` manifests.

## Known Bugs

**Kiro AWS EventStream exception frames silently dropped (resolved, follow-up open):**
- Symptoms: selecting the `claude-sonnet-5` base model via the Kiro provider streamed thinking/reasoning text but no final answer, then Claude Code reported a "malformed" error at HTTP 200. Reproduced consistently; opus-4.6/4.7/4.8 were unaffected.
- Files: `open-sse/executors/kiro.js` (`parseEventFrame`, `transformEventStreamToSSE`)
- Trigger: the parser only inspected the `:event-type` AWS EventStream header; error/exception frames carry `:message-type: exception` instead and have no `:event-type`, so they fell through every handler branch and produced no chunk and no clean terminal event.
- Workaround: fixed in the current working tree — exception/error frames now surface as assistant text plus a clean synthetic finish chunk (`tests/unit/kiro-exception-frame.test.js` covers this). Full root-cause writeup: `.planning/debug/kiro-sonnet-5-malformed.md`.
- Open follow-up (unresolved): the fix makes the error visible instead of silent, but the underlying question — whether the hardcoded `claude-sonnet-5` upstream id is even correct — is explicitly called out as unverified in the resolution notes.

**`<thinking>` tag-stripping state machine assumes tags never split across frames:**
- Symptoms: if a model emits `<thinking>` inline in `assistantResponseEvent` content without a matching `</thinking>` in the same or a later frame the parser can join, all subsequent answer text for that response is dropped (state stays `inThinking` forever).
- Files: `open-sse/executors/kiro.js` (thinking-tag state machine, ~lines 181-199 per the debug doc)
- Trigger: any Kiro-routed model that formats reasoning as an inline tag rather than a dedicated `reasoningContentEvent`, where the closing tag arrives in a way the state machine doesn't reassemble correctly.
- Workaround: none currently; this is a latent risk distinct from the exception-frame bug above, noted but not exercised by a dedicated regression test for the split-across-frames case specifically.

## Security Considerations

**Default dashboard password is a well-known constant:**
- Risk: `INITIAL_PASSWORD` defaults to `"123456"` whenever unset and no password hash has been stored yet. Any deployment exposed beyond localhost (tunnel, Tailscale, reverse proxy) before the operator changes it is trivially accessible.
- Files: `src/lib/auth/dashboardSession.js:9,80`, `src/app/api/auth/login/route.js:39,51,63`, `src/app/api/settings/route.js:62-63`
- Current mitigation: login attempts are rate-limited/locked out (`src/lib/auth/loginLimiter.js`), and `mustChangePassword` is forced true when the default password is used from a non-local request (`src/app/api/auth/login/route.js:62-63`).
- Recommendations: consider refusing remote (non-local) login entirely on the default password rather than only flagging `mustChangePassword` after a successful login.

**Wildcard CORS on the entire `/v1/*` gateway surface:**
- Risk: `Access-Control-Allow-Origin: "*"` is set on essentially every gateway endpoint, allowing any origin (including malicious web pages) to call the API cross-origin from a browser if a session/API key is otherwise available to that page.
- Files: `src/app/api/health/route.js`, `src/app/api/v1/chat/completions/route.js`, `src/app/api/v1/messages/route.js`, `src/app/api/v1/responses/route.js`, `src/app/api/v1/embeddings/route.js`, `src/app/api/v1/images/generations/route.js`, `src/app/api/v1/audio/speech/route.js`, `src/app/api/v1/audio/transcriptions/route.js`, `src/app/api/v1/audio/voices/route.js`, `src/app/api/v1/models/route.js`, `src/app/api/v1/models/[kind]/route.js`, `src/app/api/v1/models/info/route.js`, `src/app/api/v1/search/route.js`, `src/app/api/v1/web/fetch/route.js`, `src/app/api/v1beta/models/route.js`, `src/app/api/v1beta/models/[...path]/route.js`, `src/app/api/v1/messages/count_tokens/route.js`, `src/app/api/v1/responses/compact/route.js`, `src/app/api/tags/route.js`, `src/app/api/v1/api/chat/route.js`
- Current mitigation: the gateway has its own bearer/API-key check (`src/sse/services/auth.js` `extractApiKey`/`isValidApiKey`), gated behind `settings.requireApiKey` — but that setting is off by default and these routes are separate from the cookie-based dashboard auth in `src/dashboardGuard.js`.
- Recommendations: this is intentional for a locally-run gateway consumed by many different CLI tools/SDKs (which is why it's wildcarded), but operators exposing 9router beyond localhost should be told explicitly to turn on `requireApiKey`.

**OAuth credentials stored unencrypted at rest:**
- Risk: `accessToken`/`refreshToken` columns in `providerConnections` are plain `TEXT`; no encryption-at-rest layer was found in the repo or connections schema.
- Files: `src/lib/db/repos/connectionsRepo.js:7,214`, `src/lib/db/schema.js`
- Current mitigation: none found beyond OS-level file permissions on the SQLite data file (`src/lib/db/paths.js`).
- Recommendations: at minimum document that the data directory must be treated as sensitive (backups, container volume mounts); consider field-level encryption for token columns if the threat model includes untrusted access to the data volume.

**In-memory, single-process login rate limiter:**
- Risk: `attempts` is a plain in-process `Map`, reset on restart, and keyed by client IP — but `getClientIp()` falls back to a single `"unknown"` bucket whenever neither `x-9r-real-ip` (set by `custom-server.js`) nor a trusted `x-forwarded-for` (gated by `TRUST_PROXY=true`) is present.
- Files: `src/lib/auth/loginLimiter.js`, `custom-server.js`
- Current mitigation: `custom-server.js` derives IP from the raw TCP socket so a direct client can't spoof `x-forwarded-for`; the lockout math itself (progressive 30s/2m/10m/30m) is reasonable for a single-instance deployment.
- Recommendations: if 9router is ever run as multiple replicas behind a shared load balancer, this limiter provides no protection across instances; call this out in deployment docs rather than assuming single-instance.

**Shell commands built via string interpolation:**
- Risk: several `execSync` calls interpolate values (`pid`, download paths, ports) directly into a shell command string rather than using an argument array.
- Files: `src/lib/appUpdater.js:26,27,31,48,69,78,147,149` (pid values, sourced from a `.mitm.pid` file via `parseInt` or regex-extracted from `tasklist`/`ps aux` output — not directly attacker-controlled today), `src/lib/tunnel/cloudflare/cloudflared.js:173,413,415` (`tar -xzf "${downloadDest}"`, PowerShell/`pkill` with an interpolated port)
- Current mitigation: current inputs are all locally-derived (parsed pids, local paths, a numeric port), not raw user/network input, so this is not an active injection vector today.
- Recommendations: prefer `execFile`/`spawn` with argument arrays (as already done correctly for the Cursor DB read in `src/app/api/oauth/cursor/auto-import/route.js:132` via `execFileAsync("sqlite3", [dbPath, sql])`) to remove the pattern rather than rely on every input staying "trusted" forever.

**Cloudflared binary downloaded and executed without integrity verification:**
- Risk: `cloudflared` is downloaded from `https://github.com/cloudflare/cloudflared/releases/latest/download` and then extracted/executed with no checksum or signature check.
- Files: `src/lib/tunnel/cloudflare/cloudflared.js` (`GITHUB_BASE_URL`, `downloadFile`, `_ensureCloudflared`)
- Current mitigation: HTTPS transport only.
- Recommendations: verify a published checksum (Cloudflare publishes SHA256SUMS for releases) before executing the downloaded binary.

**MITM root CA key generation has no confirmed permission hardening:**
- Risk: a targeted search of the MITM certificate module for permission-setting code (`chmod`, `0o600`, `mode:`) found none.
- Files: `src/mitm/cert/generate.js`, `src/mitm/cert/install.js`, `src/mitm/cert/rootCA.js`
- Current mitigation: not confirmed — this was checked via grep for permission-related calls in these three files, not a full read of every code path, so treat as "not found by search" rather than a confirmed absence.
- Recommendations: manually verify the root CA private key file is written with restrictive permissions (e.g., `0o600`) given that this CA gets installed into the OS/browser trust store and its key would let any holder mint certificates trusted by the machine.

**No CI-run test, lint, or audit gate:**
- Risk: `.github/workflows/` only contains `docker-publish.yml` and `gitbook-pages.yml`; neither runs `npm test`/`vitest`, ESLint, or `npm audit`. The ~130 test files in `tests/` and dependency vulnerabilities (below) are never checked automatically on push or PR.
- Files: `.github/workflows/docker-publish.yml`, `.github/workflows/gitbook-pages.yml`
- Current mitigation: none — verification is manual/developer-discretion only.
- Recommendations: add a workflow that runs `npm --prefix tests install && npm --prefix tests test` (and ideally `npm audit --omit=dev`) on pull requests.

**Known dependency vulnerabilities (`npm audit`):**
- Risk: `undici` 7.0.0-7.27.2 (high — includes a TLS certificate validation bypass and a cross-origin request routing issue both specifically involving SOCKS5 `ProxyAgent`/proxy pool reuse, plus header-injection and cache-poisoning CVEs); `http-proxy-middleware` 3.0.4-3.0.6 (high — CRLF injection in `fixRequestBody`); `dompurify` <=3.4.10 via `monaco-editor` (moderate — multiple XSS/prototype-pollution advisories).
- Files: `package.json` (`undici` ^7.19.2 direct dependency; `@monaco-editor/react`/`monaco-editor` direct dependencies pull in `dompurify`; `http-proxy-middleware` likely unused per Tech Debt above)
- Current mitigation: none applied yet.
- Recommendations: `undici` has a non-breaking fix via `npm audit fix` — apply it, and treat it as higher priority than the others because 9router's core outbound-request path (`open-sse/executors/base.js` via `proxyAwareFetch`) and its user-facing SOCKS5 outbound-proxy feature (`socks-proxy-agent`, `src/lib/network/outboundProxy.js`) are exactly the code paths the SOCKS5-related undici CVEs affect. `http-proxy-middleware`'s fix is also non-breaking, but removing the apparently-unused dependency is cleaner. `dompurify`'s only available fix downgrades `monaco-editor` to `0.53.0` (a breaking change per `npm audit fix --force` output) — needs manual verification of the in-dashboard JSON editor before applying.

## Performance Bottlenecks

**Pure-JS/WASM SQLite fallback:**
- Problem: when neither Bun's native `bun:sqlite`, the optional native `better-sqlite3`, nor Node's built-in `node:sqlite` (Node ≥22.5 only) is available, all persistence falls back to `sql.js`, a WASM/pure-JS SQLite implementation.
- Files: `src/lib/db/driver.js`
- Cause: `better-sqlite3` is deliberately an `optionalDependency` so installs without native build tools still succeed (per `package.json`'s own `comment_better_sqlite3`), which means the slow fallback is reachable in normal operation, not just a theoretical path.
- Improvement path: surface a startup warning (beyond the existing `console.warn` per failed driver attempt) when the final fallback to `sql.js` is reached, so operators know to install build tools rather than silently running the slowest driver indefinitely.

**Unbounded `usageHistory` growth:**
- Problem: `requestDetails` is actively pruned (`DELETE FROM requestDetails WHERE id IN (... ORDER BY timestamp ASC LIMIT ?)` against a `config.maxRecords` ceiling), but no equivalent `DELETE`/retention logic exists for `usageHistory` — it grows forever.
- Files: `src/lib/db/repos/requestDetailsRepo.js:109-113` (has pruning), `src/lib/db/repos/usageRepo.js` (no pruning found), `src/lib/db/schema.js` (both tables' index definitions)
- Cause: asymmetric retention design — one sibling table got a pruning pass, the other didn't.
- Improvement path: add the same `maxRecords`-style pruning to `usageHistory`, or an explicit time-based retention policy, since this table backs usage/cost dashboards that are likely queried often as it grows.

**Unbounded debug/request log files:**
- Problem: when `ENABLE_REQUEST_LOGS` is turned on, `open-sse/utils/requestLogger.js` writes raw request/response dumps under `logs/` with no rotation or size cap found.
- Files: `open-sse/utils/requestLogger.js`
- Cause: no rotation/max-size/cleanup logic present.
- Improvement path: add size-based rotation or a max-age cleanup sweep; low priority since this is opt-in and gitignored (`logs/*`), but a long-running deployment with it enabled for debugging could otherwise fill disk unnoticed.

## Fragile Areas

**Kiro executor's hand-rolled AWS EventStream parser:**
- Files: `open-sse/executors/kiro.js` (665 lines)
- Why fragile: implements AWS's binary EventStream framing (`:event-type`/`:message-type` headers) from scratch with no official SDK, plus a separate `<thinking>` tag-stripping state machine layered on top of it. Both have already produced one confirmed production bug (dropped exception frames, see Known Bugs) and the tag-stripping state machine has a known-but-unfixed split-across-frames edge case.
- Safe modification: any change to frame/header handling should be validated against a captured raw-byte fixture for both a "normal" and an "error mid-stream" response, not just against translated JSON output.
- Test coverage: `tests/unit/kiro-exception-frame.test.js` (2 cases) covers the fixed bug; no test specifically exercises a `<thinking>` tag split across multiple frames.

**OpenAI-pivot translation fallback is lossy by design:**
- Files: `open-sse/translator/index.js` (`translateRequest`/`translateResponse` pivot logic)
- Why fragile: any `source:target` format pair without a registered direct route silently pivots through OpenAI as an intermediate format — which the codebase's own architecture notes describe as lossy for thinking blocks, non-base64 images, tool-call ids, and `is_error`. Adding a new client format or provider format without also adding the relevant direct routes reintroduces this silently (no error is raised — it just degrades fidelity).
- Safe modification: when adding a new format pair that carries thinking/vision/tool-call data, check whether a direct `<from>-to-<to>.js` converter is needed rather than assuming the OpenAI pivot is "good enough."
- Test coverage: `tests/translator/` has golden/snapshot tests per direct route, but there's no generic test asserting which pairs are pivot-only vs. direct, so a newly-introduced lossy pivot wouldn't automatically fail a test.

**RTK/Headroom compression middleware is fail-open by contractual design:**
- Files: `open-sse/rtk/index.js:83,113`, `open-sse/rtk/headroom.js`, `open-sse/rtk/applyFilter.js`
- Why fragile: every internal error in these modules is caught and swallowed (return `null`/leave the body untouched) so a compression bug can never break a chat request — but this also means a logic bug in compression is invisible except as a request that mysteriously wasn't compressed (or, in a worse case, was subtly mismodified without an exception ever firing).
- Safe modification: when changing compression logic, add explicit unit tests for the transformed output, since a broken transform that still returns *something* won't be caught by the fail-open guarantee.
- Test coverage: `tests/unit/rtk.e2e.test.js`, `tests/unit/rtk.multi-provider.e2e.test.js` exist, but per-filter unit coverage in `open-sse/rtk/filters/*` is not verified as part of this analysis.

**Hand-rolled Cursor protobuf codec:**
- Files: `open-sse/utils/cursorProtobuf.js` (904 lines)
- Why fragile: a large binary-protocol encoder/decoder with no `.proto` schema file found alongside it — any upstream Cursor wire-format change requires manually re-deriving the byte layout.
- Safe modification: capture and diff raw request/response bytes against a known-good fixture before and after any change here.
- Test coverage: not verified in this pass beyond confirming the file's size and lack of a companion schema file.

**Broad pattern — 90+ independently fragile provider integrations:**
- Files: `open-sse/providers/registry/*.js` (98 files), `open-sse/executors/*.js`
- Why fragile: recent commit history shows a steady stream of narrow, reactive provider-specific fixes (`fix(kiro)`, `fix(antigravity)`, `fix(gemini)`, `fix(codebuddy-cn)`, `fix(kimchi)`, `fix(xiaomi-tokenplan)`, `fix(claude)`, `feat(nvidia)`, etc. — over 20 of the last 40 commits touch a single named provider), indicating each upstream API drifts independently and is only caught after it breaks something.
- Safe modification: N/A at the pattern level — this is a structural characteristic of proxying 90+ third-party APIs, not a single fixable bug. Worth knowing when estimating the ongoing maintenance cost of adding providers.
- Test coverage: `tests/unit/bugs-*.test.js` and `tests/unit/<provider>.test.js` files exist per historically-broken provider, i.e., coverage grows reactively after each incident rather than proactively.

## Scaling Limits

**SQLite single-writer constraint:**
- Current capacity: fine for the intended single-instance, local-first deployment model.
- Limit: concurrent writes (usage logging, request-detail logging, credential refresh persistence) from many simultaneous streaming requests — amplified by account-fallback loops and combo/fusion multi-model requests that can multiply the number of in-flight upstream calls per client request — all funnel through one SQLite file. Not benchmarked in this analysis.
- Scaling path: none needed for the documented use case (self-hosted, single instance); would require migrating to a networked DB if ever run as multiple replicas behind a shared frontend.

**In-memory rate-limit/session state:**
- Current capacity: correct for exactly one running process.
- Limit: does not share lockout state across processes/replicas; see Security Considerations above.
- Scaling path: would need an external store (Redis, shared DB table) if horizontal scaling is ever supported.

**Unbounded `usageHistory` table:**
- Current capacity: fine at current scale; indexed on `timestamp`, `provider`, `model`, `connectionId` (`src/lib/db/schema.js`).
- Limit: no ceiling — file size and backup/restore time grow indefinitely for long-running installs with high request volume.
- Scaling path: add retention/pruning as noted under Performance Bottlenecks.

## Dependencies at Risk

**`undici` (^7.19.2):**
- Risk: high-severity CVEs including a TLS certificate validation bypass and cross-origin request routing via SOCKS5 `ProxyAgent` reuse, plus header-injection and cache-poisoning issues.
- Impact: directly affects 9router's outbound provider request path (`open-sse/executors/base.js`, `open-sse/utils/proxyFetch.js`) and its user-facing SOCKS5 outbound-proxy feature — not just an incidental transitive dependency.
- Migration plan: `npm audit fix` (non-breaking per audit output) — apply and re-test outbound proxy behavior.

**`http-proxy-middleware` (^3.0.5):**
- Risk: high-severity CRLF injection in `fixRequestBody`.
- Impact: appears unused by 9router's own source (see Tech Debt) — likely zero runtime exposure, but still flagged by every audit run.
- Migration plan: confirm it's genuinely unused, then remove; otherwise apply the non-breaking `npm audit fix`.

**`dompurify` (transitive via `monaco-editor`):**
- Risk: moderate-severity XSS/prototype-pollution advisory chain (multiple CVEs).
- Impact: affects the in-dashboard Monaco JSON editor (`@monaco-editor/react`).
- Migration plan: only fix available is `npm audit fix --force`, which downgrades `monaco-editor` to `0.53.0` (breaking) — needs manual verification of editor functionality before adopting.

**`postcss` <8.5.10 (transitive via Next.js's own bundled copy):**
- Risk: moderate XSS in CSS stringification output.
- Impact: this is inside `node_modules/next/node_modules/postcss`, not the root project's own `postcss` devDependency (`^8.5.6`, which already resolves above the vulnerable range) — only reachable by upgrading Next.js's internal copy.
- Migration plan: `npm audit`'s suggested fix ("install next@9.3.3") is a clearly wrong-directioned artifact of its resolver and should not be followed; wait for an upstream Next.js patch release, or add a `package.json` `overrides` entry pinning `postcss` for the nested copy.

**`express` (^5.2.1) and `fs` (^0.0.1-security):**
- Risk: none functionally (both appear unused), but they add audit noise and dependency-tree confusion — `fs` in particular is a widely-flagged npm squat package.
- Impact: none observed; hygiene concern only.
- Migration plan: remove both after confirming no indirect usage.

## Missing Critical Features

**No centralized error tracking/observability:**
- Problem: no Sentry/Datadog/New Relic/OpenTelemetry or similar found in `package.json`; the only signals are structured console logging (`src/sse/utils/logger.js`) and opt-in file-based request/wire logs (`open-sse/utils/requestLogger.js`, `open-sse/utils/debugLog.js`).
- Blocks: for a gateway proxying 90+ providers with per-provider quirks, production issues (like the Kiro exception-frame bug) currently surface only via user reports or manual log inspection rather than an aggregated error signal, making regressions on any single provider hard to detect proactively.

**No automated CI test/audit gate:**
- Problem: covered under Security Considerations — restated here because it also blocks catching *non-security* regressions (translator/executor bugs) automatically.
- Blocks: confidence that a change hasn't broken an existing provider integration before it reaches a release tag.

## Test Coverage Gaps

**Auth/lockout logic has no direct unit test:**
- What's not tested: `src/lib/auth/loginLimiter.js`'s actual lockout math (progressive delays, window reset) and `src/lib/auth/dashboardSession.js`'s token issuance/verification are not exercised directly.
- Files: `src/lib/auth/loginLimiter.js`, `src/lib/auth/dashboardSession.js`; the only related test, `tests/unit/dashboard-guard.test.js`, mocks out `getSettings`/`validateApiKey`/`verifyDashboardAuthToken` entirely rather than exercising the real logic.
- Risk: a change to lockout timing or JWT verification could silently weaken dashboard auth without any test failing.
- Priority: High — this is the primary defense against the default-password issue noted above.

**CLI package (`cli/`) has zero test files:**
- What's not tested: process start/stop, tray icon management, and the native-dependency postinstall logic (`cli/hooks/postinstall.js`).
- Files: `cli/` (confirmed no `*test*`-named files anywhere in the package)
- Risk: regressions in process lifecycle management or postinstall native-module handling (SQLite/tray deps) would only be caught manually.
- Priority: Medium.

**MITM subsystem has no test files:**
- What's not tested: TLS interception, root CA generation/installation, and per-tool traffic handlers (`src/mitm/handlers/antigravity.js`, `copilot.js`, `cursor.js`, `kiro.js`).
- Files: `src/mitm/*` (no matching files under `tests/` found for "mitm")
- Risk: this is a high-blast-radius subsystem (it installs a trusted root CA and intercepts TLS traffic for other applications) running with no automated verification.
- Priority: High, given the trust-store/certificate risk described under Security Considerations.

**No CI-enforced test run at all:**
- What's not tested: nothing in `tests/` (130 files) is guaranteed to run before a merge or release — see "No CI-run test, lint, or audit gate" above.
- Files: `.github/workflows/*`
- Risk: any of the specific gaps above (or a regression in an area that does have tests) can reach `master`/a release tag without being run.
- Priority: High — this is the gap that makes every other test-coverage gap in this document harder to close with confidence over time.

---

*Concerns audit: 2026-07-05*
