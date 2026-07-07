---
phase: 02-thinking-block-fidelity
plan: 02
subsystem: translator
tags: [ollama, claude, blocks, passthrough, vitest, test-only]
requires:
  - "Phase 1 ollama claude transport (registry + executor)"
  - "open-sse/translator/index.js same-format skip (line 78) + same-format passthrough (line 152-153)"
provides:
  - "Block fidelity self-check locking BLK-01/02/03/04 contracts"
  - "hasValidContent recognizes image/document blocks (no longer drops image-only user messages)"
affects:
  - "open-sse/translator/formats/claude.js (hasValidContent block-type list)"
tech-stack:
  added: []
  patterns:
    - "vitest contract self-check pattern (describe/it, no mocks, direct imports)"
key-files:
  created:
    - tests/unit/ollama-claude-block-fidelity.test.js
  modified:
    - open-sse/translator/formats/claude.js
decisions:
  - "Minimal Rule 1 fix to hasValidContent (added IMAGE + DOCUMENT) instead of rewriting prepareClaudeRequest — image-only user messages were silently dropped, violating BLK-03"
  - "Test bodies omit thinking/output_config to keep 02-02 independent of 02-01 (parallel Wave 1)"
metrics:
  duration: ~15m
  completed: 2026-07-07
  tasks: 1
  files: 2
status: complete
---

# Phase 2 Plan 02: Block Fidelity Self-Check Summary

4-contract vitest self-check locking Claude-native block passthrough on the ollama claude path; one Rule 1 bug fix to `hasValidContent` so image-only user messages aren't dropped.

## What was built

**Tests (`tests/unit/ollama-claude-block-fidelity.test.js`):**
- BLK-01 — tool_use + tool_result blocks round-trip losslessly (id, name, input, tool_use_id, content)
- BLK-02 — text block content + string-form `system` survive translateRequest
- BLK-03 — base64 image block (source.type/media_type/data) survives translateRequest
- BLK-04 — same-format `translateResponse` returns `[chunk]` unchanged (SSE reconstruction contract)

Test bodies omit `thinking`/`output_config` fields entirely — `applyThinking` is a no-op on these bodies whether or not the 02-01 short-circuit exists. Plan 02-02 runs fully independent of 02-01 in Wave 1.

**Fix (`open-sse/translator/formats/claude.js`):**
- `hasValidContent` previously recognized only TEXT/TOOL_USE/TOOL_RESULT blocks, so a user message with only an image evaluated to "empty" and was filtered out in prepareClaudeRequest's Pass 1 (line 247). This silently violated BLK-03.
- Added `CLAUDE_BLOCK.IMAGE` and `CLAUDE_BLOCK.DOCUMENT` to the recognized block-type list. Minimal change — same shape as the existing OR-chain.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `hasValidContent` dropped image-only user messages**
- **Found during:** Task 1 (BLK-03 contract)
- **Issue:** `prepareClaudeRequest` → `hasValidContent` (claude.js:13-23) didn't recognize `image` or `document` blocks, so user messages carrying only an image were filtered out in the empty-message pass (line 247). Same-format skip in `translateRequest` preserves blocks, but `prepareClaudeRequest` runs after the skip on every claude-target request including ollama. Result: BLK-03's user/image body came back with `messages: []`.
- **Fix:** Added `block.type === CLAUDE_BLOCK.IMAGE` and `block.type === CLAUDE_BLOCK.DOCUMENT` to the `some()` predicate. One-line addition, no logic change.
- **Files modified:** `open-sse/translator/formats/claude.js`
- **Commit:** 98d0ead

Plan `<action>` explicitly authorized this: "If a test reveals prepareClaudeRequest mangles the block for ollama, scope a minimal fix here."

## Verification

- `cd tests && npx vitest run unit/ollama-claude-block-fidelity.test.js` → 4 passed (0 failed)
- `cd tests && npx vitest run unit/ollama-claude-transport.test.js` (Phase 1 regression) → 7 passed (0 failed)
- Full suite baseline comparison: 47 pre-existing fails unchanged (96 passed → 96 passed with fix; snapshot fails identical: 4). No regression introduced by the `hasValidContent` change.

Test was run against the main-repo `tests/node_modules` (vitest 4.1.10) since worktrees don't carry an install. Path aliases in `tests/vitest.config.js` resolve `open-sse/` and `@/` relative to the worktree root.

## Self-Check: PASSED

- `tests/unit/ollama-claude-block-fidelity.test.js` — FOUND (created, committed)
- `open-sse/translator/formats/claude.js` modified — FOUND (committed)
- Commit `98d0ead` — FOUND in git log
- 4 BLK contracts named per plan acceptance criteria — FOUND in test file
- Test bodies contain no `thinking` / `output_config` (02-01 independence) — VERIFIED
