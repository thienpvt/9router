---
phase: 03-compatibility-fallback
plan: 01
subsystem: ollama-claude-compat
tags: [compatibility, fallback, usage-tracking, stop-reason, test-only]
requires:
  - 01-02 (PASS-03 resolveTransport fallback guard)
  - 02-02 (BLK-04 same-format response passthrough)
provides:
  - COMP-01 contract lock (field tolerance: tool_choice/metadata/cache_control)
  - COMP-02 contract lock (stop_reason passthrough unchanged)
  - COMP-03 contract lock (Claude-shape usage extraction via extractUsage/mergeUsage)
  - Fallback guard re-lock (openai source stays on /api/chat)
affects:
  - tests/unit/ollama-claude-compat.test.js (new)
tech-stack:
  added: []
  patterns:
    - same-format passthrough (translateRequest skip + translateResponse [chunk] return)
    - Claude-shape extractUsage branches (provider-agnostic, no ollama-specific path)
key-files:
  created:
    - tests/unit/ollama-claude-compat.test.js
  modified: []
decisions:
  - D-01 tolerate-don't-strip (tool_choice/cache_control/metadata sent as-is; cache_control rewritten by prepareClaudeRequest, not stripped)
  - D-02 no stop_reason normalizer (ollama emits Claude-native values; same-format skips translation)
  - D-03 generic usage extraction (extractUsage Claude-shape branches already provider-agnostic)
  - D-04 fallback preserved (resolveTransport null for openai on ollama + ollama-local)
metrics:
  duration: 4m
  completed: 2026-07-07
  tasks: 1
  files: 1
status: complete
---

# Phase 3 Plan 01: ollama Claude Compatibility Contracts Summary

Locks COMP-01/02/03 + non-Claude fallback guard for ollama's Claude-native passthrough via one vitest self-check (12 contracts, all green on first run).

## What was built

`tests/unit/ollama-claude-compat.test.js` — 12 contract assertions across 4 groups, all passing on the first run. No source change; the existing same-format skip (`open-sse/translator/index.js:78`, `:152-153`) + Claude-shape `extractUsage`/`mergeUsage` branches (`open-sse/utils/usageTracking.js:239-257`) already deliver the contract.

- **COMP-01 (field tolerance):** `tool_choice` preserved when `tools` non-empty; `metadata` survives `translateRequest(claude→claude, ollama)`; `cache_control` on the last system block rewritten by `prepareClaudeRequest` to `{type:"ephemeral",ttl:"1h"}` (rewritten, not stripped).
- **COMP-02 (stop_reason passthrough):** `message_delta` chunks with `delta.stop_reason` of `tool_use` / `end_turn` / `max_tokens` each return `[chunk]` unchanged through `translateResponse(claude→claude)` — same identity, no normalizer.
- **COMP-03 (usage extraction):** `extractUsage(message_start)` yields `prompt_tokens=100`; `extractUsage(message_delta)` yields `completion_tokens=50`; `mergeUsage` preserves both; `cache_read_input_tokens` flows through the same Claude-shape branch.
- **Fallback guard:** `resolveTransport("ollama", openai)===null` and `resolveTransport("ollama-local", openai)===null` — openai-format source stays on the default `/api/chat` transport (re-locks Phase 1 PASS-03).

## Deviations from Plan

None - plan executed exactly as written. The plan authorized a 1-3 line fix in `open-sse/utils/usageTracking.js` or `sseToJsonHandler.js` if COMP-03 revealed a gap; no gap appeared, so no source change was made.

## TDD Gate Compliance

- RED gate: skipped — plan authorizes single-commit when all contracts pass on first run (the test is both spec and lock).
- GREEN gate: `test(03-01):` commit `43d0e26` exists with all 12 contracts green.
- REFACTOR gate: n/a — no source touched.

Per plan `<action>`: "If all pass on first run, that IS the green — the test locks the contract. Commit RED-or-GREEN accordingly: ... If all pass immediately, single commit `test(03-01): add Phase 3 compat self-check`."

## Verification

- `cd tests && npx vitest run unit/ollama-claude-compat.test.js` → 12/12 passed (exit 0)
- `cd tests && npx vitest run unit/ollama-claude-transport.test.js unit/ollama-claude-block-fidelity.test.js unit/ollama-claude-thinking-passthrough.test.js` → 22/22 passed (Phase 1/2 intact, no regression)
- No source files modified (no stop_reason normalizer, no ollama-specific stripping, no new translator)
- Test imports use `FORMATS.CLAUDE` / `FORMATS.OPENAI` constants — no hardcoded format strings

## Known Stubs

None — test exercises real module exports against synthetic chunks. No production code touched.

## Self-Check: PASSED

- FOUND: `tests/unit/ollama-claude-compat.test.js` (worktree path: `C:/Users/thien/IdeaProjects/9router-fork/.claude/worktrees/agent-aab5484b16d5a1a38/tests/unit/ollama-claude-compat.test.js`)
- FOUND: commit `43d0e26` in `git log --oneline`