---
phase: 03-compatibility-fallback
reviewed: 2026-07-07T00:00:00Z
depth: deep
files_reviewed: 1
files_reviewed_list:
  - tests/unit/ollama-claude-compat.test.js
findings:
  critical: 0
  warning: 5
  info: 2
  total: 7
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-07
**Depth:** deep
**Files Reviewed:** 1
**Status:** issues_found

## Summary

Test-only phase. Single file `tests/unit/ollama-claude-compat.test.js` (12 contracts) locks the existing same-format passthrough + Claude-shape usage extraction for ollama's Claude-native `/v1/messages` endpoint. All assertions verified against source: `translateRequest` (translator/index.js:52), `translateResponse` (translator/index.js:149), `extractUsage`/`mergeUsage` (usageTracking.js:233,315), `prepareClaudeRequest` (formats/claude.js:191), `resolveTransport` (services/provider.js:142). No BLOCKERS — assertions are concrete (exact numeric values, exact object shape via `toEqual`), no correctness bugs in what the tests assert, no security surface (test-only).

Key concerns are **test fidelity gaps**: several contracts over-claim ollama-specific behavior when they actually exercise provider-agnostic code paths, two contracts duplicate Phase 1 verbatim, and the file leaves obvious edges untested (non-streaming usage, cache_control on message content blocks, cache_creation flow).

## Warnings

### WR-01: Fallback-A/B duplicate Phase 1 Contract B verbatim — zero new coverage

**File:** `tests/unit/ollama-claude-compat.test.js:169-175`
**Issue:**
`Fallback-A` (`resolveTransport("ollama", FORMATS.OPENAI) === null`) and `Fallback-B` (`resolveTransport("ollama-local", FORMATS.OPENAI) === null`) are byte-equivalent to Phase 1 `tests/unit/ollama-claude-transport.test.js:20-26` (Contract B fallback + Contract B fallback local). Only difference: Phase 3 uses `FORMATS.OPENAI` constant, Phase 1 uses `"openai"` literal — `FORMATS.OPENAI === "openai"`, semantically identical. Phase 1 Contract C (`buildUrl returns /api/chat without runtimeTransport`) already proves the fallback routing end-to-end; Phase 3 re-asserts only the `resolveTransport` null return in isolation, adding nothing.

**Fix:** Delete Fallback-A and Fallback-B. The comment at line 167 ("Re-locks Phase 1 PASS-03") admits re-locking — but re-locking an already-locked contract is dead weight. If the intent is regression defense against the transport registry drifting, a single combined assertion referencing Phase 1 is enough; two redundant `it()` blocks inflate contract count without adding signal.

### WR-02: COMP-02a/b/c over-claim "ollama compatibility" — tests are provider-agnostic

**File:** `tests/unit/ollama-claude-compat.test.js:91-126`
**Issue:**
All three stop_reason tests call `translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {})`. In `translateResponse` (translator/index.js:152), when `sourceFormat === targetFormat`, the function returns `[chunk]` immediately — an identity passthrough that runs for ANY provider, never touching ollama-specific code (no `OllamaExecutor`, no `ollama-to-openai` translator, no provider branch). The tests would pass unchanged for `provider="anything"`. They prove "same-format response passthrough is identity" — a Phase 1 transport concern — not "ollama preserves Claude stop_reasons".

The describe block title ("Phase 3: ollama claude compatibility contracts") and the `Contract COMP-02*` IDs imply ollama-specific coverage that does not exist. If ollama's `/v1/messages` endpoint mangled `stop_reason` in flight, these tests would still pass because they never send a request to ollama — they only verify translator function semantics.

**Fix:** Either (a) rename to clarify scope: `COMP-02: same-format response passthrough preserves stop_reason (provider-agnostic)`, or (b) add an integration-style test that drives `OllamaExecutor` with a mocked Claude SSE stream and asserts stop_reason survives end-to-end. (a) is cheaper and honest; (b) closes the real gap but may be out of Phase 3 scope.

### WR-03: cache_control tested only on system array; message content blocks untested

**File:** `tests/unit/ollama-claude-compat.test.js:61-89`
**Issue:**
COMP-01c verifies `prepareClaudeRequest` strips `cache_control` from non-last system blocks and rewrites the last as `{ type: "ephemeral", ttl: "1h" }` (formats/claude.js:221-229). But `prepareClaudeRequest` also processes `cache_control` on **message content blocks** (formats/claude.js:241-245 strips from all content blocks; lines 270-280 re-add `{ type: "ephemeral" }` to last assistant's last non-thinking block). The prompt's focus question explicitly flagged this gap. The test doesn't exercise the message-block path, so a regression that broke message-level cache_control (e.g., accidentally stripping the re-added ephemeral, or adding ttl to messages where Anthropic rejects it) would not be caught.

**Fix:** Add a COMP-01d case with an assistant message whose content array has `cache_control` on multiple blocks; assert non-last blocks lose it and the last assistant block's last non-thinking block gains `{ type: "ephemeral" }` (no ttl — the message path differs from the system path).

```javascript
it("Contract COMP-01d: cache_control on message content blocks rewritten (ollama)", () => {
  const body = {
    model: "claude-sonnet-4-5",
    messages: [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "p1", cache_control: { type: "ephemeral" } },
          { type: "text", text: "p2", cache_control: { type: "ephemeral" } },
        ],
      },
      { role: "user", content: "again" },
    ],
  };
  const result = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-sonnet-4-5", body, false, null, "ollama");
  const assistant = result.messages.find(m => m.role === "assistant");
  expect(assistant.content[0].cache_control).toBeUndefined();
  expect(assistant.content[1].cache_control).toEqual({ type: "ephemeral" }); // no ttl on messages
});
```

### WR-04: extractUsage ollama NDJSON branch untested despite file naming

**File:** `tests/unit/ollama-claude-compat.test.js:128-165`
**Issue:**
`extractUsage` (usageTracking.js:297-305) has a dedicated ollama NDJSON branch keyed on `chunk.done === true && typeof chunk.prompt_eval_count === "number"`. This is ollama's **native** usage format from `/api/chat` (the non-Claude fallback path). The file is named `ollama-claude-compat.test.js` and the header comment claims coverage of "compatibility contract for ollama", but no test exercises the native ollama usage shape — only Claude-shaped `message_start`/`message_delta`. If the non-Claude fallback path (openai client → ollama `/api/chat`) is in Phase 3 scope, this is a gap; if it's out of scope, the file's naming/comment overclaims.

**Fix:** Add COMP-03e that exercises the native branch:
```javascript
it("Contract COMP-03e: extractUsage reads ollama NDJSON (done+prompt_eval_count)", () => {
  const chunk = { model: "x", done: true, prompt_eval_count: 30, eval_count: 20 };
  const u = extractUsage(chunk);
  expect(u.prompt_tokens).toBe(30);
  expect(u.completion_tokens).toBe(20);
  expect(u.total_tokens).toBe(50);
});
```
Or, if out of scope, narrow the file header comment to "Claude-shape usage extraction for ollama `/v1/messages`".

### WR-05: COMP-03d covers cache_read but not cache_creation (symmetric risk)

**File:** `tests/unit/ollama-claude-compat.test.js:156-165`
**Issue:**
COMP-03d proves `cache_read_input_tokens` flows through `extractUsage` + `mergeUsage`. The same code branch (usageTracking.js:244-245) also maps `cache_creation_input_tokens` symmetrically. The test only covers half the pair. `canonicalizeUsage` (usageTracking.js:171) explicitly calls out that a first-write cache-miss carries only `cache_creation_input_tokens` (no `cache_read`), so the untested field is the one more likely to appear alone in real traffic — exactly the case where a regression would silently drop tokens.

**Fix:** Add a sibling assertion (or extend COMP-03d) covering `cache_creation_input_tokens`:
```javascript
const start = {
  type: "message_start",
  message: { usage: { input_tokens: 100, cache_creation_input_tokens: 15 } },
};
const merged = mergeUsage(extractUsage(start), extractUsage({ type: "message_delta", usage: { output_tokens: 50 } }));
expect(merged.cache_creation_input_tokens).toBe(15);
```

## Info

### IN-01: Redundant assertion in COMP-02a/b/c — third check is trivially true

**File:** `tests/unit/ollama-claude-compat.test.js:100-101, 112-113, 124-125`
**Issue:**
Each COMP-02 test asserts (1) `result[0] === chunk` (reference equality — `translateResponse` returns `[chunk]` wrapping the same object), then (2) `result[0].delta.stop_reason === "..."`. Since (1) establishes `result[0]` and `chunk` are the same reference, (2) is trivially `chunk.delta.stop_reason === "..."` — a property of the test's own input, not of `translateResponse`'s behavior. The third assertion adds no signal.

**Fix:** Drop the `result[0].delta.stop_reason` assertion; keep `result[0] === chunk` (which is the actual contract: identity passthrough). Or invert — drop the reference-equality check and keep only the value check if the intent is to lock the stop_reason value against future mutation.

### IN-02: COMP-01a doesn't verify tools array survives prepareClaudeRequest normalization

**File:** `tests/unit/ollama-claude-compat.test.js:14-37`
**Issue:**
COMP-01a asserts `result.tool_choice` is preserved. But for `provider="ollama"` (not `"claude"`), `prepareClaudeRequest` (formats/claude.js:331-345) strips `type` from each tool, folds `function.{name,description,parameters}` into top-level shape, and adds `cache_control: { type: "ephemeral", ttl: "1h" }` to the last tool. The test's input tool (`{ name, description, input_schema }`) happens to be a no-op for the fold (no `type` or `function` to strip), so the test passes without verifying the normalization. A future regression that broke tool normalization for non-Anthropic providers would not be caught here.

**Fix:** Add an assertion on `result.tools` shape — at minimum that the array length is unchanged and the last tool gained `cache_control`. Or split into COMP-01a (tool_choice preserved) and COMP-01a' (tools normalized correctly for non-claude provider).

---

_Reviewed: 2026-07-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
