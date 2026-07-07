# Phase 4: Validation & Tests - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 2 (new test files)
**Analogs found:** 2 / 2

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tests/unit/ollama-claude-regression.test.js` *(VAL-01 + VAL-03 consolidated)* | test | request-response | `tests/unit/ollama-claude-transport.test.js` | exact (same phase-milestone, same harness) |
| `tests/unit/ollama-claude-round-trip.test.js` *(VAL-02 mocked SSE)* | test | streaming | `tests/translator/golden-response-stream.test.js` | exact (same slice: chunk array → translateResponse → assert order/identity) |

> File names are not yet fixed — CONTEXT leaves structure at Claude's discretion ("one consolidated or separate files per VAL id"). The two-file split above is the recommended shape per analog match quality: regression has a unit-resolve analog, round-trip has a stream-replay analog — different slices, different files.

## Pattern Assignments

### `tests/unit/ollama-claude-regression.test.js` (test, request-response — VAL-01 + VAL-03)

**Analog:** `tests/unit/ollama-claude-transport.test.js`

**Imports pattern** (`tests/unit/ollama-claude-transport.test.js` lines 1-3):
```javascript
import { describe, expect, it } from "vitest";
import { resolveTransport } from "../../open-sse/services/provider.js";
import OllamaLocalExecutor from "../../open-sse/executors/ollama-local.js";
```

**Harness pattern** — direct import from `open-sse/`, no mocks, no network:
```javascript
describe("Phase N: <topic>", () => {
  it("Contract <ID>: <one-line invariant>", () => {
    const t = resolveTransport("ollama", "claude");
    expect(t.format).toBe("claude");
    expect(t.baseUrl).toBe("https://ollama.com/v1/messages");
  });
});
```

**VAL-01 body-identity assertion — extend with translateRequest deep-equal** *(analog: `tests/unit/ollama-claude-block-fidelity.test.js` lines 31-46 already proves field-level identity; VAL-01 formalizes it as a deep-equal against the input body)*:
```javascript
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

it("Contract VAL-01: dispatched body structurally identical to client body (no openai intermediate)", () => {
  const body = {
    model: "claude-sonnet-4-5",
    messages: [{ role: "user", content: "hi" }],
    system: "You are helpful",
    thinking: { type: "enabled" },
    output_config: { effort: "high" },
  };
  const result = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, body.model, body, false, null, "ollama");
  // Structural identity: same-shape passthrough must not mutate client body.
  expect(result).toMatchObject(body);
  // Negative: never routed through OpenAI intermediate (no choices/messages-array rewrites).
  expect(result).not.toHaveProperty("choices");
});
```

**VAL-03 fallback guard — already proven by Phase 1 transport Contract B/C, link, don't duplicate** *(per CONTEXT line 23; also documented in `tests/unit/ollama-claude-compat.test.js` lines 11-15 WR-01 — re-asserting `resolveTransport(ollama, openai) === null` adds zero signal)*:
```javascript
// VAL-03 reference guard: openai-format requests resolve no claude transport,
// so they fall through to /api/chat. Phase 1 transport Contract B + C proves
// both limbs (resolveTransport returns null AND buildUrl returns /api/chat
// without runtimeTransport). A clearly-named regression assertion here locks
// the contract to Phase 4:
it("Contract VAL-03: openai-format request to ollama routes /api/chat (no claude transport matches)", () => {
  expect(resolveTransport("ollama", "openai")).toBeNull();
  expect(resolveTransport("ollama-local", "openai")).toBeNull();
  const exec = new OllamaLocalExecutor();
  expect(exec.buildUrl("", true, 0, null)).toBe("http://localhost:11434/api/chat");
});
```

**Error handling pattern:** none — these tests are pure-function; no try/catch needed. Vitest surfaces thrown errors as test failures.

---

### `tests/unit/ollama-claude-round-trip.test.js` (test, streaming — VAL-02)

**Analog:** `tests/translator/golden-response-stream.test.js`

**Imports pattern** (analog lines 4-7):
```javascript
import { describe, it, expect } from "vitest";
import "./registerAll.js";   // only if response translator registry needs warming; for CLAUDE→CLAUDE identity this is NOT required
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
```

> Note: CLAUDE→CLAUDE is identity passthrough at `open-sse/translator/index.js:152` (`if (sourceFormat === targetFormat) return [chunk]`). No `registerAll.js` import is needed for the round-trip — confirm by deleting the import if the test still passes.

**Core harness pattern — feed chunk array through translateResponse, accumulate, assert order/identity** (analog lines 24-33):
```javascript
function runStream(targetFormat, sourceFormat, events) {
  const state = initState(sourceFormat);
  const all = [];
  for (const ev of events) {
    const out = translateResponse(targetFormat, sourceFormat, ev, state);
    if (Array.isArray(out)) all.push(...out);
    else if (out) all.push(out);
  }
  return all;
}
```

**VAL-02 mock: recorded `/v1/messages` SSE event sequence** (analog lines 37-50 already constructs the Claude SSE shape end-to-end; round-trip test reuses it verbatim, then drives it through CLAUDE→CLAUDE instead of CLAUDE→OPENAI):
```javascript
it("Contract VAL-02: thinking + tool_use survive end-to-end through claude passthrough (mocked /v1/messages)", () => {
  // Recorded ollama /v1/messages SSE contract — one event per message_start/content_block_*/message_delta/message_stop.
  const events = [
    { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4-5", usage: { input_tokens: 10 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me think" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Answer" } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "get_weather" } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"city":"NYC"}' } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ];

  const out = runStream(FORMATS.CLAUDE, FORMATS.CLAUDE, events);

  // Order preserved, no events dropped: same count, same type sequence.
  expect(out.map((e) => e.type)).toEqual(events.map((e) => e.type));

  // Identity passthrough — each event reaches client UNCHANGED (no openai intermediate hop).
  for (let i = 0; i < events.length; i++) {
    expect(out[i]).toBe(events[i]);   // translateResponse returns [chunk] (===) on same-format
  }

  // VAL-02 headline invariants: thinking AND tool_use blocks present in stream.
  const thinkingDelta = out.find((e) => e.delta?.type === "thinking_delta");
  const toolUseStart = out.find((e) => e.content_block?.type === "tool_use");
  expect(thinkingDelta.delta.thinking).toBe("let me think");
  expect(toolUseStart.content_block.id).toBe("toolu_1");
  expect(toolUseStart.content_block.name).toBe("get_weather");

  // input_json_delta partial_json also survives verbatim.
  const jsonDelta = out.find((e) => e.delta?.type === "input_json_delta");
  expect(jsonDelta.delta.partial_json).toBe('{"city":"NYC"}');
});
```

**Stop_reason / usage assertion** (analog lines 48 + `tests/unit/ollama-claude-compat.test.js` lines 141-152 — same identity contract, different framing):
```javascript
// VAL-02 also locks stop_reason='tool_use' + usage reach the client (COMP-02/03
// proven at translator level; here it's proven at the SSE reconstruction level).
const stopReason = out.find((e) => e.type === "message_delta");
expect(stopReason.delta.stop_reason).toBe("tool_use");
expect(stopReason.usage.output_tokens).toBe(5);
```

**Error handling pattern:** none — pure-function slice; exceptions surface as test failures. The `runStream` helper does not swallow throws.

---

## Shared Patterns

### Test harness conventions
**Source:** `tests/vitest.config.js` + all Phase 1-3 `tests/unit/ollama-claude-*.test.js` files
**Apply to:** both new files
```javascript
// vitest config (tests/vitest.config.js): globals enabled, include ["**/*.test.js"],
//   alias `open-sse/` → ../open-sse, `@/` → ../src. Both new tests import from
//   `../../open-sse/...` (relative) which works regardless of alias state.
// Run from repo root: `npx vitest run -c tests/vitest.config.js tests/unit/ollama-claude-round-trip.test.js`
```

### Describe/it naming
**Source:** Phase 1-3 test files (consistent across all four)
**Apply to:** both new files
```javascript
describe("Phase N: <topic>", () => {
  it("Contract <ID>: <one-line invariant>", () => { ... });
});
```
- Phase number matches milestone phase (here: Phase 4)
- Contract ID uses the VAL-NN requirement code or a locally-scoped label

### No-network / no-mock-deps discipline
**Source:** All Phase 1-3 unit tests
**Apply to:** both new files
- Direct imports from `open-sse/translator/index.js`, `open-sse/services/provider.js`, `open-sse/executors/ollama-local.js`
- No `vi.mock`, no `fetch` interception, no `undici MockAgent`
- VAL-02 "mock" = **inline recorded chunk array**, NOT a fetch mock. CONTEXT line 47: "prefer constructing response chunks directly over modifying executor code".

## No Analog Found

None. Both new files have an exact analog in the repo.

| File | Closest existing reference |
|------|---------------------------|
| `tests/unit/ollama-claude-regression.test.js` | Phase 1 transport test (exact) + Phase 2 block-fidelity test (for translateRequest body-identity assertion shape) |
| `tests/unit/ollama-claude-round-trip.test.js` | `tests/translator/golden-response-stream.test.js` (exact — same slice, same harness, same event shape) |

## Metadata

**Analog search scope:**
- `tests/unit/ollama-claude-*.test.js` (4 files — Phase 1/2/3 harness pattern)
- `tests/translator/golden-response-stream.test.js` (VAL-02 SSE replay analog)
- `tests/translator/claude-kiro-direct.test.js` (secondary — thinking_delta + input_json_delta assertion shape)
- `tests/translator/real/thinking.real.test.js` (rejected — live/network, RUN_REAL gated; not the right analog for a checkout-green mock)
- `open-sse/translator/index.js:149-189` (translateResponse contract — verifies same-format `[chunk]` identity is the load-bearing property)
- `open-sse/handlers/chatCore/sseToJsonHandler.js` (considered, rejected — this handler is OpenAI/Responses-API non-streaming coercion, NOT the Claude streaming slice; CLAUDE→CLAUDE identity makes it irrelevant to VAL-02)

**Files scanned:** 7
**Pattern extraction date:** 2026-07-08
