# Phase 2: Thinking & Block Fidelity - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Ensure Claude `thinking`, `tool_use`, `tool_result`, `text`, and base64 `image` content blocks round-trip losslessly through the ollama claude passthrough, and that ollama's native Anthropic SSE event sequence reaches the client unchanged. The core code change is making `applyThinking` a no-op on the `claude`→`ollama` path so `thinking`/`output_config.effort` aren't stripped; everything else is verifying the existing same-format skip + `prepareClaudeRequest` leave Claude-native blocks untouched for ollama.

</domain>

<decisions>
## Implementation Decisions

### Thinking Field Passthrough (THINK-01, THINK-02)
- `applyThinking` MUST be a no-op when `targetFormat==="claude" && provider==="ollama"` — return `body` unchanged. Today `applyThinking` calls `stripAll(body)` when `!caps.reasoning`, which would strip the client's `thinking` field and `output_config.effort` before they reach ollama. Short-circuit at the top of `applyThinking` for the ollama claude path.
- `providerThinking` on/off/level injection (chatCore.js:59-69) continues to function: it mutates `body.thinking`/`body.reasoning_effort` BEFORE `translateRequest`, and with `applyThinking` short-circuited the injection survives to ollama.
- Thinking blocks in assistant messages (prior turns) pass through verbatim: `prepareClaudeRequest` only rewrites them `if handlesThinkingBlocks(provider)` (claude.js:87), and `handlesThinkingBlocks` returns true only for `claude`/`anthropic-compatible-*`/`deepseek` — ollama is NOT in that list, so the thinking-block loop is skipped for ollama. Do NOT add ollama to `handlesThinkingBlocks`.
- Verified by a unit test: claude→ollama request with `thinking:{type:"enabled"}` + `output_config:{effort:"high"}` → `translateRequest` output retains both fields unchanged.

### Content Block Fidelity (BLK-01, BLK-02, BLK-03)
- `tool_use`/`tool_result` blocks (ids, names, JSON input) survive the same-format skip: `sourceFormat===targetFormat` (claude→claude) skips the translateRequest body-conversion (index.js:78). Only `ensureToolCallIds` + `fixMissingToolResponses` run pre-skip — verify they don't mangle Claude-native blocks (they should be no-ops on well-formed Claude input).
- `prepareClaudeRequest` tools normalization (claude.js:329-343) runs for `provider !== "claude"`: strips `type`, folds `function.{name,description,parameters}` into `{name,description,input_schema}`. For Claude-native tools (already `{name,description,input_schema}`, no `function`, no `type`) the map returns `rest` unchanged. Confirm + unit-test that MCP/`type:"custom"` tools aren't dropped (they may carry a `type` field that gets stripped — verify that's acceptable for ollama).
- `text` blocks + `system` (string or array) pass unchanged except `cache_control` rewrites (system: last block gets `{type:"ephemeral",ttl:"1h"}`; messages: cache_control stripped, last assistant block gets `{type:"ephemeral"}`). Whether ollama tolerates the added `cache_control` is Phase 3 COMP-01's concern — Phase 2 only confirms text content itself is untouched.
- Base64 `image` blocks (`source.type:"base64"`) pass through: same-format skip leaves message content untouched; `prepareClaudeRequest` doesn't touch image blocks. URL images are out of scope (REQUIREMENTS).

### Streaming SSE Reconstruction (BLK-04)
- Forward ollama's native SSE stream unchanged: `translateResponse` returns `[chunk]` on same-format (index.js:152-153). ollama `/v1/messages` emits the full Anthropic sequence natively (`message_start` → `content_block_start` → `content_block_delta` (`text_delta`/`input_json_delta`/`thinking_delta`) → `content_block_stop` → `message_delta` → `message_stop` → `ping`/`error` per PROJECT.md investigation). The gateway does NOT reconstruct.
- `DefaultExecutor` handles the stream for ollama cloud; `OllamaLocalExecutor extends DefaultExecutor` for local. `buildHeaders` sets `Accept: text/event-stream` when `stream` is true. Confirm both honor `stream:true`.
- Full event-sequence round-trip (no reordering/dropped events) is verified in Phase 4 VAL-02 (live/recorded round-trip against ollama cloud or a `/v1/messages` mock). Phase 2 leaves ONE unit test asserting the same-format response passthrough returns chunks unchanged (the reconstruction contract).
- Non-streaming (`stream:false`): ollama's JSON response body is forwarded as-is on the same-format path; confirm it carries the Claude response shape.

### Claude's Discretion
Exact placement of the `applyThinking` ollama short-circuit (early-return at function top vs a provider check inside the `!caps.reasoning` branch), the unit-test file naming/location under `tests/unit/`, and whether to add a focused assertion for `ensureToolCallIds`/`fixMissingToolResponses` no-op behavior — at Claude's discretion, guided by existing test conventions.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `open-sse/translator/concerns/thinkingUnified.js` `applyThinking(targetFormat, model, body, provider, intent)` — the ONE function to short-circuit for ollama. `stripAll(body)` at the `!caps.reasoning` branch is what strips the client's thinking field today.
- `open-sse/translator/formats/claude.js` `prepareClaudeRequest` (lines 189-368) — runs on every `targetFormat==="claude"` target including ollama; `handlesThinkingBlocks(provider)` (line 87) gates the thinking-block rewrite (ollama excluded).
- `open-sse/translator/index.js` `translateRequest` (same-format skip at line 78) + `translateResponse` (same-format passthrough at line 152) — the lossless passthrough the milestone relies on.
- `open-sse/handlers/chatCore.js:59-69` — `providerThinking` injection (must keep functioning post-applyThinking short-circuit).
- `tests/unit/ollama-claude-transport.test.js` (Phase 1) — the existing test harness for ollama claude-transport contracts; Phase 2 extends it or adds a sibling test.

### Established Patterns
- Same-format source→target skips translation entirely (request: index.js:78, response: index.js:152) — the foundation of lossless passthrough.
- `prepareClaudeRequest` is the single claude-target finalizer (index.js:118); it already runs for ollama and is mostly benign (cache_control + tool normalization), but its thinking-block rewrite is gated off for non-Anthropic providers.
- Capability gating: `getCapabilitiesForModel(provider, model).reasoning` drives `applyThinking`; ollama models currently have no `reasoning` capability entry → `stripAll` runs.

### Integration Points
- `open-sse/translator/concerns/thinkingUnified.js` — add the ollama-claude short-circuit in `applyThinking`.
- `tests/unit/` — new self-check(s) for thinking + block fidelity.
- No registry changes (Phase 1 already wired the claude transport). No new translator (Out of Scope).

</code_context>

<specifics>
## Specific Ideas

The single behavioral fix is the `applyThinking` ollama-claude no-op (THINK-02). Everything else is verification that the existing same-format passthrough + `prepareClaudeRequest` leave Claude-native blocks untouched for ollama. Keep Phase 2 minimal — do NOT add a `claude:ollama` translator (Out of Scope) and do NOT change `prepareClaudeRequest`'s ollama behavior beyond what the tests prove is broken.

</specifics>

<deferred>
## Deferred Ideas

None within Phase 2 scope. Full event-sequence round-trip + live auth-success probe → Phase 4 (VAL-02). `cache_control`/`tool_choice`/`metadata` tolerance → Phase 3 (COMP-01). Per-model native reasoning knobs (NATIVE-01) and `budget_tokens` enforcement (NATIVE-02) → v2.

</deferred>