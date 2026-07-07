# Phase 1: Passthrough Transport & Auth - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** 3 (all modifications — no new files)
**Analogs found:** 3 / 3

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `open-sse/providers/registry/ollama.js` | config (registry) | request-response (transport declaration) | `open-sse/providers/registry/glm.js` | exact (multi-endpoint template) |
| `open-sse/providers/registry/ollama-local.js` | config (registry) | request-response (transport declaration) | `open-sse/providers/registry/glm.js` | exact (multi-endpoint template) |
| `open-sse/executors/ollama-local.js` | executor (subclass) | request-response (URL/header build) | `open-sse/executors/default.js` `buildUrl`/`buildHeaders` | role-match (parent class) |

## Pattern Assignments

### `open-sse/providers/registry/ollama.js` (config, request-response)

**Analog:** `open-sse/providers/registry/glm.js`

**Imports pattern** (glm.js line 1):
```javascript
import { CLAUDE_API_HEADERS } from "../shared.js";
```

**Multi-endpoint transports[] pattern** (glm.js lines 18-46):
```javascript
transport: {
  baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
  format: "claude",
  urlSuffix: "?beta=true",
  headers: { ...CLAUDE_API_HEADERS },
  auth: {
    combined: true,
    header: "x-api-key",
    scheme: "raw",
  },
  usage: {
    url: "https://api.z.ai/api/monitor/usage/quota/limit",
  },
},
// Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
transports: [
  {
    format: "openai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4/chat/completions",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  {
    format: "claude",
    baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
    urlSuffix: "?beta=true",
    headers: { ...CLAUDE_API_HEADERS },
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
],
```

**Apply to `ollama.js`:** Keep existing `transport` object (lines 18-22) byte-identical — it is the openai/ollama-format fallback (`baseUrl: "https://ollama.com/api/chat"`, `format: "ollama"`). Add a `transports[]` array with one new `claude` entry:
```javascript
transports: [
  {
    format: "claude",
    baseUrl: "https://ollama.com/v1/messages",
    headers: { ...CLAUDE_API_HEADERS },
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
],
```
No `urlSuffix` (CONTEXT: "No `urlSuffix` on the claude transport"). Import `CLAUDE_API_HEADERS` at the top of the file.

---

### `open-sse/providers/registry/ollama-local.js` (config, request-response)

**Analog:** `open-sse/providers/registry/glm.js`

**Same imports + transports[] shape** as `ollama.js` above. Differences for local:
- `baseUrl` for the claude transport uses the default local host literal `http://localhost:11434/v1/messages` as a static declaration (the actual host is resolved at request time by `OllamaLocalExecutor.buildUrl` via `resolveOllamaLocalHost` — see executor pattern below).
- Auth: local ollama does not validate keys (CONTEXT: "local: key not validated"). Wire `auth: { combined: true, header: "x-api-key", scheme: "raw" }` to match the cloud shape — the executor's `applyAuth` writes the header regardless, but if `credentials.apiKey` is unset it sends `x-api-key: undefined` which local ignores. Acceptable per CONTEXT (Claude's discretion — keep shape consistent with cloud).

**Apply to `ollama-local.js`:** Keep existing `transport` object (lines 14-17) byte-identical. Add `transports[]` with one `claude` entry.

---

### `open-sse/executors/ollama-local.js` (executor, request-response)

**Analog:** `open-sse/executors/default.js` `buildUrl` (lines 118-150) + `buildHeaders` (lines 163-169)

**Current `OllamaLocalExecutor.buildUrl`** (ollama-local.js lines 9-11):
```javascript
buildUrl(model, stream, urlIndex = 0, credentials = null) {
  return `${resolveOllamaLocalHost(credentials)}/api/chat`;
}
```
This bypasses the parent's `runtimeTransport.baseUrl` branch — it must be generalized to honor the claude transport first.

**Parent `buildUrl` runtimeTransport branch** (default.js lines 118-123):
```javascript
buildUrl(model, stream, urlIndex = 0, credentials = null) {
  // Runtime transport (multi-endpoint providers): use the sourceFormat-matched endpoint
  const rt = credentials?.runtimeTransport;
  if (rt?.baseUrl) {
    return rt.urlSuffix ? `${rt.baseUrl}${rt.urlSuffix}` : rt.baseUrl;
  }
  // ...fallbacks...
}
```

**Apply to `ollama-local.js`** — override `buildUrl` to check `runtimeTransport` first, then fall back to the local-host `/api/chat` path:
```javascript
buildUrl(model, stream, urlIndex = 0, credentials = null) {
  const rt = credentials?.runtimeTransport;
  if (rt?.baseUrl) {
    // claude transport: resolve local host, then append the transport's path.
    // rt.baseUrl already includes "/v1/messages" from the registry declaration.
    const host = resolveOllamaLocalHost(credentials);
    return rt.urlSuffix ? `${rt.baseUrl}${rt.urlSuffix}` : rt.baseUrl;
    // NOTE: for ollama-local the registry baseUrl is a literal "http://localhost:11434/v1/messages"
    // — but the user-configured host may differ. Prefer the runtime host:
    // `${host}${new URL(rt.baseUrl).pathname}`
  }
  return `${resolveOllamaLocalHost(credentials)}/api/chat`;
}
```
**Decision point (Claude's discretion per CONTEXT):** The registry declares `baseUrl: "http://localhost:11434/v1/messages"` as a static literal, but the local host is user-configurable via `credentials.providerSpecificData.baseUrl`. Two options:
1. Use `rt.baseUrl` verbatim (matches parent pattern; ignores user override — only correct if user hasn't customized host).
2. Substitute the host: `${resolveOllamaLocalHost(credentials)}${new URL(rt.baseUrl).pathname}` (honors user host; matches the existing `resolveOllamaLocalHost` contract).

Option 2 is the faithful generalization — the existing `/api/chat` path already calls `resolveOllamaLocalHost(credentials)` for the host. Keep that contract.

**No changes needed to `buildHeaders`** — `OllamaLocalExecutor` inherits `DefaultExecutor.buildHeaders` (default.js lines 163-169), which already reads `credentials.runtimeTransport.headers` and `rt.auth`. The override only exists for `buildUrl`.

**`resolveOllamaLocalHost` contract** (open-sse/config/providers.js lines 7-10):
```javascript
export function resolveOllamaLocalHost(credentials) {
  const raw = credentials?.providerSpecificData?.baseUrl?.trim();
  return (raw || OLLAMA_LOCAL_DEFAULT_HOST).replace(/\/$/, "");
}
```
Already exported and imported in `ollama-local.js` line 2 — no new import needed.

## Shared Patterns

### Multi-endpoint transport resolution
**Source:** `open-sse/services/provider.js` lines 142-147, `open-sse/handlers/chatCore.js` lines 51-53
**Apply to:** both registry files (shape must match what `resolveTransport` reads)

```javascript
// provider.js
export function resolveTransport(provider, sourceFormat) {
  const config = PROVIDERS[provider];
  const transports = config?.transports;
  if (!Array.isArray(transports) || !transports.length) return null;
  return transports.find(t => t.format === sourceFormat) || null;
}

// chatCore.js
const runtimeTransport = resolveTransport(provider, sourceFormat);
const targetFormat = modelTargetFormat || runtimeTransport?.format || getTargetFormat(provider);
if (runtimeTransport && credentials) credentials.runtimeTransport = runtimeTransport;
```
**Implication for registries:** `transports[].format` values must be lowercase strings matching client `sourceFormat` ("claude" / "openai" / "ollama"). The first match wins; for ollama only "claude" needs to be advertised (the `transport` object handles the openai/ollama fallback).

### Claude auth headers constant
**Source:** `open-sse/providers/shared.js` lines 24-30
**Apply to:** both registry files (claude transport `headers`)

```javascript
export const ANTHROPIC_API_VERSION = "2023-06-01";
export const CLAUDE_API_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};
```
Spread `{ ...CLAUDE_API_HEADERS }` into each claude transport's `headers` (same as glm.js line 43). Importing this constant is required at the top of both registry files.

### Runtime transport header application
**Source:** `open-sse/executors/default.js` lines 163-169
**Apply to:** `ollama-local.js` executor (inherited — no override needed)

```javascript
buildHeaders(credentials, stream = true) {
  const rt = credentials?.runtimeTransport;
  const headers = { "Content-Type": "application/json", ...(rt ? rt.headers : this.config.headers) };
  const desc = rt?.auth || AUTH_DESCRIPTORS[this.provider] || this.resolveAuthDescriptor();
  // Hooks run BEFORE auth so dynamic overlays (claude cached headers) can't clobber the token.
  for (const hook of desc.hooks || []) HEADER_HOOKS[hook]?.(headers, credentials);
  applyAuth(headers, desc, credentials);
  // ...
}
```
The parent already prefers `rt.headers` + `rt.auth` when `runtimeTransport` is set. With `transports[]` advertising `headers: { ...CLAUDE_API_HEADERS }` and `auth: { combined, header: "x-api-key", scheme: "raw" }`, `buildHeaders` will send `x-api-key: <apiKey>` + `Anthropic-Version` + `Anthropic-Beta` automatically. No executor change needed for headers.

## No Analog Found

None — all three files have direct analogs in the codebase.

## Metadata

**Analog search scope:**
- `open-sse/providers/registry/*.js` (compared glm.js, ollama.js, ollama-local.js)
- `open-sse/executors/default.js`, `open-sse/executors/ollama-local.js`
- `open-sse/services/provider.js` (resolveTransport contract)
- `open-sse/handlers/chatCore.js` (runtimeTransport wiring)
- `open-sse/config/providers.js` (resolveOllamaLocalHost)
- `open-sse/providers/shared.js` (CLAUDE_API_HEADERS)

**Files scanned:** 7
**Pattern extraction date:** 2026-07-07