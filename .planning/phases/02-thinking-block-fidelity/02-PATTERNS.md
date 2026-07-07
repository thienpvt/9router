# Phase 2: Thinking & Block Fidelity - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** 2 (1 modify, 1 new)
**Analogs found:** 2 / 2

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `open-sse/translator/concerns/thinkingUnified.js` (modify `applyThinking`) | utility (concern) | transform | self: existing `!caps.reasoning` branch (lines 277-280) + `handlesThinkingBlocks` provider-gate in `formats/claude.js:87` | exact (in-file + sibling) |
| `tests/unit/ollama-claude-thinking-blocks.test.js` (new, name at planner discretion) | test | request-response (contract assert) | `tests/unit/ollama-claude-transport.test.js` (Phase 1) | exact |

## Pattern Assignments

### `open-sse/translator/concerns/thinkingUnified.js` (utility, transform) — MODIFY

**Analog A (in-file): the existing capability-gated strip branch.** `applyThinking` (lines 269-287) already branches on a capability check and early-returns. The ollama short-circuit is a second early-return of the same shape, placed *before* the `!caps.reasoning` branch so it wins for `provider==="ollama"` even though ollama has no `reasoning` capability entry.

Existing branch to mirror (lines 269-281):

```javascript
export function applyThinking(targetFormat, model, body, provider = null, intent = undefined) {
  if (!body || typeof body !== "object") return body;

  const { cleanModel, override } = parseSuffix(model);
  const cfg = override || intent || extractThinking(body);
  const caps = getCapabilitiesForModel(provider, cleanModel);

  // Model cannot reason → strip any stray thinking fields.
  if (!caps.reasoning) {
    stripAll(body);
    return body;
  }
  if (!cfg) return body;
  // ...
}
```

Placement target (CONTEXT decision): insert an ollama-claude early-return between line 270 (`if (!body...)`) and line 277 (`if (!caps.reasoning)`). Shape:

```javascript
// ponytail: ceiling = ollama under claude transport. Lift into PROVIDERS[ollama].quirks
// or a capability flag if a second native-claude provider lands.
if (provider === "ollama" && targetFormat === "claude") return body;
```

**Analog B (sibling): provider-gated branch in `formats/claude.js:87-89`.** Exact same pattern — whitelist providers by exact-string + prefix match. This is the established project convention for "this provider is special-cased under claude target":

```javascript
function handlesThinkingBlocks(provider) {
  return provider === "claude" || provider?.startsWith("anthropic-compatible") || provider === "deepseek";
}
```

Note: CONTEXT explicitly says do NOT add `ollama` to `handlesThinkingBlocks` — that gate is for assistant-message thinking-block rewrites, a different concern. The new short-circuit lives in `applyThinking` only.

**What `stripAll` does today (lines 164-174) — the behavior being skipped for ollama:**

```javascript
function stripAll(body) {
  delete body.thinking;
  delete body.reasoning_effort;
  delete body.reasoning;
  delete body.thinkingConfig;
  delete body.enable_thinking;
  delete body.thinking_budget;
  delete body.output_config;   // ← THINK-02: this would strip the client's effort
  if (body.generationConfig) delete body.generationConfig.thinkingConfig;
  if (body.request?.generationConfig) delete body.request.generationConfig.thinkingConfig;
}
```

**Why ollama hits this branch today (must confirm in test):** `getCapabilitiesForModel(provider, model)` defaults `reasoning: false` (`capabilities.js:43`), and ollama has no entry in `MODEL_CAPABILITIES` (grep for `ollama` in capabilities.js returns no matches). So `caps.reasoning` is falsy → `stripAll` runs → `output_config.effort` + `thinking` get deleted before reaching ollama. The short-circuit prevents this.

**Capability gate proof (`capabilities.js:40-46`):**

```javascript
// features
search: false,        // built-in web search tool / grounding
tools: true,          // function / tool calling
reasoning: false,     // thinking / reasoning  ← default; ollama inherits this
```

**Imports pattern (already in file, no change):**

```javascript
import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { PROVIDERS } from "../../providers/index.js";
import { LEVEL_TO_BUDGET, budgetToLevel, effortToBudget, effortToThinkingLevel } from "./thinking.js";
```

**Error handling pattern:** none — `applyThinking` is fail-open by design (it mutates body, never throws). The short-circuit is a pure early-return, so no new error path.

---

### `tests/unit/ollama-claude-thinking-blocks.test.js` (test, request-response contract) — NEW

**Analog:** `tests/unit/ollama-claude-transport.test.js` (Phase 1, 47 lines). Same harness pattern — vitest, no mocks, exercise real translator functions, assert contract.

**Full harness to copy (file is short — reproduce verbatim as the skeleton):**

```javascript
import { describe, expect, it } from "vitest";
import { resolveTransport } from "../../open-sse/services/provider.js";
import OllamaLocalExecutor from "../../open-sse/executors/ollama-local.js";

describe("Phase 1: Claude passthrough transport", () => {
  it("Contract A: resolveTransport(ollama, claude) returns /v1/messages", () => {
    const t = resolveTransport("ollama", "claude");
    expect(t).not.toBeNull();
    expect(t.format).toBe("claude");
    expect(t.baseUrl).toBe("https://ollama.com/v1/messages");
  });
  // ... more contracts
});
```

**Conventions to keep:**
- `describe("Phase N: <topic>", ...)` block title includes phase number — Phase 2 test should say `"Phase 2: ..."`.
- `it("Contract X: <behavior>", ...)` — each test names a contract.
- Import paths: relative `../../open-sse/...` (vitest config resolves from repo root, see CLAUDE.md).
- No `beforeEach`/setup — pure function in/out.
- Assertion style: direct `expect(...).toBe(...)` / `.toEqual(...)` / `.not.toBeNull()`.

**Imports for Phase 2 test (real translator entrypoints — same file as production code):**

```javascript
import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
```

(Claude's discretion per CONTEXT — `ollama-claude-thinking-blocks.test.js` or split into two siblings. One file matches Phase 1's "one phase = one transport contract file" cadence.)

**Test contracts to cover (from CONTEXT decisions + REQUIREMENTS THINK-01..03, BLK-01..04):**

| Test name (suggested) | Contract | Code pattern |
|---|---|---|
| `Contract THINK-02: applyThinking no-ops on ollama+claude path` | `applyThinking("claude", "ollama-model", {thinking:{type:"enabled"}, output_config:{effort:"high"}}, "ollama")` returns body unchanged (`thinking` + `output_config` survive) | direct `applyThinking(...)` call |
| `Contract THINK-02 negative: applyThinking still strips for non-ollama non-reasoning provider` | same body, `provider="some-non-reasoning"` → `thinking`/`output_config` deleted (regression guard that the short-circuit is ollama-specific) | direct `applyThinking(...)` call |
| `Contract THINK-03: providerThinking-injected thinking survives to translateRequest output` | body with `thinking:{type:"enabled",budget_tokens:10000}` (mimics chatCore.js:63 injection) → after `translateRequest("claude","claude",model,body,...,"ollama")`, output still has `thinking` | `translateRequest(...)` end-to-end |
| `Contract BLK-01: tool_use/tool_result blocks survive same-format skip` | claude-shape body with `messages:[{role:assistant,content:[{type:"tool_use",id:"toolu_1",name:"foo",input:{x:1}}]},{role:"user,content:[{type:"tool_result",tool_use_id:"toolu_1",content:"bar"}]}]` → `translateRequest("claude","claude",...,provider="ollama")` preserves both blocks verbatim | `translateRequest(...)` |
| `Contract BLK-02: text blocks + system pass through` | body with `system:"hi"` + `messages:[{role:"user",content:[{type:"text",text:"hello"}]}]` → output unchanged (modulo cache_control rewrite which is Phase 3's concern) | `translateRequest(...)` |
| `Contract BLK-03: base64 image block survives` | body with `content:[{type:"image",source:{type:"base64",media_type:"image/png",data:"iVBOR..."}}]` → preserved | `translateRequest(...)` |
| `Contract BLK-04: same-format response passthrough returns chunks unchanged` | `translateResponse("claude","claude",chunk,state)` returns `[chunk]` (one-line assertion mirroring `index.js:152-153`) | direct `translateResponse(...)` call |

The THINK-02 + BLK-04 tests are the explicit "ONE runnable check" the planner must include (CONTEXT: "Phase 2 leaves ONE unit test asserting the same-format response passthrough returns chunks unchanged"). Others are at planner's discretion but cheap.

---

## Shared Patterns

### Same-format passthrough (the foundation)

**Source:** `open-sse/translator/index.js:78` (request skip) + `index.js:152-153` (response passthrough)
**Apply to:** All BLK-01..04 verification tests — they rely on this contract holding for `(claude, claude)` under `provider="ollama"`.

```javascript
// translateRequest (line 78):
if (sourceFormat !== targetFormat) { /* translation */ }
// → for claude→claude + ollama, body passes through to applyThinking/prepareClaudeRequest untouched.

// translateResponse (lines 152-153):
if (sourceFormat === targetFormat) {
  return [chunk];   // ← BLK-04 reconstruction contract: chunks forwarded verbatim
}
```

### Capability default → stripAll (the bug THINK-02 fixes)

**Source:** `open-sse/providers/capabilities.js:43` (`reasoning: false` default) + `thinkingUnified.js:277-279` (the branch that fires `stripAll`).
**Apply to:** THINK-02 test must assert the short-circuit beats this branch for ollama.

### prepareClaudeRequest still runs for ollama

**Source:** `open-sse/translator/index.js:118-121` + `open-sse/translator/formats/claude.js:189` + `claude.js:87` (`handlesThinkingBlocks` excludes ollama).
**Apply to:** BLK-02 test expectations — `cache_control` rewrites and max_tokens clamping WILL run; test must assert only the content survives, not that the body is byte-identical. (CONTEXT decisions BLK-02: "Whether ollama tolerates the added cache_control is Phase 3 COMP-01's concern — Phase 2 only confirms text content itself is untouched.")

```javascript
// index.js:118-121 — prepareClaudeRequest always runs when target is claude (incl. ollama):
if (targetFormat === FORMATS.CLAUDE) {
  const apiKey = credentials?.accessToken || credentials?.apiKey || null;
  result = prepareClaudeRequest(result, provider, apiKey, connectionId, credentials?.rawHeaders, clientSessionId);
}
```

### providerThinking injection (THINK-03 — must keep working, no code change)

**Source:** `open-sse/handlers/chatCore.js:59-69` — mutates `body.thinking` / `body.reasoning_effort` BEFORE `translateRequest`. With `applyThinking` short-circuited, the injection survives. Test by passing a body already shaped like the injection output.

```javascript
// chatCore.js:59-69:
if (providerThinking?.mode && providerThinking.mode !== "auto") {
  const mode = providerThinking.mode;
  if (mode === "on" && !body.thinking) {
    body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
  } else if (mode === "off" && !body.thinking) {
    body = { ...body, thinking: { type: "disabled" } };
  } else if (!body.reasoning_effort) {
    body = { ...body, reasoning_effort: mode };
  }
}
```

---

## No Analog Found

None. Both files have exact analogs in-repo.

## Metadata

**Analog search scope:**
- `open-sse/translator/concerns/thinkingUnified.js` (modify target — read in full)
- `open-sse/translator/index.js` (read in full)
- `open-sse/translator/formats/claude.js` (targeted read: `handlesThinkingBlocks` + `prepareClaudeRequest`)
- `open-sse/handlers/chatCore.js` (targeted read: `providerThinking` injection)
- `open-sse/providers/capabilities.js` (grep: confirmed ollama absent, `reasoning: false` default)
- `tests/unit/ollama-claude-transport.test.js` (read in full — primary test analog)
- `tests/unit/*.test.js` listing (naming convention survey)

**Files scanned:** 6 source + 1 test + test dir listing
**Pattern extraction date:** 2026-07-07
