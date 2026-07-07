---
phase: 02-thinking-block-fidelity
reviewed: 2026-07-07T00:00:00Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - open-sse/translator/concerns/thinkingUnified.js
  - open-sse/translator/formats/claude.js
  - tests/unit/ollama-claude-thinking-passthrough.test.js
  - tests/unit/ollama-claude-block-fidelity.test.js
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-07-07
**Depth:** deep
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 2 makes two surgical behavioral changes: (1) `applyThinking` short-circuits for `ollama + CLAUDE` target, and (2) `hasValidContent` recognizes `IMAGE`/`DOCUMENT` block types. Both changes are correct for their stated purpose and placed appropriately. The short-circuit sits BEFORE the `!caps.reasoning → stripAll` branch as intended, and the `hasValidContent` fix is safe because `stripUnsupportedModalities` (chatCore.js:113) already replaces unsupported image/document blocks with text placeholders BEFORE `prepareClaudeRequest` runs — so the new block types only survive for vision/pdf-capable models where keeping them is correct.

No BLOCKER-level defects found. Five WARNINGs cover a narrow edge case where the short-circuit interacts with `providerThinking` level-mode injection to leak an OpenAI-format field onto the Claude wire, plus test coverage gaps that leave the reasoning-model and document-block paths unverified. The reasoning-model gap is the most consequential: the stated THINK-02 purpose was "non-reasoning ollama models," but the implementation is unconditional and the reasoning-model behavior is never asserted.

## Critical Issues

_None._

## Warnings

### WR-01: Short-circuit leaks `reasoning_effort` (OpenAI field) onto Claude wire when `providerThinking.mode` is a level

**File:** `open-sse/translator/concerns/thinkingUnified.js:275`
**Issue:**
The short-circuit `if (provider === "ollama" && targetFormat === FORMATS.CLAUDE) return body;` fires unconditionally BEFORE `stripAll`. When a user configures `providerThinking.ollama = { mode: "high" }` (or any level: low/medium/high/max/xhigh) via the dashboard, `chatCore.js:66-68` injects `body.reasoning_effort = mode` — an OpenAI-format field. The short-circuit then preserves this field verbatim, and the body is sent to ollama's `https://ollama.com/v1/messages` (Claude Messages API endpoint) with `reasoning_effort` set but no Claude-format `thinking` or `output_config.effort`.

Trace:
1. Dashboard sets `providerThinking.ollama = { mode: "high" }` (offered by `getThinkingLevels` for reasoning models like kimi-k2.5, qwen3.5).
2. Client sends Claude-format request without thinking fields → sourceFormat=CLAUDE → resolveTransport picks claude transport → targetFormat=CLAUDE.
3. `chatCore.js:67`: `body = { ...body, reasoning_effort: "high" }` (else-if branch, since mode is not "on"/"off").
4. `translateRequest` → `applyThinking` → short-circuit fires → body unchanged.
5. `prepareClaudeRequest` does not touch `reasoning_effort`.
6. Body sent to ollama `/v1/messages` with stray `reasoning_effort` field. Claude Messages API does not define this field — ollama either silently ignores it (thinking intent lost, defeating the user's providerThinking config) or rejects with 400.

Note: this is not a regression introduced by the short-circuit — without it, `resolveFormat` returns the model's `caps.thinkingFormat` (e.g. "kimi"), and `applyFormat("kimi")` would re-set `reasoning_effort` to the same wrong field. But for NON-reasoning ollama models, the short-circuit IS worse: without it, `!caps.reasoning → stripAll` would clean up `reasoning_effort`; with it, the field survives on the wire.

**Fix:**
Gate the short-circuit more narrowly, OR normalize the injected field to Claude format before returning. The cleanest fix is to also short-circuit the `providerThinking` injection in `chatCore.js` to inject Claude-format fields when targetFormat is CLAUDE:

```js
// chatCore.js — make providerThinking injection format-aware
if (providerThinking?.mode && providerThinking.mode !== "auto") {
  const mode = providerThinking.mode;
  if (targetFormat === FORMATS.CLAUDE) {
    // Claude wire: inject thinking/output_config, not reasoning_effort
    if (mode === "on" && !body.thinking) {
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.output_config?.effort && mode !== "on" && mode !== "off") {
      body = { ...body, output_config: { effort: mode } };
    }
  } else {
    // existing OpenAI-format injection
    if (mode === "on" && !body.thinking) {
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }
}
```

Alternatively, narrow the short-circuit to only short-circuit when the body already has Claude-format thinking fields OR no thinking intent at all:

```js
// thinkingUnified.js — only short-circuit when there's nothing to normalize
if (provider === "ollama" && targetFormat === FORMATS.CLAUDE) {
  const cfg = intent || extractThinking(body);
  // If body has only Claude-format fields (or nothing), preserve as-is.
  // If it has OpenAI-format fields (reasoning_effort), fall through to normalize.
  if (!cfg || (cfg.mode === "budget" && body.thinking) || (cfg.mode === "level" && body.output_config?.effort)) {
    return body;
  }
}
```

### WR-02: Test THINK-03 claims "providerThinking-injected thinking survives" but does not exercise the injection path

**File:** `tests/unit/ollama-claude-thinking-passthrough.test.js:21-37`
**Issue:**
The test title and comment assert "providerThinking-injected thinking survives to translateRequest output," but the test sets `thinking: { type: "enabled", budget_tokens: 10000 }` directly in the body. It never calls `handleChatCore` with a `providerThinking` option, so the actual injection logic in `chatCore.js:59-69` is not exercised. This is the very path where WR-01 manifests. The test gives false confidence that providerThinking works for ollama+claude.

**Fix:**
Add an integration test that invokes `handleChatCore` (or at minimum replicates the injection) with `providerThinking = { ollama: { mode: "on" } }` and `{ mode: "high" }`, then asserts the body reaching the executor has valid Claude-format thinking fields. Or rename the existing test to accurately describe what it tests ("client-set thinking survives").

### WR-03: Short-circuit behavior for reasoning-capable ollama models is unverified

**File:** `tests/unit/ollama-claude-thinking-passthrough.test.js` (whole file)
**Issue:**
All four tests use model `"ollama-model"` — a generic name that matches no pattern in `capabilities.js`, so `getCapabilitiesForModel` returns `DEFAULT_CAPABILITIES` with `reasoning: false`. None of the tests cover an ollama model WITH reasoning capability (e.g., `kimi-k2.5`, `qwen3.5`, `glm-5`, `minimax-m3` — all listed in `providers/registry/ollama.js:34-42` and matched by reasoning patterns in `capabilities.js`).

The short-circuit fires for ALL ollama+claude requests regardless of `caps.reasoning`. For reasoning models, this skips `resolveFormat` + `applyFormat` normalization. The behavior happens to be correct (the wire is Claude, so Claude-format thinking fields should be preserved, and applying the model's native format like "kimi" would incorrectly inject `reasoning_effort` into a Claude body), but this correctness is incidental and untested. A future refactor that narrows the short-circuit to only non-reasoning models (matching the THINK-02 stated intent) would break reasoning-model clients silently.

**Fix:**
Add a test using a real reasoning-capable ollama model id:

```js
it("Contract THINK-02 reasoning: short-circuit preserves Claude thinking fields for reasoning-capable ollama model", () => {
  const body = { thinking: { type: "enabled", budget_tokens: 10000 }, output_config: { effort: "high" } };
  // kimi-k2.5 is in ollama registry and matches *kimi*k2* → reasoning:true, thinkingFormat:"kimi"
  const out = applyThinking(FORMATS.CLAUDE, "kimi-k2.5", body, "ollama");
  expect(out.thinking.type).toBe("enabled");
  expect(out.thinking.budget_tokens).toBe(10000);
  expect(out.output_config.effort).toBe("high");
  // Critical: resolveFormat("kimi") would have set reasoning_effort and stripped thinking —
  // verify that DID NOT happen.
  expect(out.reasoning_effort).toBeUndefined();
});
```

### WR-04: `hasValidContent` DOCUMENT addition is untested

**File:** `open-sse/translator/formats/claude.js:13-25` and `tests/unit/ollama-claude-block-fidelity.test.js`
**Issue:**
`hasValidContent` now recognizes both `CLAUDE_BLOCK.IMAGE` and `CLAUDE_BLOCK.DOCUMENT`, but BLK-03 only tests image-only user messages. Document-only (PDF) user messages — the other half of the fix — are never asserted. A future refactor that drops DOCUMENT from `hasValidContent` would not fail any test.

**Fix:**
Add a BLK-03b contract:

```js
it("Contract BLK-03b: document content blocks pass through unchanged", () => {
  const body = {
    model: "claude-sonnet-4-5",
    messages: [{
      role: "user",
      content: [{
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
      }],
    }],
  };
  const result = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, model, body, false, null, "ollama");
  const user = result.messages.find((m) => m.role === "user");
  expect(user).toBeDefined();  // would be filtered out without the DOCUMENT fix
  const doc = user.content.find((b) => b.type === "document");
  expect(doc).toBeDefined();
  expect(doc.source.media_type).toBe("application/pdf");
});
```

### WR-05: Short-circuit ignores `parseSuffix` model-level override for ollama+claude

**File:** `open-sse/translator/concerns/thinkingUnified.js:275`
**Issue:**
The short-circuit returns BEFORE `parseSuffix(model)` runs (line 277). A client sending `model: "kimi-k2.5(high)"` to ollama via Claude transport expects the `(high)` suffix to override thinking level. The short-circuit skips this override entirely — the suffix is not stripped, not parsed, and the override is silently ignored. The model field itself is cleaned later by `chatCore.js:138` (`stripThinkingSuffix`), so the upstream receives a valid model id, but the thinking intent encoded in the suffix is lost.

This is the same class of issue as WR-01 (short-circuit skips legitimate normalization for ollama+claude), just triggered by a different mechanism (model-name suffix vs. `providerThinking` config).

**Fix:**
Either (a) document this as a known ceiling in the ponytail comment, or (b) parse the suffix before the short-circuit and apply the override as Claude-format fields:

```js
export function applyThinking(targetFormat, model, body, provider = null, intent = undefined) {
  if (!body || typeof body !== "object") return body;

  if (provider === "ollama" && targetFormat === FORMATS.CLAUDE) {
    // Still honor model-suffix overrides for the Claude wire.
    const { override } = parseSuffix(model);
    const cfg = override || intent || extractThinking(body);
    if (!cfg) return body;
    // Normalize intent into Claude-format fields only.
    if (cfg.mode === "none") { delete body.thinking; delete body.output_config; return body; }
    if (cfg.mode === "level") { body.output_config = { effort: cfg.level }; delete body.thinking; return body; }
    if (cfg.mode === "budget") { body.thinking = { type: "enabled", budget_tokens: cfg.budget }; delete body.output_config; return body; }
    return body;
  }
  // ... existing path
}
```

## Info

### IN-01: ponytail comment correctly documents ceiling and upgrade path

**File:** `open-sse/translator/concerns/thinkingUnified.js:273-274`
**Issue:**
The `ponytail:` comment ("ceiling = ollama under claude transport. Lift into PROVIDERS[ollama].quirks or a capability flag if a second native-claude provider lands.") appropriately names the ceiling (single provider with claude transport) and the upgrade path. Compliant with the lazy-dev convention.

### IN-02: `hasValidContent` IMAGE/DOCUMENT check does not validate block payload

**File:** `open-sse/translator/formats/claude.js:16-22`
**Issue:**
The new IMAGE/DOCUMENT checks test only `block.type`, not whether the block has valid content (e.g., `block.source?.data` exists). A malformed block like `{ type: "image" }` (no `source`) now passes `hasValidContent`, so its message is kept and sent upstream, where it will be rejected. Previously such messages were dropped. This is consistent with the existing `TOOL_USE` pattern (also type-only check, no validation of `name`/`input`), so it's not a regression in consistency — just a note that malformed blocks are now kept rather than silently dropped. Low risk since malformed blocks are rare and upstream rejection is the correct response anyway.

### IN-03: `handlesThinkingBlocks("ollama")` returns false — signature validation skipped

**File:** `open-sse/translator/formats/claude.js:89-91`
**Issue:**
`handlesThinkingBlocks` only returns true for `claude`, `anthropic-compatible-*`, and `deepseek`. For ollama, the thinking-block signature validation pass in `prepareClaudeRequest` (lines 285-322) is skipped entirely. This means invalid/non-Claude thinking signatures in combo-mixed conversation history are sent verbatim to ollama's claude endpoint. This is pre-existing behavior (not introduced by Phase 2) and is arguably correct for ollama's claude-compatible endpoint (which may have its own signature semantics). Flagging only because combo-mixed history with foreign signatures could trigger upstream rejections — worth verifying against ollama's actual behavior.

---

_Reviewed: 2026-07-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
