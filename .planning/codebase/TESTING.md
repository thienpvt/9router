# Testing Patterns

**Analysis Date:** 2026-07-05

## Test Framework

**Runner:**
- Vitest ^4.0.0, declared in the standalone `tests/package.json` — deliberately not in the root `package.json`, installed separately because of npm workspace hoisting from the root Next.js project (see `tests/README.md`)
- Config: `tests/vitest.config.js`

**Assertion Library:**
- Vitest's built-in `expect` (Jest/Chai-compatible API) — no separate assertion library added

**Run Commands:**
```bash
cd tests/
npm test                      # vitest run --reporter=verbose
npm run test:watch            # vitest --reporter=verbose (watch mode)

# If vitest isn't installed/hoisted locally (per tests/README.md):
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose

# Opt-in real-network smoke tests (hits live provider APIs with stored credentials):
RUN_REAL=1 npx vitest run "tests/translator/real/"
REAL_PROVIDERS=kiro,codex,antigravity RUN_REAL=1 npx vitest run "tests/translator/real/"  # filter to specific providers
```
No coverage tool or threshold is configured anywhere in the repo — checked `tests/package.json`, root `package.json`, `cli/package.json`; none reference `coverage`.

## Test File Organization

**Location:**
- All tests live under the standalone `tests/` directory at the repo root — never co-located with source files.

**Naming:**
- `<subject>.test.js` — standard unit/integration test
- `<subject>.real.test.js` — hits real provider networks, gated by `RUN_REAL=1`
- `<subject>.e2e.test.js` — exercises a full flow across multiple layers within the test process — `tests/unit/rtk.e2e.test.js`, `tests/unit/rtk.multi-provider.e2e.test.js`, `tests/translator/real/nvidia-thinking.e2e.test.js`

**Structure:**
```
tests/
├── vitest.config.js          # aliases "open-sse" and "@/" back to repo-root open-sse/ and src/
├── package.json              # standalone package, own vitest devDependency + node_modules
├── README.md                 # setup instructions, coverage summary for the embeddings suite
├── unit/                      # ~75 flat *.test.js files, one per feature/bugfix area
└── translator/
    ├── registerAll.js         # side-effect imports every translator module (register() calls) for ESM/vitest
    ├── matrix.js               # data-driven matrix built from PROVIDER_MODELS config
    ├── golden-request.test.js         # P0 snapshot: translateRequest() output body
    ├── golden-response-stream.test.js # P0 snapshot: translateResponse() streamed chunks
    ├── golden-url-header.test.js
    ├── golden-translator-concerns.test.js
    ├── bugs-*.test.js          # regression test per real bug, one file per client (Claude Code, Codex CLI, Gemini/Cursor, OpenAI bridge, Antigravity, toClaude context)
    ├── coverage-all-models.test.js
    ├── format-roundtrip.test.js
    ├── __snapshots__/          # vitest snapshot files for golden-*.test.js
    └── real/                   # RUN_REAL=1-gated tests against live provider APIs
```

**Vitest config** (`tests/vitest.config.js`):
```js
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    maxConcurrency: 60, // real provider smoke runs ~50 providers in parallel via it.concurrent
  },
  resolve: {
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
```
The `.claude/**` exclusion specifically skips nested git worktrees, which carry copies of test files but lack an installed `node_modules` — including them would break provider-import collection.

## Test Structure

**Suite Organization** (actual pattern, `tests/unit/provider-validation.test.js`):
```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Provider Validation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("OpenAI Compatible", () => {
    it("should return valid:true when /models succeeds", async () => {
      // ...
    });
  });
});
```
- One top-level `describe` per file, matching the filename's subject; nested `describe` blocks group by scenario or provider within that file
- `it("should ...")` phrasing is the norm across the suite

**Patterns:**
- Setup: `beforeEach(() => { vi.clearAllMocks(); })` at minimum; suites touching cached module state also call `vi.resetModules()` (`tests/unit/codex-refresh-token.test.js`)
- Teardown: `afterEach(() => { global.fetch = originalFetch; })` to restore any global stubbed during the suite
- Assertion style: `expect(x).toBe(...)`, `.toEqual(...)`, and `.toHaveBeenCalledWith(expect.objectContaining({...}))` for partial-match header/body assertions

## Mocking

**Framework:** Vitest's built-in `vi` — no separate mocking library (no Sinon, no MSW)

**Patterns:**
- **Global fetch stubbing** — the dominant pattern for anything crossing a network boundary:
```js
const originalFetch = global.fetch;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { global.fetch = originalFetch; });

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) });
```
(`tests/unit/provider-validation.test.js`, `tests/unit/codex-refresh-token.test.js`)

- **Module mocking + dynamic import** — used when the module under test needs a fresh instance after the mock is registered:
```js
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");
```
(`tests/unit/base-executor-retry.test.js`) — `vi.mock` is declared, then the module under test is loaded via a top-level `await import(...)` so the mock is already in place.

- **Sequential response scripting** to drive retry/fallback logic deterministically:
```js
fetchMock
  .mockResolvedValueOnce(res(502))
  .mockResolvedValueOnce(res(502))
  .mockResolvedValueOnce(res(200));
```

**What to Mock:**
- The network boundary (`global.fetch`) — mocked in essentially every file under `tests/unit/`
- Specific utility modules with side effects (e.g. `open-sse/utils/proxyFetch.js`) when isolating a single caller

**What NOT to Mock:**
- Pure translation/config logic (`open-sse/translator/*`, `open-sse/config/*`) — exercised directly, unmocked, since these are pure functions over plain objects
- `tests/translator/real/*.real.test.js` and `*.e2e.test.js` intentionally skip mocking and hit real provider APIs using real stored local credentials, gated behind `RUN_REAL=1` so they never run during a normal `vitest run` — see the header comment in `tests/translator/real/smoke-providers.real.test.js`

## Fixtures and Factories

**Test Data:**
- No shared fixtures directory exists (`tests/**/fixtures/`, `tests/**/mocks/` are absent) — test data is built inline per file with small local factory functions:
```js
// tests/unit/base-executor-retry.test.js
function res(status) {
  return { status, headers: { get: () => "" } };
}
function makeExec(config) {
  return new BaseExecutor("test", config);
}
```
- `tests/translator/matrix.js` is the one shared data-driven fixture in the suite: it derives a full `{ alias, providerId, modelId, type, targetFormat, strip, upstreamId }` matrix directly from the production `PROVIDER_MODELS` config (`open-sse/config/providerModels.js`), so adding a provider/model to config automatically extends test coverage with no test edits required.
- `tests/translator/registerAll.js` is a shared setup import (not data) — eagerly imports every translator module purely for its `register()` side effect, because the production entry point (`open-sse/translator/index.js`) lazily uses `require()`, which no-ops under Vitest's ESM runtime.

**Location:**
- Inline at the top of each test file — there is no separate fixtures directory to add to.

## Coverage

**Requirements:** None enforced — no coverage tool is configured, no threshold exists in any config file.

**View Coverage:**
Not applicable in the current setup. To add it: add `@vitest/coverage-v8` to `tests/package.json` devDependencies and a `coverage` block to the `test` section of `tests/vitest.config.js`, then run `vitest run --coverage`.

## Test Types

**Unit Tests:**
- `tests/unit/*.test.js` (~75 files) — one file per feature area or bugfix (executors, token refresh, DB adapters/migrations, capabilities config, provider routing, translator helpers, OAuth flows). Mocks the network boundary; exercises the real production module otherwise.

**Integration Tests:**
- `tests/translator/*.test.js` — exercise the full `translateRequest`/`translateResponse` pipeline across format pairs (OpenAI ↔ Claude ↔ Gemini ↔ Kiro, etc.) via `registerAll.js`. Includes golden snapshot tests (`golden-*.test.js`) and one regression test file per real bug encountered (`bugs-*.test.js`).
- `tests/unit/rtk.e2e.test.js`, `rtk.multi-provider.e2e.test.js` — exercise the routing/token-refresh/kiro (RTK) flow end-to-end within the test process, network still mocked.

**E2E Tests:**
- `tests/translator/real/*.real.test.js` — real network calls to live provider APIs using stored local credentials from the local DB, opt-in via `RUN_REAL=1`. `smoke-providers.real.test.js` iterates every provider that has an active credential and sends a tiny prompt through the full production `handleChatCore` path; providers without a credential or an LLM model are skipped automatically.

## Common Patterns

**Async Testing:**
```js
it("should refresh Codex credentials and preserve omitted id_token", async () => {
  mockFetchWithJson({ access_token: "new-access", refresh_token: "rotated-refresh-token", expires_in: 3600 });
  const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
  const executor = new CodexExecutor();
  const result = await executor.refreshCredentials({ connectionId: "codex-1", refreshToken: "old-refresh-token" }, null);
  expect(result.accessToken).toBe("new-access");
});
```
(`tests/unit/codex-refresh-token.test.js`) — plain `async`/`await`, `expect` runs after the awaited call resolves; no `done` callbacks or manual promise chains anywhere in the suite.

**Snapshot Testing** (golden tests, `tests/translator/golden-request.test.js`):
```js
function clean(body) {
  const s = JSON.stringify(body, (k, v) => {
    if (k === "_toolNameMap" || k === "conversationId") return undefined;
    return v;
  }).replace(/Current time is [^"\\]+/g, "Current time is <TS>");
  return JSON.parse(s);
}

it("full body (system/image/tool/tool_result)", () => {
  const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-opus-4-6", baseBody(), true, { apiKey: "sk-x" }, "claude");
  expect(clean(out)).toMatchSnapshot();
});
```
Volatile fields (timestamps, generated conversation IDs) are stripped or normalized by a local `clean()`/`stripVolatile()` helper before `toMatchSnapshot()` — required in every golden test because production output embeds `Date.now()`-based IDs and UUIDs. See `stripVolatile()` in `tests/translator/golden-response-stream.test.js` for the streaming-response variant, which additionally normalizes provider-specific streamed `id` formats (Gemini, Kiro/Ollama, tool-call IDs) via regex substitution.

**Error Testing:**
```js
it("throws when the only url fails with network error and no retries left", async () => {
  fetchMock.mockImplementationOnce(async () => { throw new Error("boom"); });
  let thrown = null;
  try {
    await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
  } catch (e) {
    thrown = e;
  }
  expect(thrown?.message).toBe("boom");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```
(`tests/unit/base-executor-retry.test.js`) — explicit try/catch capturing the thrown error into a variable, used when additional assertions (call counts, response shape) are needed alongside the error itself. Simpler cases elsewhere in the suite use `expect(() => fn()).toThrow()` for synchronous throws.

---

*Testing analysis: 2026-07-05*
