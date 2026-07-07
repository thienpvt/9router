# Phase 1: Passthrough Transport & Auth - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Claude-format client requests to ollama (cloud + local) resolve `targetFormat="claude"` and reach ollama's native `/v1/messages` endpoint without translation, while non-Claude clients continue using the existing `/api/chat` transport unchanged. Adds a `transports[]` claude entry to the ollama + ollama-local registries (mirroring GLM), wires the auth header scheme, and generalizes `OllamaLocalExecutor.buildUrl` to honor the runtime-matched claude transport.

</domain>

<decisions>
## Implementation Decisions

### Cloud Auth Header Scheme (COMP-04)
- Cloud API key carried on `x-api-key` raw (Anthropic-compat convention, matches GLM template)
- Local: no real auth — local ollama does not validate keys; send `x-api-key` raw only if a key is configured, else omit
- Include `anthropic-version` header via `CLAUDE_API_HEADERS` on the claude transport (same as GLM)
- Scheme confirmed by convention now; verified against the `/v1/messages` contract in Phase 4 round-trip/mock test (VAL-02)

### Transport & Registry Shape
- Add `transports[]` to `ollama.js` and `ollama-local.js`, keeping the existing `transport` object as the default `ollama`-format fallback (preserves openai/ollama path — PASS-03)
- Local claude transport `baseUrl` resolved at request time via `OllamaLocalExecutor.buildUrl` override honoring `credentials.runtimeTransport` (host from `resolveOllamaLocalHost`)
- Cloud claude transport `baseUrl`: `https://ollama.com/v1/messages` (probe-confirmed POST endpoint)
- No `urlSuffix` on the claude transport (ollama `/v1/messages` takes no `?beta=true`)

### Claude's Discretion
Exact `transports[]` field ordering, whether to also set `transport.format` to a multi-endpoint sentinel, and any `features.usage` adjustments for the claude path — all at Claude's discretion, guided by the GLM template and existing registry conventions.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `open-sse/providers/registry/glm.js` — template for a multi-endpoint provider with a `transports[]` claude entry (`format:"claude"`, `auth:{combined,header,scheme}`, `headers:{...CLAUDE_API_HEADERS}`)
- `open-sse/services/provider.js` `resolveTransport(provider, sourceFormat)` — matches `t.format === sourceFormat`; already wired at `chatCore.js:51-53` setting `credentials.runtimeTransport`
- `open-sse/executors/default.js` `buildUrl` (line 118) — honors `credentials.runtimeTransport.baseUrl` first; `buildHeaders` (line 163) — applies `rt.auth` + `rt.headers`
- `open-sse/translator/formats/claude.js` `prepareClaudeRequest` — already runs when `targetFormat==="claude"`; no new finalization needed
- `CLAUDE_API_HEADERS` from `open-sse/providers/shared.js` (imported by glm.js)

### Established Patterns
- Multi-endpoint providers advertise `transports[]`; `resolveTransport` picks the sourceFormat match → `targetFormat = runtimeTransport.format` → translation skipped (`translator/index.js` same-format short-circuit)
- `OllamaLocalExecutor extends DefaultExecutor` and overrides `buildUrl` with a hardcoded `/api/chat` — this override currently bypasses the `runtimeTransport.baseUrl` branch and must be generalized

### Integration Points
- `open-sse/providers/registry/ollama.js` — add `transports[]`
- `open-sse/providers/registry/ollama-local.js` — add `transports[]`
- `open-sse/executors/ollama-local.js` — generalize `buildUrl` to honor `credentials.runtimeTransport` (claude `/v1/messages`), falling back to `resolveOllamaLocalHost(...)/api/chat`
- Registry index is auto-generated (`scripts/migrate-registry.mjs`) — no hand-edit of `providers/registry/index.js`

</code_context>

<specifics>
## Specific Ideas

Mirror GLM (`glm.js`) as the concrete template for the `transports[]` claude entry. Keep the existing `transport` object on both ollama registries unchanged so the openai/ollama-format fallback path is byte-identical.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Per-model `thinkingFormat` wiring and `budget_tokens` enforcement are explicitly out of scope (REQUIREMENTS Out of Scope).

</deferred>