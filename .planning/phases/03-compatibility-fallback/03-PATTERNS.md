# Phase 3: Compatibility & Fallback - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** 1 new (test-only) + 1 conditional modify
**Analogs found:** 2 / 2

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tests/unit/ollama-claude-compat.test.js` (new, name at planner discretion) | test | request-response (contract assert) + streaming (SSE usage extraction) | `tests/unit/ollama-claude-transport.test.js` (Phase 1) + `tests/unit/ollama-claude-block-fidelity.test.js` (Phase 2) | exact |
| `open-sse/handlers/chatCore/sseToJsonHandler.js` (conditional modify — only if COMP-03 test reveals a usage-extraction gap) | handler (chatCore) | streaming + non-streaming (SSE→JSON usage) | self: existing Claude-shape `usage.input_tokens` handling (lines 125-127, 135, 146-147, 201) | exact (in-file) |

## Pattern Assignments

### `tests/unit/ollama-claude-compat.test.js` (test, request-response + streaming)

**Analog A (test harness — exact):** `tests/unit/ollama-claude-transport.test.js` (Phase 1, 47 lines) — the contract-test template the planner should copy verbatim for file shape.

Imports pattern (lines 1-4):
```javascript
import { describe, expect, it } from "vitest";
import { resolveTransport } from "../../open-sse/services/provider.js";
import OllamaLocalExecutor from "../../open-sse/executors/ollama-local.js";
```

Describe/it/Contract-named pattern (lines 5-12):
```javascript
describe("Phase 1: Claude passthrough transport", () => {
  it("Contract A: resolveTransport(ollama, claude) returns /v1/messages", () => {
    const t = resolveTransport("ollama", "claude");
    expect(t).not.toBeNull();
    expect(t.format).toBe("claude");
    expect(t.baseUrl).toBe("https://ollama.com/v1/messages");
  });
```

Convention to follow:
- `describe("Phase N: <title>", ...)` outer block
- `it("Contract <ID>: <assertion>", ...)` inner blocks — Contract naming is enforced across phases
- Direct imports from `../../open-sse/...` (relative paths, no `@/` alias in tests)
- No mocking unless required — real module imports + synthetic objects

**Analog B (translateRequest + translateResponse contract shape — exact):** `tests/unit/ollama-claude-block-fidelity.test.js` (Phase 2, 211 lines) — the closest analog for COMP-01/02 verification, since it exercises `translateRequest`/`translateResponse` on the claude→claude passthrough path.

Imports pattern (lines 1-3):
```javascript
import { describe, expect, it } from "vitest";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
```

Request-side contract pattern (lines 31-52) — copy this shape for COMP-01:
```javascript
const result = translateRequest(
  FORMATS.CLAUDE,
  FORMATS.CLAUDE,
  model,
  body,
  false,
  null,
  "ollama"
);

const assistant = result.messages.find((m) => m.role === "assistant");
// ... assertions on preserved fields
```

Response-side contract pattern (lines 204-210) — copy this shape for COMP-02 (stop_reason passthrough):
```javascript
it("Contract BLK-04: same-format response passthrough returns [chunk] unchanged", () => {
  const chunk = { type: "message_start", message: { id: "msg_1" } };
  const result = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBe(1);
  expect(result[0]).toBe(chunk);
});
```

For COMP-02: feed a `message_delta` chunk with `delta.stop_reason: "tool_use"` and assert it survives `translateResponse` unchanged (same-format returns `[chunk]` at `open-sse/translator/index.js:152-153`).

**Analog C (usage extraction contract — exact):** `open-sse/utils/usageTracking.js` `extractUsage` (lines 233-257) — the function COMP-03 must drive. Test feeds synthetic `message_start` + `message_delta` chunks and asserts `extractUsage` returns the Claude-shape tokens.

```javascript
// message_start usage → input_tokens
if (chunk.type === "message_start" && chunk.message?.usage && typeof chunk.message.usage === "object") {
  const u = chunk.message.usage;
  return normalizeUsage({
    prompt_tokens: u.input_tokens || 0,
    completion_tokens: u.output_tokens || 0,
    cache_read_input_tokens: u.cache_read_input_tokens,
    cache_creation_input_tokens: u.cache_creation_input_tokens
  });
}

// message_delta usage → output_tokens (final)
if (chunk.type === "message_delta" && chunk.usage && typeof chunk.usage === "object") {
  return normalizeUsage({
    prompt_tokens: chunk.usage.input_tokens || 0,
    completion_tokens: chunk.usage.output_tokens || 0,
    cache_read_input_tokens: chunk.usage.cache_read_input_tokens,
    cache_creation_input_tokens: chunk.usage.cache_creation_input_tokens
  });
}
```

Import for COMP-03 test:
```javascript
import { extractUsage, mergeUsage } from "../../open-sse/utils/usageTracking.js";
```

COMP-03 test shape (synthetic chunks, no live call):
```javascript
it("Contract COMP-03: message_start+message_delta usage merges into prompt/completion tokens", () => {
  const start = { type: "message_start", message: { usage: { input_tokens: 100 } } };
  const delta = { type: "message_delta", usage: { output_tokens: 50 } };
  const u = mergeUsage(extractUsage(start), extractUsage(delta));
  expect(u.prompt_tokens).toBe(100);
  expect(u.completion_tokens).toBe(50);
});
```

**Fallback guard test (implicit PASS-03 guard — analog A lines 20-26):**
```javascript
it("Contract B fallback: resolveTransport(ollama, openai) === null", () => {
  expect(resolveTransport("ollama", "openai")).toBeNull();
});
```
Phase 3 extends this to assert the full non-Claude path routes through `/api/chat` (targetFormat="ollama"), not just transport resolution.

---

### `open-sse/handlers/chatCore/sseToJsonHandler.js` (handler, streaming + non-streaming) — CONDITIONAL MODIFY

**Analog (in-file, exact):** the existing Claude-shape usage handling already at lines 125-127, 135, 146-147, 201. Per CONTEXT integration point: "If a test reveals a usage-extraction gap (e.g. usage shape mismatch), scope a minimal fix."

Current Claude-aware usage handling (lines 125-127, 146-147):
```javascript
const usage = jsonResponse.usage || {};
appendLog({ tokens: usage, status: "200 OK" });
saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint });

// ...
const inTokens = usage.input_tokens || 0;
const outTokens = usage.output_tokens || 0;
```

`saveUsageStats` (`open-sse/handlers/chatCore/requestDetail.js:77-104`) already accepts both `input_tokens`/`prompt_tokens` shapes (lines 80-81):
```javascript
const inTokens = tokens.input_tokens ?? tokens.prompt_tokens ?? 0;
const outTokens = tokens.output_tokens ?? tokens.completion_tokens ?? 0;
```

Planner guidance: do NOT pre-emptively modify. The current code already handles `input_tokens`/`output_tokens` (Claude shape). Only modify if the COMP-03 test proves a gap (e.g. non-streaming `parsed.usage` path at line 201 reads `usage` but a specific ollama shape slips through). If a fix is needed, it is a 1-3 line adjustment to the existing Claude-shape branches — do not add an ollama-specific code path.

---

## Shared Patterns

### Test harness convention
**Source:** `tests/unit/ollama-claude-transport.test.js`, `tests/unit/ollama-claude-block-fidelity.test.js`, `tests/unit/ollama-claude-thinking-passthrough.test.js`
**Apply to:** All Phase 3 test files

```javascript
import { describe, expect, it } from "vitest";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Phase 3: <title>", () => {
  it("Contract <ID>: <assertion>", () => {
    // direct module call + synthetic object, no mock framework
  });
});
```

### translateRequest / translateResponse call shape (claude→claude passthrough)
**Source:** `tests/unit/ollama-claude-block-fidelity.test.js:31-39, 204-206`
**Apply to:** COMP-01 (field tolerance) + COMP-02 (stop_reason) tests

```javascript
const result = translateRequest(
  FORMATS.CLAUDE, FORMATS.CLAUDE, model, body, false, null, "ollama"
);
// OR for response:
const result = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
// same-format returns [chunk] unchanged (index.js:152-153)
```

### Usage extraction (Claude-shape aware)
**Source:** `open-sse/utils/usageTracking.js:233-257`
**Apply to:** COMP-03 test

`extractUsage(chunk)` handles `message_start.message.usage` and `message_delta.usage` generically (Claude-shape). `mergeUsage` combines them (start carries input+cache, delta carries final output). `saveUsageStats` (`requestDetail.js:80-81`) accepts both `input_tokens`/`prompt_tokens` shapes. The chain is already provider-agnostic — COMP-03 verifies this, does not extend it.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All Phase 3 files have exact analogs in Phase 1/2 test harness + existing usage handlers |

## Metadata

**Analog search scope:**
- `tests/unit/` (4 ollama-claude test files scanned)
- `open-sse/handlers/chatCore/` (4 files: sseToJsonHandler, nonStreamingHandler, streamingHandler, requestDetail)
- `open-sse/utils/usageTracking.js`, `open-sse/utils/stream.js`, `open-sse/utils/bypassHandler.js`
- `open-sse/translator/index.js` (translateResponse same-format passthrough)

**Files scanned:** 11
**Pattern extraction date:** 2026-07-07