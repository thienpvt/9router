---
phase: 03-compatibility-fallback
verified: 2026-07-07T23:25:00Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
deferred:
  - truth: "ollama does not return 4xx/5xx on tool_choice/cache_control/metadata under the claude transport (live round-trip confirmation)"
    addressed_in: "Phase 4"
    evidence: "Phase 4 VAL-02 success criteria: 'A live/recorded round-trip test confirms thinking + tool_use blocks survive end-to-end against ollama cloud (or a mock of the /v1/messages contract)' — the round-trip exercises these fields, so a 4xx on any would fail VAL-02."
---

# Phase 3: Compatibility & Fallback Verification Report

**Phase Goal:** Fields ollama ignores are tolerated without erroring, ollama's `stop_reason` and usage values flow correctly into the gateway's Claude-compat response, and the non-Claude fallback path remains intact
**Verified:** 2026-07-07T23:25:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | Fields ollama ignores (`tool_choice`, `cache_control`, `metadata`) are either stripped before send or tolerated without erroring | VERIFIED | `translateRequest` same-format skip (`open-sse/translator/index.js:78`) preserves the body; `prepareClaudeRequest` (`open-sse/translator/formats/claude.js`) rewrites `cache_control` to the canonical ephemeral form (system: lines 220-229 → `{type:"ephemeral",ttl:"1h"}`; message: lines 240-280 → `{type:"ephemeral"}`) and strips `tool_choice` only when `tools` array is empty (lines 356-359). Tests COMP-01a/b/c/d green. Live 4xx confirmation deferred to Phase 4 VAL-02. |
| 2   | `stop_reason` values from ollama (`end_turn`, `max_tokens`, `tool_use`) map correctly to the Claude `stop_reason` field the client expects | VERIFIED | `translateResponse` same-format passthrough (`open-sse/translator/index.js:152-153`) returns `[chunk]` with same identity when `sourceFormat === targetFormat`. Tests COMP-02a/b/c assert `result[0] === chunk` for all three values (tool_use, end_turn, max_tokens). ollama emits Claude-native values, so "map correctly" is satisfied by identity — no normalizer exists or is needed (D-02). |
| 3   | Usage (`input_tokens`/`output_tokens`) from ollama flows into the gateway's usage tracking under the claude transport | VERIFIED | `extractUsage` Claude-shape branches (`open-sse/utils/usageTracking.js:239-257`) read `message.usage.input_tokens` from `message_start` and `usage.output_tokens` from `message_delta`. `mergeUsage` (lines 315-329) does field-wise max, preserving both. Tests COMP-03a/b/c green; COMP-03d and COMP-03d-cache-creation prove cache fields ride the same branch; COMP-03e proves native ollama NDJSON (non-Claude fallback path) also covered (lines 299-305). |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Non-Claude Fallback (Phase Goal Precondition)

| Check | Status | Evidence |
| ----- | ------ | -------- |
| `resolveTransport("ollama", "openai") === null` | VERIFIED | `open-sse/providers/registry/ollama.js:26-33` `transports[]` contains only `{format:"claude"}` entry; `resolveTransport` (provider.js:142-147) `find()` returns `undefined` → `null`. Transport test Contract B passes. |
| `resolveTransport("ollama-local", "openai") === null` | VERIFIED | Same shape in `open-sse/providers/registry/ollama-local.js:22`. Transport test Contract B-local passes. |
| buildUrl returns `/api/chat` for openai source | VERIFIED | `open-sse/executors/ollama-local.js:9-27` `buildUrl` falls through to `${resolveOllamaLocalHost(credentials)}/api/chat` when `runtimeTransport` absent (openai path → no claude transport match → no runtimeTransport). Transport test Contract C-fallback passes. |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `tests/unit/ollama-claude-compat.test.js` | One vitest self-check covering COMP-01/02/03 + fallback | VERIFIED | 16 contracts across 5 groups (COMP-01a-d field tolerance incl. message-block cache_control WR-03, COMP-02a-c stop_reason identity passthrough WR-02, COMP-03a-e usage incl. cache_creation WR-05 and native ollama NDJSON WR-04). Uses `FORMATS.CLAUDE`/`FORMATS.OPENAI` constants — no hardcoded format strings. Imports real module exports; no mocks. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `translateRequest` same-format skip | Body preservation (COMP-01) | `open-sse/translator/index.js:78` `if (sourceFormat !== targetFormat)` gate skips translation body for claude→claude | WIRED | Confirmed: source === target === CLAUDE skips translation body; prepareClaudeRequest still runs (line 118-121) and is the cache_control rewriter — tolerate-don't-strip. |
| `translateResponse` same-format passthrough | Stop_reason forwarding (COMP-02) | `open-sse/translator/index.js:152-153` `return [chunk]` when source === target | WIRED | Identity passthrough — `result[0] === chunk` asserted in 3 tests. |
| `extractUsage` Claude-shape branches | Usage tracking (COMP-03) | `open-sse/utils/usageTracking.js:239-257` reads `message.usage.input_tokens` (start) and `usage.output_tokens` (delta) | WIRED | Branches are provider-agnostic (key on `chunk.type`, not provider name); native ollama NDJSON branch (lines 299-305) covers non-Claude fallback. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| All Phase 3 contracts + Phase 1/2 regression | `cd tests && npx vitest run unit/ollama-claude-compat.test.js unit/ollama-claude-transport.test.js unit/ollama-claude-thinking-passthrough.test.js unit/ollama-claude-block-fidelity.test.js` | 4 files / 35 tests passed, exit 0, 766ms | PASS |

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` declared in PLAN/SUMMARY; phase is test-only with no migration/tooling surface.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| COMP-01 | 03-01-PLAN | Fields ollama ignores tolerated without erroring | SATISFIED | Tests COMP-01a-d green; `prepareClaudeRequest` tolerate-don't-strip verified by code inspection. Live 4xx → VAL-02. |
| COMP-02 | 03-01-PLAN | ollama stop_reason values map to Claude stop_reason | SATISFIED | Tests COMP-02a-c green; same-format identity passthrough (no mapping needed — ollama emits Claude-native values). |
| COMP-03 | 03-01-PLAN | Usage flows into gateway tracking under claude transport | SATISFIED | Tests COMP-03a-e green; extractUsage/mergeUsage Claude-shape branches + native ollama NDJSON branch. |
| (Non-Claude fallback) | 03-01-PLAN (truth) | openai-format source stays on `/api/chat` | SATISFIED | Transport test Contract B/B-local/C-fallback green; resolveTransport returns null, buildUrl falls through. |

REQUIREMENTS.md traceability table marks COMP-01/02/03 as Phase 3 — no orphaned requirements, all 3 IDs claimed by 03-01-PLAN and satisfied.

### Anti-Patterns Found

None. Scan of `tests/unit/ollama-claude-compat.test.js` for `TBD|FIXME|XXX|placeholder|coming soon` returned no matches. Tests exercise real module exports against synthetic chunks — no stub implementations, no `return null`/`return []` shortcuts.

### Human Verification Required

None. All truths resolved to VERIFIED via code inspection + behavioral test evidence. Live 4xx/round-trip confirmation deferred to Phase 4 VAL-02 (recorded in deferred list, not a gap — Phase 4 owns live-provider verification by design).

### Gaps Summary

No gaps. Phase 3 is a test-only lock phase: the production code paths (`translateRequest` same-format skip + `prepareClaudeRequest` tolerate-don't-strip + `translateResponse` identity passthrough + `extractUsage`/`mergeUsage` Claude-shape branches + native ollama NDJSON branch + `resolveTransport` null-for-openai) were already correct from Phases 1-2. Phase 3 added 16 contract assertions that prove the compatibility contract holds and lock it against future regressions. All 35 tests across Phase 1-2-3 self-checks pass.

---

_Verified: 2026-07-07T23:25:00Z_
_Verifier: Claude (gsd-verifier)_
