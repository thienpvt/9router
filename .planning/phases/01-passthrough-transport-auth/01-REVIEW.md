---
phase: 01-passthrough-transport-auth
reviewed: 2026-07-07T00:00:00Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - open-sse/providers/registry/ollama.js
  - open-sse/providers/registry/ollama-local.js
  - open-sse/executors/ollama-local.js
  - tests/unit/ollama-claude-transport.test.js
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-07
**Depth:** deep
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 1 wires a `transports[]` claude-format entry onto the `ollama` and `ollama-local` provider registries (mirroring the GLM template) and generalizes `OllamaLocalExecutor.buildUrl` to honor `credentials.runtimeTransport.baseUrl` with host substitution via `resolveOllamaLocalHost`. The fallback path (`/api/chat`) is preserved byte-identical, and `resolveTransport` correctly returns `null` for the openai sourceFormat, leaving the default `transport` object untouched. The inherited `DefaultExecutor.buildHeaders` (default.js:163-169) does apply `rt.auth` + `rt.headers` for ollama-local — the inheritance path is sound.

The deep trace cross-file confirms the wiring is correct for the current registry entries: `chatCore.js:51-53` sets `credentials.runtimeTransport` from `resolveTransport`, `buildHeaders` reads `rt` first (default.js:164), and `buildUrl` override reads `rt.baseUrl` first. No bugs in the happy path.

The findings below are latent robustness defects in the `buildUrl` override — all stem from the override re-implementing URL handling with `new URL(...).pathname` instead of reusing the parent's verbatim-string logic. None fire against the current committed registry entries, but the override diverges from the GLM/parent contract and will silently break if a future transport entry adds `urlSuffix` or a query string.

## Warnings

### WR-01: `new URL(rt.baseUrl)` throws uncaught TypeError on malformed/relative/empty baseUrl

**File:** `open-sse/executors/ollama-local.js:12`
**Issue:** The override calls `new URL(rt.baseUrl).pathname` without a try/catch. `new URL()` throws `TypeError: Invalid URL` for empty strings, relative paths (e.g. `/v1/messages`), or `undefined`. The parent `DefaultExecutor.buildUrl` (default.js:120-123) uses `rt.baseUrl` verbatim and never parses it — it cannot crash on a malformed entry. If a future transport entry omits the host (matching the xiaomi-tokenplan pattern at `xiaomi-tokenplan.js:40-50` where `baseUrl` is intentionally absent and resolved in the executor), or a registry edit lands a relative path, this executor throws an uncaught exception out of `BaseExecutor.execute` (base.js:127) and the request dies with a 500 instead of a graceful upstream error.
**Fix:**
```javascript
buildUrl(model, stream, urlIndex = 0, credentials = null) {
  const rt = credentials?.runtimeTransport;
  if (rt?.baseUrl) {
    try {
      return `${resolveOllamaLocalHost(credentials)}${new URL(rt.baseUrl).pathname}`;
    } catch {
      return rt.baseUrl; // fall back to verbatim like the parent
    }
  }
  return `${resolveOllamaLocalHost(credentials)}/api/chat`;
}
```

### WR-02: Override drops `rt.urlSuffix` — diverges from parent contract

**File:** `open-sse/executors/ollama-local.js:12`
**Issue:** The parent `DefaultExecutor.buildUrl` (default.js:122) appends `rt.urlSuffix`: `return rt.urlSuffix ? \`${rt.baseUrl}${rt.urlSuffix}\` : rt.baseUrl;`. The override uses only `new URL(rt.baseUrl).pathname` and silently discards any `urlSuffix`. The GLM claude transport (glm.js:42) and the kimi/minimax transports all declare `urlSuffix: "?beta=true"` on their claude entries. If a future edit adds `urlSuffix` to the ollama claude transport (following the established pattern), this executor will silently drop it. The current ollama transports have no `urlSuffix`, so this is latent — but the override does not preserve the parent's contract.
**Fix:**
```javascript
buildUrl(model, stream, urlIndex = 0, credentials = null) {
  const rt = credentials?.runtimeTransport;
  if (rt?.baseUrl) {
    const path = new URL(rt.baseUrl).pathname;
    const url = `${resolveOllamaLocalHost(credentials)}${path}`;
    return rt.urlSuffix ? `${url}${rt.urlSuffix}` : url;
  }
  return `${resolveOllamaLocalHost(credentials)}/api/chat`;
}
```

### WR-03: `new URL(...).pathname` strips query string from baseUrl

**File:** `open-sse/executors/ollama-local.js:12`
**Issue:** `new URL("http://h/v1/messages?beta=true").pathname` yields `/v1/messages` — the `?beta=true` query is discarded. The parent's verbatim-string approach (default.js:122) preserves any query embedded in `baseUrl`. If a transport entry ever carries its query inline in `baseUrl` rather than via the separate `urlSuffix` field, this override silently drops it. Combined with WR-02, the override is lossy against any non-trivial URL shape.
**Fix:** Same as WR-02 — prefer the parent's verbatim approach, or reconstruct from `new URL()` parts including `.search`.

## Info

### IN-01: `x-api-key: "undefined"` sent to localhost when no key configured

**File:** `open-sse/providers/registry/ollama-local.js:26` (via `default.js:29` `applyAuth`)
**Issue:** The claude transport declares `auth: { combined: true, header: "x-api-key", scheme: "raw" }`. `applyAuth` (default.js:27-31) for `combined: true` always sets the header — `setAuth(headers, desc, credentials.apiKey || credentials.accessToken)` — so when ollama-local has no apiKey (the validate route at `src/app/api/providers/route.js:119` explicitly allows `provider === "ollama-local"` without one), the header value becomes the string `"undefined"`. Local Ollama ignores unknown headers, so this is functionally harmless, but it is sloppy and differs from the GLM cloud precedent where a key is always present. Not a leak (localhost only), but worth a guard.
**Fix:** In `applyAuth`, skip the header when the resolved token is falsy:
```javascript
function applyAuth(headers, desc, credentials) {
  if (desc.combined) {
    const token = credentials.apiKey || credentials.accessToken;
    if (token) setAuth(headers, desc, token);
    // ... rest unchanged
  }
}
```
Note: this would change legacy behavior for other `combined` providers — verify before changing the shared function. The narrower fix is to omit `auth` from the ollama-local claude transport and let the noAuth path handle it.

### IN-02: Test fallback case passes `null` credentials instead of realistic `{}`
**File:** `tests/unit/ollama-claude-transport.test.js:44-46`
**Issue:** Contract C fallback calls `exec.buildUrl("", true, 0, null)`. In the real flow, `chatCore.js:53` only sets `credentials.runtimeTransport` when `runtimeTransport` is truthy — when sourceFormat is openai, `resolveTransport` returns null and `credentials.runtimeTransport` stays `undefined`, but `credentials` itself is an object. Passing `null` exercises the same code path (`credentials?.runtimeTransport` → undefined), but a more faithful test would pass `{}` to confirm the optional-chaining holds against a real credentials object. Minor.
**Fix:** `expect(exec.buildUrl("", true, 0, {})).toBe("http://localhost:11434/api/chat");`

### IN-03: Test does not cover header application or translation skip
**File:** `tests/unit/ollama-claude-transport.test.js`
**Issue:** The test file is named "Phase 1: Claude passthrough transport" but covers only `resolveTransport` + `buildUrl`. It does not assert that `buildHeaders` applies `rt.auth` + `rt.headers` (the inherited `DefaultExecutor.buildHeaders` at default.js:163-206), nor that the same-format short-circuit in `translator/index.js` skips translation when `targetFormat === sourceFormat`. The context note says Phase 4 owns the round-trip suite, so this is an accepted scope boundary, not a defect — but the test names risk over-claiming Phase 1 completeness. Consider renaming to "Phase 1: Claude transport wiring contracts" to reflect the actual scope.
**Fix:** Rename the describe block, or add a Contract D asserting `new OllamaLocalExecutor().buildHeaders({runtimeTransport: {format:"claude", headers:{...CLAUDE_API_HEADERS}, auth:{combined:true,header:"x-api-key",scheme:"raw"}}, apiKey:"sk-test"})["x-api-key"] === "sk-test"` to lock the inheritance.

---

_Reviewed: 2026-07-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_