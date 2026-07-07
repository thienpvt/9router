---
phase: 01-passthrough-transport-auth
verified: 2026-07-07T21:15:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 1: Passthrough Transport & Auth Verification Report

**Phase Goal:** Claude-format client requests to ollama (cloud + local) resolve `targetFormat="claude"` and reach ollama's native `/v1/messages` endpoint without translation, while non-Claude clients continue using the existing `/api/chat` transport unchanged
**Verified:** 2026-07-07T21:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (SC) | Status | Evidence |
|---|------------|--------|----------|
| 1 | SC1 (cloud): Claude-format request to Ollama Cloud resolves `targetFormat="claude"`, sent to `https://ollama.com/v1/messages`, body structurally identical (no openai hop) | VERIFIED | `resolveTransport("ollama","claude")` returns `{format:"claude", baseUrl:"https://ollama.com/v1/messages", headers:{...CLAUDE_API_HEADERS}, auth:{combined:true,header:"x-api-key",scheme:"raw"}}` (ollama.js:26-33). chatCore.js:51-53 sets `runtimeTransport` + `credentials.runtimeTransport`; `targetFormat = runtimeTransport?.format` = "claude". translator/index.js:78 `if (sourceFormat !== targetFormat)` skips all translation when both are "claude" → body unchanged. Contract A test passes. |
| 2 | SC2 (local): Claude-format request to Ollama Local resolves `targetFormat="claude"`, sent to `http://localhost:11434/v1/messages` (host via `resolveOllamaLocalHost`) | VERIFIED | `resolveTransport("ollama-local","claude")` returns claude transport (ollama-local.js:22-29). `OllamaLocalExecutor.buildUrl` (ollama-local.js:9-27) reads `credentials.runtimeTransport.baseUrl`, substitutes host via `resolveOllamaLocalHost(credentials)` + `new URL(rt.baseUrl).pathname`, appends `u.search` + `rt.urlSuffix`. Contracts C / C-host-override / C-fallback tests pass. WR-01/02/03 hardening (commit 4829a27): try/catch around `new URL`, urlSuffix appended, query preserved, fallback to verbatim rt.baseUrl on parse failure, fallback to `/api/chat` when no rt. |
| 3 | SC3 (auth): Auth header scheme for ollama `/v1/messages` confirmed and wired (cloud: x-api-key raw; local: key not validated) | VERIFIED (wiring); live-probe deferred to Phase 4 VAL-02 | Both claude transports carry `auth:{combined:true, header:"x-api-key", scheme:"raw"}` (ollama.js:31, ollama-local.js:27). default.js:163-169 `buildHeaders` reads `rt.auth` (line 166), `applyAuth` (default.js:26-37) with `desc.combined=true` calls `setAuth(headers, desc, credentials.apiKey \|\| credentials.accessToken)` writing `x-api-key: <key>` raw. `rt.headers` (CLAUDE_API_HEADERS: `Anthropic-Version`, `Anthropic-Beta`) spread at default.js:165. Wiring confirmed by code inspection matching GLM precedent. Live auth-success probe against ollama endpoint is Phase 4 VAL-02 scope. |
| 4 | SC4 (fallback): Non-Claude (openai-format) request to ollama still routes through `/api/chat` unchanged — openai/ollama-format path is fallback when no claude transport matches | VERIFIED | `resolveTransport("ollama","openai") === null` AND `resolveTransport("ollama-local","openai") === null` (provider.js:142-147: `transports.find(t => t.format === sourceFormat)` returns undefined → `null`; no "openai" entry in either transports[]). chatCore.js:52 `runtimeTransport` null → `targetFormat = getTargetFormat(provider)` = "ollama"; `credentials.runtimeTransport` not set. Existing `transport` object byte-identical: ollama.js:20-24 `{baseUrl:"https://ollama.com/api/chat", format:"ollama", validateUrl}`; ollama-local.js:16-19 `{baseUrl:"http://localhost:11434/api/chat", format:"ollama"}`. Contract B tests pass. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | COMP-04 live auth-success probe against ollama `/v1/messages` (confirm x-api-key raw is accepted by ollama, returns 200 not 401) | Phase 4 (VAL-02) | ROADMAP Phase 4 SC2: "A live/recorded round-trip test confirms thinking + tool_use blocks survive end-to-end against ollama cloud (or a mock of the `/v1/messages` contract)" — covers wire-level auth confirmation. Wiring itself verified here by code inspection. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `open-sse/providers/registry/ollama.js` | transports[] with claude entry at /v1/messages, x-api-key raw, CLAUDE_API_HEADERS; existing transport byte-identical | VERIFIED | Lines 1, 20-33. Import `CLAUDE_API_HEADERS` line 1. transports[0]: format:"claude", baseUrl:"https://ollama.com/v1/messages", headers spread, auth {combined,header:"x-api-key",scheme:"raw"}. transport unchanged: baseUrl "https://ollama.com/api/chat", format:"ollama", validateUrl. No urlSuffix on claude entry. |
| `open-sse/providers/registry/ollama-local.js` | transports[] with claude entry at localhost /v1/messages, x-api-key raw, CLAUDE_API_HEADERS; existing transport byte-identical | VERIFIED | Lines 1, 16-29. Import line 1. transports[0]: format:"claude", baseUrl:"http://localhost:11434/v1/messages", headers spread, auth {combined,header:"x-api-key",scheme:"raw"}. transport unchanged: baseUrl "http://localhost:11434/api/chat", format:"ollama". No urlSuffix. |
| `open-sse/executors/ollama-local.js` | buildUrl honors runtimeTransport.baseUrl (host substitution via resolveOllamaLocalHost + pathname); falls back to /api/chat | VERIFIED | Lines 9-27. `const rt = credentials?.runtimeTransport;` then `if (rt?.baseUrl)` branch: try/catch `new URL(rt.baseUrl)`, `host = resolveOllamaLocalHost(credentials).replace(/\/$/, "")`, `url = host + u.pathname + u.search`, append `rt.urlSuffix` if set, return. Else: `${resolveOllamaLocalHost(credentials)}/api/chat`. Signature unchanged `buildUrl(model, stream, urlIndex=0, credentials=null)`. WR-01/02/03 hardening (commit 4829a27) wraps URL parse in try/catch, preserves query + urlSuffix, falls back to verbatim rt.baseUrl on malformed input. No buildHeaders override (inherits DefaultExecutor). |
| `tests/unit/ollama-claude-transport.test.js` | Runnable vitest self-check covering Contracts A/B/C | VERIFIED | 7 it blocks: Contract A (cloud), A local, B fallback, B fallback local, C claude path, C host-override, C fallback. Imports `resolveTransport` from `../../open-sse/services/provider.js`, `OllamaLocalExecutor` from `../../open-sse/executors/ollama-local.js`. Test run: 7 passed (0 failed), 468ms. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `chatCore.js:51` | `resolveTransport` (provider.js:142) | `const runtimeTransport = resolveTransport(provider, sourceFormat)` | WIRED | Reads `config.transports` from PROVIDERS map; returns matching transport or null |
| `chatCore.js:52` | `runtimeTransport.format` | `targetFormat = modelTargetFormat \|\| runtimeTransport?.format \|\| getTargetFormat(provider)` | WIRED | claude transport.format="claude" → targetFormat="claude" |
| `chatCore.js:53` | `credentials.runtimeTransport` | `if (runtimeTransport && credentials) credentials.runtimeTransport = runtimeTransport` | WIRED | Passes transport to executor.buildUrl + buildHeaders |
| `translator/index.js:78` | sourceFormat vs targetFormat | `if (sourceFormat !== targetFormat)` guard | WIRED | sourceFormat="claude" && targetFormat="claude" → skip translation block entirely (no openai pivot) |
| `ollama-local.js buildUrl:10` | `credentials.runtimeTransport.baseUrl` | `const rt = credentials?.runtimeTransport; if (rt?.baseUrl)` | WIRED | Reads rt set by chatCore.js:53 |
| `default.js buildHeaders:164-166` | `rt.headers` + `rt.auth` | `headers = {...rt.headers}; desc = rt.auth \|\| ...; applyAuth(headers, desc, credentials)` | WIRED | CLAUDE_API_HEADERS spread + x-api-key raw applied when runtimeTransport set |
| `provider.js:142` | `PROVIDERS[provider].transports` | `const transports = config?.transports` | WIRED | ollama.js + ollama-local.js both expose transports[] property |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| chatCore.js | `runtimeTransport` | `resolveTransport(provider, sourceFormat)` reading `PROVIDERS[provider].transports` | Yes — registry transports[] populated at import time | FLOWING |
| chatCore.js | `targetFormat` | `runtimeTransport?.format` | Yes — "claude" from registry transports[0].format | FLOWING |
| ollama-local.js buildUrl | `url` | `resolveOllamaLocalHost(credentials)` + `new URL(rt.baseUrl).pathname` | Yes — host from providerSpecificData.baseUrl or OLLAMA_LOCAL_DEFAULT_HOST; pathname from registry baseUrl | FLOWING |
| default.js buildHeaders | `headers` | `rt.headers` (CLAUDE_API_HEADERS) + `applyAuth(...)` | Yes — static headers + dynamic apiKey/accessToken | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 1 contract self-check | `cd tests && npx vitest run unit/ollama-claude-transport.test.js` | 7 passed (0 failed), 468ms | PASS |
| Contract A cloud | (covered by above run) | resolveTransport("ollama","claude").baseUrl === "https://ollama.com/v1/messages" | PASS |
| Contract A local | (covered by above run) | resolveTransport("ollama-local","claude").baseUrl === "http://localhost:11434/v1/messages" | PASS |
| Contract B fallback | (covered by above run) | resolveTransport("ollama","openai") === null AND resolveTransport("ollama-local","openai") === null | PASS |
| Contract C buildUrl claude | (covered by above run) | buildUrl with rt returns "http://localhost:11434/v1/messages" | PASS |
| Contract C host-override | (covered by above run) | buildUrl honors providerSpecificData.baseUrl "http://192.168.1.5:11434" → "http://192.168.1.5:11434/v1/messages" | PASS |
| Contract C fallback | (covered by above run) | buildUrl(null) returns "http://localhost:11434/api/chat" | PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No TBD/FIXME/XXX/TODO/PLACEHOLDER/empty-impl/hardcoded-empty in modified files. No debt markers. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PASS-01 | 01-01 | Ollama Cloud registry advertises claude-format transport at https://ollama.com/v1/messages → targetFormat="claude" → translation skipped | SATISFIED | ollama.js:26-33; Contract A test passes |
| PASS-02 | 01-01, 01-02 | Ollama Local registry advertises claude-format transport at http://localhost:11434/v1/messages (host via resolveOllamaLocalHost); OllamaLocalExecutor.buildUrl routes to it | SATISFIED | ollama-local.js:22-29; ollama-local.js buildUrl:9-27; Contracts A-local, C, C-host-override tests pass |
| PASS-03 | 01-01, 01-02 | Existing ollama-format transport (/api/chat) remains fallback when no claude transport matches; non-Claude clients unaffected | SATISFIED | resolveTransport returns null for openai; existing transport objects byte-identical; Contract B + Contract C fallback tests pass |
| COMP-04 | 01-01, 01-02 | Auth header scheme for ollama /v1/messages confirmed and wired (x-api-key raw) | SATISFIED (wiring); live probe deferred to Phase 4 VAL-02 | Both claude transports carry auth:{combined,header:"x-api-key",scheme:"raw"}; default.js buildHeaders:163-169 applies rt.auth via applyAuth (default.js:26-37) writing x-api-key raw; rt.headers spreads CLAUDE_API_HEADERS. Code-inspection-verified matching GLM precedent. |

No orphaned requirements. REQUIREMENTS.md maps PASS-01/02/03, COMP-04 to Phase 1; all 4 covered by plans and satisfied by evidence.

### Gaps Summary

No gaps. All 4 ROADMAP success criteria verified TRUE in the codebase:

1. SC1 cloud passthrough: resolveTransport + chatCore wiring + translator skip all confirmed; Contract A test green.
2. SC2 local reachability: buildUrl generalized with host substitution + WR-01/02/03 hardening; Contracts C / C-host-override / C-fallback tests green.
3. SC3 auth wiring: x-api-key raw + CLAUDE_API_HEADERS wired via transport.auth + transport.headers → default.js buildHeaders → applyAuth; live auth-success confirmation deferred to Phase 4 VAL-02 (known scheduled verification, not a gap).
4. SC4 fallback preserved: resolveTransport returns null for openai on both registries; existing transport objects byte-identical; Contract B tests green.

TDD discipline confirmed: RED commit `2ca551e` (2 failing tests on Contract C before implementation), GREEN commit `dbff230` (all 7 pass after buildUrl generalization), hardening commit `4829a27` (WR-01/02/03 from code review). Contract test run independently by verifier: 7/7 pass.

---

_Verified: 2026-07-07T21:15:00Z_
_Verifier: Claude (gsd-verifier)_