---
phase: 03-compatibility-fallback
fixed_at: 2026-07-07T16:21:00Z
review_path: .planning/phases/03-compatibility-fallback/03-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-07-07T16:21:00Z
**Source review:** `.planning/phases/03-compatibility-fallback/03-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### WR-01: Fallback-A/B duplicate Phase 1 Contract B verbatim — zero new coverage

**Files modified:** `tests/unit/ollama-claude-compat.test.js`
**Commit:** 3d60636
**Applied fix:** Removed Fallback-A and Fallback-B `it()` blocks (resolveTransport openai-null checks) from the compat test file. Phase 1's transport test (`tests/unit/ollama-claude-transport.test.js` Contract B + Contract C) owns fallback routing end-to-end via `buildUrl`; the isolated `resolveTransport` re-assertion was byte-equivalent to Phase 1 Contract B and added no new signal. Replaced with a file-header comment documenting that Phase 1 owns the fallback contract.

### WR-02: COMP-02a/b/c over-claim "ollama compatibility" — tests are provider-agnostic

**Files modified:** `tests/unit/ollama-claude-compat.test.js`
**Commit:** 3d60636
**Applied fix:** Renamed the three COMP-02a/b/c `it()` block titles from "message_delta stop_reason='...' passes through unchanged" to "same-format passthrough delivers stop_reason='...' unchanged (provider-agnostic identity)". Added a comment block above explaining the contract proves `translateResponse` returns `[chunk]` when `sourceFormat === targetFormat` — a provider-agnostic identity passthrough (translator/index.js:152), not ollama-specific handling. The value: documents that ollama's native Claude stop_reasons reach the client unchanged because the gateway does not translate same-format responses. Assertions kept unchanged (they're correct).

### WR-03: cache_control tested only on system array; message content blocks untested

**Files modified:** `tests/unit/ollama-claude-compat.test.js`
**Commit:** 3d60636
**Applied fix:** Added `Contract COMP-01d: cache_control on message content blocks rewritten (ollama)`. Constructs an assistant message with two text blocks each carrying `cache_control`, runs `translateRequest(claude, claude, ..., ollama)`, and asserts: non-last block's `cache_control` is stripped (`undefined`), last non-thinking block of last assistant gains `{ type: "ephemeral" }` (NO `ttl` — message path differs from system path per claude.js:241-280). Covers the message-block cache_control path distinct from the system-array COMP-01c.

### WR-04: extractUsage ollama NDJSON branch untested despite file naming

**Files modified:** `tests/unit/ollama-claude-compat.test.js`
**Commit:** 3d60636
**Applied fix:** Added `Contract COMP-03e: extractUsage reads ollama NDJSON (done + prompt_eval_count)`. Feeds a chunk shaped as `{ model, done: true, prompt_eval_count: 30, eval_count: 20 }` to `extractUsage` and asserts `prompt_tokens=30`, `completion_tokens=20`, `total_tokens=50`. Exercises the native ollama `/api/chat` NDJSON branch (usageTracking.js:297-305) — the non-Claude fallback path's usage tracking. Complementary to the Claude-shape usage tests (COMP-03a-d).

### WR-05: COMP-03d covers cache_read but not cache_creation (symmetric risk)

**Files modified:** `tests/unit/ollama-claude-compat.test.js`
**Commit:** 3d60636
**Applied fix:** Added `Contract COMP-03d-cache-creation: cache_creation_input_tokens flows through extractUsage + mergeUsage`. Feeds a `message_start` with `{ input_tokens: 100, cache_creation_input_tokens: 15 }` through `extractUsage` + `mergeUsage`, asserts `merged.cache_creation_input_tokens === 15`. Symmetric to COMP-03d (cache_read). `canonicalizeUsage` comment (usageTracking.js:171) notes a first-write cache-miss carries ONLY `cache_creation` (no `cache_read`) — the field more likely to appear alone in real traffic, exactly the case where a regression would silently drop tokens.

---

_Fixed: 2026-07-07T16:21:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_