---
phase: 02-thinking-block-fidelity
fixed_at: 2026-07-07T00:00:00Z
review_path: .planning/phases/02-thinking-block-fidelity/02-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-07-07
**Source review:** `.planning/phases/02-thinking-block-fidelity/02-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### WR-01: Short-circuit leaks `reasoning_effort` (OpenAI field) onto Claude wire when `providerThinking.mode` is a level

**Files modified:** `open-sse/translator/concerns/thinkingUnified.js`
**Commit:** `2b8bb8e`
**Applied fix:** Narrowed the ollama+CLAUDE short-circuit to normalize a stray OpenAI-format `reasoning_effort` before returning. When `body.thinking` is already present (Claude-native), drop the OpenAI field and let the Claude field win. Otherwise fold into `body.output_config.effort` (creating it if absent), preserving any client-set effort. Kept the early-return so `stripAll` does not undo Claude-native fields. Fix lives entirely in the short-circuit branch — chatCore injection logic untouched, minimizing blast radius.

### WR-02: Test THINK-03 claims "providerThinking-injected thinking survives" but does not exercise the injection path

**Files modified:** `tests/unit/ollama-claude-thinking-passthrough.test.js`
**Commit:** `bf215d5`
**Applied fix:** Added THINK-03b (level-mode: `body.reasoning_effort = "high"` simulating chatCore.js:66-68) and THINK-03c (on-mode: `body.thinking = { type: "enabled", budget_tokens: 10000 }` + stray reasoning_effort to confirm Claude-native wins). Both assert the post-`applyThinking` body is valid for ollama's Claude endpoint (reasoning_effort normalized away, output_config.effort set when appropriate). THINK-03b also doubles as WR-01 regression coverage.

### WR-03: Short-circuit behavior for reasoning-capable ollama models is unverified

**Files modified:** `tests/unit/ollama-claude-thinking-passthrough.test.js`
**Commit:** `bf215d5`
**Applied fix:** Added two cases using `kimi-k2.5` (matches `*kimi*k2*` → `reasoning:true, thinkingFormat:"openai"`). First: client-set Claude fields (`thinking.enabled` + `output_config.effort`) survive verbatim, no `reasoning_effort` rewrite. Second: chatCore-injected `reasoning_effort` is normalized to `output_config.effort` even for reasoning-capable models. Confirms short-circuit fires unconditionally regardless of `caps.reasoning` (CONTEXT decision).

### WR-04: `hasValidContent` DOCUMENT addition is untested

**Files modified:** `tests/unit/ollama-claude-block-fidelity.test.js`
**Commit:** `bf215d5`
**Applied fix:** Added BLK-03b (document-only user message) and BLK-03c (mixed text + document). Both assert the user message survives `prepareClaudeRequest`'s `hasValidContent` filter (would be dropped without the DOCUMENT branch in claude.js:13-25). Covers the DOCUMENT half of the fix.

### WR-05: Short-circuit ignores `parseSuffix` model-level override for ollama+claude

**Files modified:** `tests/unit/ollama-claude-thinking-passthrough.test.js`
**Commit:** `bf215d5`
**Applied fix:** Option (b) — document as accepted behavior. CONTEXT decision: `applyThinking` is a no-op on the claude→ollama path (preserve client body verbatim). Client-set model-suffix like `"kimi-k2.5(high)"` is an OpenAI-format niche feature; on the Claude transport the client should send Claude-format fields directly. `chatCore.js:138` (`stripThinkingSuffix`) cleans the suffix from the upstream model id regardless, so the upstream receives a valid model id. Added THINK-04 documenting the ceiling: client's explicit `output_config.effort="low"` wins, suffix override "high" is NOT applied.

---

_Fixed: 2026-07-07_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_