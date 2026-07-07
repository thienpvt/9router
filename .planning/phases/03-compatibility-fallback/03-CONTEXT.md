# Phase 3: Compatibility & Fallback - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify fields ollama ignores (`tool_choice`, `cache_control`, `metadata`) are tolerated without erroring under the claude transport, confirm ollama's `stop_reason` and `usage` values flow correctly into the gateway's Claude-compat response + usage tracking, and lock the non-Claude (openai-format) fallback path as intact. Mostly verification — the same-format passthrough + generic usage extraction already handle the Claude-shaped values ollama emits natively; Phase 3 proves this and adds guard tests.

</domain>

<decisions>
## Implementation Decisions

### Ignored Fields Tolerance (COMP-01)
- Tolerate `tool_choice`/`cache_control`/`metadata` — send as-is to ollama `/v1/messages`. Per PROJECT.md investigation ollama ignores unknown fields (and accepts `cache_control`/`anthropic-version` headers silently); no stripping needed.
- Keep `prepareClaudeRequest`'s existing `cache_control` rewrite (adds `{type:"ephemeral",ttl:"1h"}` to last system/assistant/tool block) — ollama tolerates the rewritten form. Do NOT add ollama-specific stripping.
- `tool_choice` is only deleted by prepareClaudeRequest when the tools array is empty (claude.js:355-358) — otherwise it passes to ollama. Tolerated.
- Verify via unit test that `tool_choice`/`metadata` survive `translateRequest` (sourceFormat=claude, targetFormat=claude, provider=ollama) to the dispatched body. Live 4xx confirmation deferred to Phase 4 VAL-02 (round-trip/mock of the `/v1/messages` contract).

### stop_reason Flow (COMP-02)
- No translation: same-format response passthrough (`translateResponse` returns `[chunk]`, index.js:152-153) forwards ollama's `message_delta.stop_reason` unchanged to the Claude client. ollama emits Claude-native values (`end_turn`/`max_tokens`/`tool_use`) per PROJECT.md → direct match, no mapping needed.
- Do NOT add a stop_reason normalizer for ollama. The OpenAI-pivot path's `finishReason.js` is irrelevant here (same-format skips it).

### Usage Flow (COMP-03)
- Streaming: `open-sse/handlers/chatCore/sseToJsonHandler.js:59-67` reads `chunk.usage` generically from the SSE stream; lines 135/146-147 map `input_tokens`/`output_tokens` (Claude shape) → `prompt_tokens`/`completion_tokens` for the gateway's usage tracking (`saveUsageStats`/`appendRequestLog`). Works for ollama's Claude-shaped `message_start`/`message_delta` usage.
- Non-streaming: `sseToJsonHandler.js:125/201` reads `jsonResponse.usage` / `parsed.usage`; confirm ollama non-stream response carries `usage:{input_tokens,output_tokens}`.
- Verify via unit test that feeding an ollama-shaped `message_start` (usage:{input_tokens:N}) + `message_delta` (delta:{stop_reason:"tool_use"}) through the response path delivers the values to the client AND the gateway's usage extraction captures input/output tokens.

### Non-Claude Fallback Intact (implicit — already proven by Phase 1 PASS-03)
- The openai-format path routes via the existing `transport` object (format:"ollama", `/api/chat`) unchanged — Phase 1 left it byte-identical and Phase 1's contract test asserts `resolveTransport("ollama","openai")===null`. Phase 3 adds a guard test confirming a non-Claude (openai-format) request to ollama still routes through `/api/chat` (targetFormat="ollama"), not the claude transport.

### Claude's Discretion
Exact unit-test file naming/location under `tests/unit/`, whether to combine the COMP contracts into one test file or split, and whether to feed synthetic SSE chunks directly to `translateResponse`/`sseToJsonHandler` or construct a minimal mock stream — at Claude's discretion, guided by the Phase 1/2 test harness pattern.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `open-sse/translator/index.js` `translateResponse` same-format passthrough (line 152-153) — forwards ollama's native SSE unchanged.
- `open-sse/handlers/chatCore/sseToJsonHandler.js` — generic `chunk.usage` extraction (line 59-67) + Claude-shape→tracking mapping (lines 135, 146-147, 182). The usage-tracking entry point for streamed responses.
- `open-sse/translator/formats/claude.js` `prepareClaudeRequest` — already manages `cache_control` (rewrites, doesn't strip) + deletes `tool_choice` only when tools empty (line 355-358). Confirms the tolerate-don't-strip decision.
- `tests/unit/ollama-claude-transport.test.js` (Phase 1) + `ollama-claude-block-fidelity.test.js` (Phase 2) — test harness patterns (vitest, direct imports, Contract-named `it` blocks).

### Established Patterns
- Same-format source→target skips both request (index.js:78) and response (index.js:152) translation — ollama's native Anthropic-shaped request/response pass through.
- Usage tracking reads `chunk.usage` / `jsonResponse.usage` generically, agnostic to provider — already Claude-shape-aware.
- Fallback: `resolveTransport` returns null for unmatched sourceFormat → falls back to the provider's default `transport` object.

### Integration Points
- `tests/unit/` — new self-check(s) for COMP-01/02/03 + fallback guard.
- No source code changes expected (the existing passthrough + usage extraction already handle the Claude-shaped values). If a test reveals a gap (e.g. usage shape mismatch), scope a minimal fix.

</code_context>

<specifics>
## Specific Ideas

Phase 3 is primarily verification — prove the existing same-format passthrough + generic usage extraction deliver COMP-01/02/03, and lock the non-Claude fallback with a guard test. Minimal/no source code change expected. Keep it lean — do NOT add a stop_reason normalizer or ollama-specific field stripping unless a test proves the current behavior broken.

</specifics>

<deferred>
## Deferred Ideas

None within Phase 3 scope. Live 4xx/round-trip confirmation → Phase 4 VAL-02. Per-model reasoning knobs + budget_tokens → v2.

</deferred>