---
phase: 04-validation-tests
reviewed: 2026-07-08T00:30:00Z
depth: deep
files_reviewed: 1
files_reviewed_list:
  - tests/unit/ollama-claude-regression.test.js
findings:
  critical: 2
  warning: 3
  info: 3
  total: 8
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-07-08T00:30:00Z
**Depth:** deep
**Files Reviewed:** 1
**Status:** issues_found

## Summary

Scope: `tests/unit/ollama-claude-regression.test.js` (the Phase 4 test-only deliverable). VAL-02 lives in a sibling file (`tests/unit/ollama-claude-round-trip.test.js`) outside the `files:` scope; observations on VAL-02 are noted where it bears on the prompt's fidelity questions, but the findings below center on the regression file.

Cross-file tracing was performed against `open-sse/translator/index.js` (`translateRequest`, `translateResponse`), `open-sse/translator/formats/claude.js` (`prepareClaudeRequest`), `open-sse/translator/concerns/thinkingUnified.js` (`applyThinking`), `open-sse/services/provider.js` (`resolveTransport`), `open-sse/executors/ollama-local.js` and `default.js` (`buildUrl`), and `open-sse/providers/registry/ollama{,-local}.js`.

Headline issue: VAL-01's `toMatchObject` derives its expected shape from the same mutated `body` reference that produced `result`. The assertion cannot observe the original client-request shape and therefore cannot lock the contract it claims to lock. This is a contract-regression-detection gap that defeats the test's stated purpose ("Locks the passthrough contract against future refactors"). Confirmed empirically: `body === result` and `JSON.stringify(body)` differs before vs after the call (cache_control added to `tools[0]`, signature blocks potentially injected, etc.).

## Critical Issues

### CR-01: VAL-01 `toMatchObject` expected shape derived from same ref as `result` — cannot detect passthrough regressions

**File:** `tests/unit/ollama-claude-regression.test.js:53-59` (also affects the VAL-01-local block at `92-97` and the cache_control block at `130`)

**Issue:** `translateRequest` is documented (and verified by running it) to mutate `body` in place: `let result = body;` at `open-sse/translator/index.js:54` and every downstream step (`stripContentTypes`, `normalizeThinkingConfig`, `ensureToolCallIds`, `fixMissingToolResponses`, `applyThinking`, `prepareClaudeRequest`) mutates `result`/`body`. `result === body` after return (empirically confirmed). The test then constructs:

```js
expect(result).toMatchObject({
  messages: body.messages,        // body === result, so body.messages === result.messages
  system: body.system,
  thinking: body.thinking,
  output_config: body.output_config,
  tools: body.tools,
});
```

The `expected` literal is built at test-run time from `body` AFTER `translateRequest` already mutated it. So this reduces to `result.X === result.X` for every key — trivially true regardless of what the translator did. A regression that:

- adds `budget_tokens` to `thinking` (a plausible `applyThinking` change),
- strips `output_config` (e.g. if a future quirk sets `dropOutputConfig`),
- rewrites `system` from string to array (prepareClaudeRequest does this in some branches),
- renames fields on `tools[*]`,

would all pass this test silently. The test's stated purpose in its own header (`VAL-01 formalizes it as a scoped deep-equal on the passthrough fields`) is not achieved.

Confirmed by running: `expect({a:1,b:{x:1}}).toMatchObject({a:body.a,b:body.b})` where `delete body.b` ran before, fails ONLY because `body.b` returns `undefined` and the key is absent on the received side — but if the regression MUTATES rather than DELETES the field (the realistic case — adding `budget_tokens`, normalizing shape, etc.), toMatchObject with a self-derived expected value passes trivially.

Vitest `toMatchObject({k: undefined})` semantics also vary depending on whether the key exists vs. is absent on the received side (verified empirically), so the test's behavior on field deletion is not even predictable across vitest versions.

**Fix:** snapshot the client body BEFORE calling `translateRequest`, then compare `result` against the snapshot (not against the mutated body):

```js
const body = { /* ... */ };
const clientSnapshot = structuredClone(body);   // or JSON.parse(JSON.stringify(body))

const result = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, body.model, body, false, null, "ollama");

expect(result).toMatchObject({
  messages: clientSnapshot.messages,
  system: clientSnapshot.system,
  thinking: clientSnapshot.thinking,        // now proves thinking survived untouched
  output_config: clientSnapshot.output_config,
  tools: clientSnapshot.tools,
});
```

Use `structuredClone` (Node ≥17) or `JSON.parse(JSON.stringify(body))` for the snapshot. Without this, the regression-guard claim in the test header is false.

### CR-02: VAL-01 cache_control assertion too narrow — does not lock COMP-01c/d, only documents it

**File:** `tests/unit/ollama-claude-regression.test.js:105-134`

**Issue:** The test is named `"Contract VAL-01 cache_control: prepareClaudeRequest may rewrite cache_control; passthrough fields unaffected"` and the comment explicitly references Phase 3 COMP-01c/d. The body of the test, however, asserts only:

```js
expect(result.messages[0].content[0].text).toBe("hi");
```

This proves text content survives. It does NOT lock any cache_control behavior — neither the rewrite (that prepareClaudeRequest deletes `cache_control` from message content blocks, per `formats/claude.js:241-244`) nor the preservation (that system-array cache_control gets ttl-1h rewriting, per `formats/claude.js:221-229`). The comment line 132-133 concedes this: "cache_control shape is NOT asserted." But the test name says "passthrough fields unaffected" — overclaiming vs. the body of the test.

This block adds near-zero regression coverage: it documents COMP-01c/d in prose but does not encode any invariant. If a future refactor changed prepareClaudeRequest to (e.g.) drop the message entirely when cache_control is present, this test would still pass as long as `result.messages[0].content[0].text === "hi"` survives.

**Fix:** either assert the actual cache_control contract (verified empirically: prepareClaudeRequest strips `cache_control` from content blocks, so `result.messages[0].content[0].cache_control` should be `undefined`):

```js
expect(result.messages[0].content[0].text).toBe("hi");
expect(result.messages[0].content[0].cache_control).toBeUndefined();   // locks COMP-01d strip
```

Or rename the test to reflect what it actually asserts (e.g. `"text content survives cache_control normalization"`) and drop the COMP-01 framing from the comment.

## Warnings

### WR-01: VAL-03 is a verbatim re-statement of Phase 1 Contract B/C — no incremental coverage

**File:** `tests/unit/ollama-claude-regression.test.js:136-145`

**Issue:** VAL-03 asserts three facts:

```js
expect(resolveTransport("ollama", "openai")).toBeNull();
expect(resolveTransport("ollama-local", "openai")).toBeNull();
expect(exec.buildUrl("", true, 0, null)).toBe("http://localhost:11434/api/chat");
```

Cross-referencing `tests/unit/ollama-claude-transport.test.js:20-26` (Phase 1 Contract B) and `:43-46` (Phase 1 Contract C fallback), these are the same three assertions, same inputs, same expected values. VAL-03's own comment concedes this: "Phase 1 transport Contract B + C proves the mechanics: resolveTransport returns null AND buildUrl returns /api/chat without runtimeTransport."

A regression guard that re-asserts the same atom-level facts in a different file provides defense-in-depth (locks the contract if Phase 1's file is deleted), but the prompt's question "Is VAL-03 a genuine guard or just re-asserting Phase 1?" — answer: it is just re-asserting Phase 1. There is no new behavioral coverage (no integration with `chatCore.js` routing decision, no end-to-end "given an openai-format request, the gateway hits `/api/chat`" assertion, no positive test that claude-format requests hit `/v1/messages`).

**Fix:** If the intent is a real fallback guard, test the actual routing decision boundary, not the atoms. For example, assert that `OllamaLocalExecutor.buildUrl` with a claude `runtimeTransport` returns `/v1/messages` (the positive path that VAL-03 omits — Phase 1 Contract C covers this, but VAL-03 doesn't):

```js
const creds = { runtimeTransport: { baseUrl: "http://localhost:11434/v1/messages", format: "claude" } };
expect(exec.buildUrl("", true, 0, creds)).toBe("http://localhost:11434/v1/messages");
```

Or accept VAL-03 as-is (defense-in-depth duplicate) and update the header comment to drop "guard" framing — call it what it is: a regression lock that mirrors Phase 1.

### WR-02: VAL-01 (ollama) missing negative assertions for OpenAI intermediate artifacts beyond `choices`

**File:** `tests/unit/ollama-claude-regression.test.js:62`

**Issue:** The negative-proof comment at line 61 claims `"never routed through OpenAI intermediate"` but the assertion is:

```js
expect(result).not.toHaveProperty("choices");
```

This only catches one OpenAI-shape leak. `choices` is the most visible OpenAI field but not the only one — an OpenAI intermediate hop would also produce `messages[*].role === "system"` hoisting, `tool_calls` instead of `tools[*].input_schema`, `reasoning_effort` instead of `output_config.effort`, content-block shape conversion (`{type:"text",text}` → `{type:"text",text}` is identical but `{type:"image",source}` → `{type:"image_url",image_url:{url}}` is not). The narrow negative assertion can pass while a partial OpenAI rewrite silently leaks through.

**Fix:** add a small batch of negative assertions covering the high-signal OpenAI-only fields:

```js
expect(result).not.toHaveProperty("choices");
expect(result.messages?.[0]).not.toHaveProperty("tool_calls");   // OpenAI tool shape
expect(result).not.toHaveProperty("reasoning_effort");           // OpenAI thinking field
// tools[*] should keep input_schema, not OpenAI's function.parameters
expect(result.tools?.[0]).not.toHaveProperty("function");
expect(result.tools?.[0]?.input_schema).toBeDefined();
```

### WR-03: `OllamaLocalExecutor` imported only to exercise the fallback path — positive claude-path buildUrl never tested in this file

**File:** `tests/unit/ollama-claude-regression.test.js:3, 143-144`

**Issue:** VAL-03 imports `OllamaLocalExecutor` but only calls `exec.buildUrl("", true, 0, null)` (null credentials → `/api/chat` fallback). The whole point of the milestone is the claude-format passthrough, whose URL is built via the `runtimeTransport.baseUrl` branch at `ollama-local.js:11-25` (host-substituted `/v1/messages`). That branch — the one the milestone actually depends on — is not exercised anywhere in this regression file. Phase 1's `ollama-claude-transport.test.js:28-41` covers it; VAL-03 does not.

**Fix:** if VAL-03 is meant to lock the fallback decision end-to-end, also assert the positive claude path in the same `it` block (one extra line, see WR-01 fix). Otherwise drop the `OllamaLocalExecutor` import and just re-assert `resolveTransport` returns null — the existing buildUrl assertion adds nothing over Phase 1.

## Info

### IN-01: VAL-01 header comment claims "no openai rewrite" but only `choices` is checked

**File:** `tests/unit/ollama-regression.test.js:16` (header block, lines 11-23)

**Issue:** Comment says: "VAL-01 formalizes it as a scoped deep-equal on the passthrough fields + a negative assertion (no 'choices' array, no openai rewrite)." The phrase "no openai rewrite" overstates what is asserted (see WR-02). Either tighten the comment to "no `choices` array" or add the additional negative assertions from WR-02.

**Fix:** align the comment with the assertion surface.

### IN-02: VAL-01-local comment block (lines 65-71) describes thinking/output_config normalization but no test encodes the described shape

**File:** `tests/unit/ollama-claude-regression.test.js:65-71`

**Issue:** The comment claims `thinking gets budget_tokens normalized in and output_config (OpenAI-shaped) is stripped` for ollama-local. This is accurate per `applyThinking` at `thinkingUnified.js:270-308` (general path runs for `provider === "ollama-local"`, format resolves to `claude-budget`, `stripAll` removes `output_config`). But the test only asserts `messages/system/tools` survive — it does not encode the described `thinking = {type:"enabled", budget_tokens:N}` shape or the absence of `output_config`. The asymmetry documentation is prose-only.

**Fix (optional):** add one positive assertion that locks the described shape:

```js
expect(result.thinking?.type).toBe("enabled");
expect(result.thinking?.budget_tokens).toEqual(expect.any(Number));
expect(result.output_config).toBeUndefined();
```

This would convert the comment from documentation into a real invariant. Without it, the asymmetry comment can drift out of sync with the code silently.

### IN-03: Test file describe-block title does not match contents — claims "VAL-01 regression + VAL-03 fallback guard" but also includes a third cache_control `it` block

**File:** `tests/unit/ollama-claude-regression.test.js:30`

**Issue:** The describe title `"Phase 4: VAL-01 regression + VAL-03 fallback guard"` omits the cache_control block (lines 105-134). Minor — the cache_control block is conceptually part of VAL-01 per its header, but the describe title reads as exhaustive.

**Fix:** update to `"Phase 4: VAL-01 regression (incl. cache_control) + VAL-03 fallback guard"` or leave as-is (the per-`it` titles disambiguate).

---

_Cross-file observations on VAL-02 (in `tests/unit/ollama-claude-round-trip.test.js`, outside the formal review scope but flagged by the prompt):_

- _VAL-02 header claims `"thinking + tool_use survive end-to-end through claude passthrough"` but the test only invokes `translateResponse(CLAUDE, CLAUDE, ev, state)` per chunk — this hits the `if (sourceFormat === targetFormat) return [chunk];` identity branch at `translator/index.js:152`. No `chatCore.js`, no executor fetch, no SSE parser, no runStream in the gateway path. The `toBe(events[i])` identity assertion is real and does prove the identity-passthrough invariant at the translator level, but `"end-to-end"` overclaims — the same test would pass for any provider with `format:"claude"` since the identity branch is provider-agnostic._
- _VAL-02 mock events are constructed inline, not recorded from a live ollama `/v1/messages` stream (comment at line 34 says `"Recorded ollama /v1/messages SSE contract"` — misleading). PROJECT.md line 51 documents `ping` and `error` as part of ollama's SSE contract; neither is exercised by VAL-02's mock._
- _VAL-02's `runStream` accumulator omits `stripVolatile` (justified in its comment for the identity case). This is correct for CLAUDE→CLAUDE identity, but if VAL-02 is ever extended to non-identity pairs, the missing `stripVolatile` will produce flaky `Date.now()`-dependent failures._

_Reviewed: 2026-07-08T00:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
