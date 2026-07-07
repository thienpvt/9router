---
phase: 01-passthrough-transport-auth
plan: 02
subsystem: api
tags: [ollama, claude, executor, transport, vitest]

requires:
  - phase: 01-passthrough-transport-auth/01
    provides: ollama + ollama-local registries advertise a claude transport (baseUrl /v1/messages, auth x-api-key raw + CLAUDE_API_HEADERS)
provides:
  - OllamaLocalExecutor.buildUrl honors credentials.runtimeTransport for the claude /v1/messages path, with resolveOllamaLocalHost host substitution
  - Fallback to <host>/api/chat preserved byte-identical when no runtimeTransport is set (openai/ollama-format path unchanged)
  - One runnable vitest self-check covering the three Phase 1 contracts (resolveTransport claude/openai resolution, buildUrl claude path, host override, fallback)
affects: [01-passthrough-transport-auth (Phase 4 VAL round-trip suite), open-sse/handlers/chatCore.js runtimeTransport wiring]

tech-stack:
  added: []
  patterns:
    - runtimeTransport.baseUrl honored first, host resolved via resolveOllamaLocalHost + pathname via new URL(rt.baseUrl).pathname (Option 2 from PATTERNS.md — honors user host override)

key-files:
  created:
    - tests/unit/ollama-claude-transport.test.js
  modified:
    - open-sse/executors/ollama-local.js

key-decisions:
  - "Chose PATTERNS.md Option 2 (host substitution) over Option 1 (rt.baseUrl verbatim): honors user-configured providerSpecificData.baseUrl on the claude path, matching the existing /api/chat fallback contract that already calls resolveOllamaLocalHost."
  - "Inherited DefaultExecutor.buildHeaders — no override; rt.headers + rt.auth (x-api-key raw + CLAUDE_API_HEADERS) applied automatically."

patterns-established:
  - "buildUrl runtimeTransport branch in OllamaLocalExecutor mirrors DefaultExecutor.buildUrl but substitutes the local host via resolveOllamaLocalHost rather than using rt.baseUrl verbatim (local-host is user-overridable)."

requirements-completed: [PASS-02, PASS-03, COMP-04]

coverage:
  - id: D1
    description: "OllamaLocalExecutor.buildUrl returns <resolved-host>/v1/messages when credentials.runtimeTransport.baseUrl is the claude transport"
    requirement: PASS-02
    verification:
      - kind: unit
        ref: "tests/unit/ollama-claude-transport.test.js#Contract C: buildUrl honors runtimeTransport baseUrl for claude path"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildUrl honors user-configured providerSpecificData.baseUrl on the claude path (not just the registry literal)"
    requirement: PASS-02
    verification:
      - kind: unit
        ref: "tests/unit/ollama-claude-transport.test.js#Contract C host-override: buildUrl honors providerSpecificData.baseUrl"
        status: pass
    human_judgment: false
  - id: D3
    description: "buildUrl falls back to <host>/api/chat when no runtimeTransport (openai/ollama-format path unchanged)"
    requirement: PASS-03
    verification:
      - kind: unit
        ref: "tests/unit/ollama-claude-transport.test.js#Contract C fallback: buildUrl returns /api/chat without runtimeTransport"
        status: pass
    human_judgment: false
  - id: D4
    description: "resolveTransport returns null for openai source on ollama + ollama-local (fallback to default transport preserved per PASS-03)"
    requirement: PASS-03
    verification:
      - kind: unit
        ref: "tests/unit/ollama-claude-transport.test.js#Contract B fallback / Contract B fallback local"
        status: pass
    human_judgment: false
  - id: D5
    description: "COMP-04 local: x-api-key raw + Anthropic-Version/Anthropic-Beta headers applied by inherited DefaultExecutor.buildHeaders (rt.auth + rt.headers) — wired by convention, confirmed in Phase 4 VAL-02"
    requirement: COMP-04
    verification: []
    human_judgment: true
    rationale: "Header scheme on the local network path is verified by the Phase 4 round-trip/mock suite (VAL-02). This plan's self-check only asserts URL routing; asserting the wire headers requires driving chatCore.js end-to-end which is out of scope for the lazy-senior single self-check."

duration: 4min
completed: 2026-07-07
status: complete
---

# Phase 1 Plan 02: Ollama Local Claude Transport Reachability Summary

**Generalized OllamaLocalExecutor.buildUrl to route the claude transport to <resolved-host>/v1/messages via runtimeTransport + resolveOllamaLocalHost, preserving the /api/chat fallback.**

## Performance

- **Duration:** ~4 min
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 1 (open-sse/executors/ollama-local.js)
- **Files created:** 1 (tests/unit/ollama-claude-transport.test.js)

## Accomplishments

- TDD RED: added tests/unit/ollama-claude-transport.test.js with 7 assertions covering Contracts A (claude transport resolution for cloud + local), B (openai returns null), C (buildUrl claude path + host override + fallback). Confirmed 2 RED on Contract C (buildUrl still hardcoded /api/chat), 5 GREEN on registry + fallback contracts from 01-01.
- TDD GREEN: replaced the single-line buildUrl body in open-sse/executors/ollama-local.js with a runtimeTransport-first branch that returns `${resolveOllamaLocalHost(credentials)}${new URL(rt.baseUrl).pathname}` when rt.baseUrl is set, else falls back to `${resolveOllamaLocalHost(credentials)}/api/chat`. All 7 tests now pass.

## Deviations from Plan

### Setup adjustment (not a code deviation)

- **Worktree forked from b10b807 (master) — pre-01-01.** The orchestrator's expected_base was b10b807 but the plan's `depends_on: [01-01]` requires the registry changes from 01-01. Merged `milestone/claude-ollama-direct-transport` (which contains 01-01's registry commits + the wave-1 tracking commit) into the worktree branch before starting Task 1. No code changes resulted from the merge — only brought in 01-01's registry files + .planning/ tree. After the merge, Contracts A and B passed as the plan predicted.
- **Vitest run location.** Worktree tests/ has no node_modules (excluded by design in the parent CLAUDE.md note). Created a Windows junction `tests/node_modules -> ../../tests/node_modules` (parent repo) so `npx vitest run unit/ollama-claude-transport.test.js` resolves vitest from within the worktree. The junction is not committed (untracked, build-time only). Vitest config's `**/.claude/**` exclude would otherwise skip worktree test files when invoked from the parent repo, so running inside the worktree was required.

No Rule 1-4 code deviations. Plan executed exactly as written.

## TDD Gate Compliance

- [x] RED commit exists: `2ca551e test(01-02): add Phase 1 contract self-check` — 2 failing tests confirmed before implementation.
- [x] GREEN commit exists after RED: `dbff230 feat(01-02): generalize OllamaLocalExecutor.buildUrl for claude transport` — all 7 tests pass.
- [ ] REFACTOR: not needed; the 5-line buildUrl body is already minimal.

## Self-Check: PASSED

- FOUND: tests/unit/ollama-claude-transport.test.js (committed in 2ca551e)
- FOUND: open-sse/executors/ollama-local.js (modified, committed in dbff230)
- FOUND: commit 2ca551e (RED)
- FOUND: commit dbff230 (GREEN)
- Test run: `cd tests && npx vitest run unit/ollama-claude-transport.test.js` → 7 passed (0 failed)
