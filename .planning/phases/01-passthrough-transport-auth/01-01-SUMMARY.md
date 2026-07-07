---
phase: 01-passthrough-transport-auth
plan: 01
subsystem: provider-registry
tags: [transport, registry, ollama, claude-format, passthrough]
requires:
  - CLAUDE_API_HEADERS (open-sse/providers/shared.js)
  - resolveTransport contract (open-sse/services/provider.js)
provides:
  - ollama claude transport declaration (https://ollama.com/v1/messages)
  - ollama-local claude transport declaration (http://localhost:11434/v1/messages)
affects:
  - open-sse/handlers/chatCore.js (resolveTransport now matches "claude" → targetFormat="claude" → translation skipped)
  - open-sse/executors/default.js buildHeaders (applies rt.headers + rt.auth automatically)
  - open-sse/executors/ollama-local.js buildUrl (Phase 01-02 generalizes to honor rt.baseUrl)
tech-stack:
  added: []
  patterns: [multi-endpoint transports[] per GLM template, CLAUDE_API_HEADERS spread, x-api-key raw auth]
key-files:
  created: []
  modified:
    - open-sse/providers/registry/ollama.js
    - open-sse/providers/registry/ollama-local.js
decisions:
  - No urlSuffix on claude transport (ollama /v1/messages takes no ?beta=true per CONTEXT)
  - No usage field on claude transport (ollama cloud usage via existing transport path)
  - Keep auth shape consistent on local transport (x-api-key raw) — local ollama ignores key if unset
  - baseUrl for local declared as static default literal — host substitution is Plan 01-02's job
metrics:
  duration: PT2M
  completed: 2026-07-07
  tasks: 2
  files: 2
status: complete
---

# Phase 01 Plan 01: Ollama Claude Transport Registries Summary

Add `transports[]` claude-format entry to both Ollama registries (cloud + local), mirroring GLM template — same-format short-circuit at translator/index.js:78 skips OpenAI pivot when Claude client hits ollama.

## What was built

### Task 1: Ollama Cloud registry (ollama.js)
- Added `import { CLAUDE_API_HEADERS } from "../shared.js";` at line 1
- Inserted `transports[]` array after existing `transport` object, before `models`
- One claude entry: `{format:"claude", baseUrl:"https://ollama.com/v1/messages", headers:{...CLAUDE_API_HEADERS}, auth:{combined:true, header:"x-api-key", scheme:"raw"}}`
- No `urlSuffix`, no `usage` field
- Existing `transport` (baseUrl "https://ollama.com/api/chat", format "ollama", validateUrl) byte-identical

### Task 2: Ollama Local registry (ollama-local.js)
- Added `import { CLAUDE_API_HEADERS } from "../shared.js";` at line 1
- Inserted `transports[]` array after existing `transport`, before `serviceKinds`
- One claude entry: `{format:"claude", baseUrl:"http://localhost:11434/v1/messages", headers:{...CLAUDE_API_HEADERS}, auth:{combined:true, header:"x-api-key", scheme:"raw"}}`
- Existing `transport` (baseUrl "http://localhost:11434/api/chat", format "ollama") byte-identical
- Local host substitution deferred to Plan 01-02 (`OllamaLocalExecutor.buildUrl` generalization via `resolveOllamaLocalHost`)

## Verification

Both files passed the plan's `node -e` automated verify assertions:

- `ollama.js`: claude transport present at `https://ollama.com/v1/messages` with `x-api-key`/`raw` auth; fallback `transport.format==="ollama"` preserved; no `openai` entry leaked into `transports[]`
- `ollama-local.js`: claude transport present at `http://localhost:11434/v1/messages` with `x-api-key` header; fallback `transport.format==="ollama"` and `transport.baseUrl==="http://localhost:11434/api/chat"` preserved

Header spread confirmed via `headers: { ...CLAUDE_API_HEADERS }` syntax — `Anthropic-Version` and `Anthropic-Beta` keys carried into the transport object (same shape as glm.js line 43).

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-3 auto-fixes triggered (config-only edits, no code path exercised).

## Threat Model Verification

| Threat ID | Disposition | Status |
|----------|-------------|--------|
| T-01-01 | mitigate | Applied — x-api-key raw on cloud transport, baseUrl hardcoded to ollama.com/v1/messages, no user-controlled injection |
| T-01-02 | accept | Local x-api-key over http loopback — acceptable per CONTEXT |
| T-01-03 | mitigate | Applied — transports[].format hardcoded lowercase strings; existing `transport` object byte-identical (PASS-03) preserves openai/ollama fallback |
| T-01-SC | accept | Zero new packages installed — pure registry config edit |

## Requirements Coverage

- **PASS-01**: Ollama Cloud advertises claude transport at `https://ollama.com/v1/messages` ✓
- **PASS-02**: Ollama Local advertises claude transport at `http://localhost:11434/v1/messages` ✓
- **PASS-03**: Existing `transport` object unchanged on both registries (fallback preserved) ✓
- **COMP-04**: Auth scheme `{combined:true, header:"x-api-key", scheme:"raw"}` wired on both claude entries ✓

## Known Stubs

None — both files are complete config declarations, no placeholder values flow to runtime.

## Threat Flags

None — no new network endpoints beyond what the plan's threat model declared (ollama.com/v1/messages and localhost:11434/v1/messages were both enumerated in the threat register as T-01-01 / T-01-02 boundaries).

## Commits

- `59e39a5` feat(01-01): add claude transport to Ollama Cloud registry
- `aa06c4b` feat(01-01): add claude transport to Ollama Local registry

## Self-Check: PASSED

All modified files exist on disk. Both task commits (59e39a5, aa06c4b) present in git log. SUMMARY.md committed.