# 9Router — Claude→Ollama Passthrough Milestone

## What This Is

9Router is a local AI routing gateway + Next.js dashboard exposing one OpenAI-compatible `/v1/*` endpoint and routing across 40+ upstream providers with format translation, multi-account/combo fallback, OAuth/API-key credential management, and token/usage tracking. This fork-specific planning layer tracks a single targeted milestone on the routing engine (`open-sse/`).

## Core Value

Claude Code clients get lossless, zero-translation access to Ollama (cloud + local) through Ollama's native Anthropic-compatible endpoint — no lossy claude→openai→ollama double-hop.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ OpenAI-compatible routing across providers (upstream, maintained on master)
- ✓ GLM claude-format passthrough transport (`glm.js` `transports[]` claude entry) — the pattern this milestone copies

### Active

<!-- Current scope. Building toward these. -->

- [ ] Ollama Cloud + Local advertise a claude-format transport pointing at `/v1/messages` so `resolveTransport("ollama","claude")` skips translation
- [ ] Claude thinking blocks + `output_config.effort` pass through natively and surface via ollama's `thinking_delta` SSE
- [ ] tool_use / tool_result / text / image(base64) content blocks round-trip lossless through passthrough
- [ ] Unsupported fields (tool_choice, cache_control, metadata, document/citations/URL-image blocks) stripped or ignored without erroring
- [ ] Existing openai-format transport preserved as fallback for non-Claude clients; non-Claude source still uses ollama `/api/chat` double-hop unchanged

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Custom `claude:ollama` translator (lossy hand-rolled mapping) — unnecessary; ollama ships a native Anthropic-compat endpoint, so passthrough beats a translator. Revisit only if ollama drops `/v1/messages`.
- Per-model `thinkingFormat` wiring for ollama — not needed under passthrough; Claude body (incl. `thinking`, `output_config.effort`) is sent verbatim and ollama accepts it. The pre-passthrough `applyThinking` rewrite to vendor dialects (zai/qwen/etc.) becomes a no-op for the claude transport.
- `budget_tokens` enforcement on ollama — ollama docs state "accepted but not enforced"; not something the gateway can fix.
- `count_tokens`, `batches`, citations/document blocks — ollama does not support them.

## Context

- **Branch**: `milestone/claude-ollama-direct-transport`, based off `master` (commit b10b807, v0.5.20). `.planning/` seeded from `consolidated` (codebase architecture docs + config.json). The proxy/socks5 WIP on consolidated was stashed (`stash@{0}`) before branching — unrelated to this milestone.
- **Investigation finding**: Claude Code sends Claude-format requests. Today Ollama Cloud has a single `transport.format:"ollama"` → `targetFormat:"ollama"` → forced `claude→openai→ollama` double-hop (no direct `claude:ollama` translator registered; only `claude:openai` + `claude:kiro`). GLM avoids this by advertising a `transports[]` claude entry (`/api/anthropic/v1/messages`) so `resolveTransport` matches and translation is skipped.
- **Ollama anthropic-compat endpoint** (`/v1/messages`, base `http://localhost:11434` local / `https://ollama.com` cloud): supports `model`, `max_tokens`, `messages` (text/image-base64/tool_use/tool_result/thinking blocks), `system`, `stream`, `temperature`, `top_p`, `top_k`, `stop_sequences`, `tools`, `thinking`. Streaming SSE: `message_start`, `content_block_start`, `content_block_delta` (`text_delta`/`input_json_delta`/`thinking_delta`), `content_block_stop`, `message_delta`, `message_stop`, `ping`, `error`. Ignores: `tool_choice`, `metadata`, `cache_control`, `budget_tokens` (accepted not enforced), `document`/citations blocks, URL images. Probe confirmed both `ollama.com/api/chat` and `ollama.com/v1/messages` return 405 on GET (endpoints exist, accept POST).
- **Relevant code**: `open-sse/services/provider.js` `resolveTransport()`, `open-sse/handlers/chatCore.js:64-67` (transport selection → targetFormat), `open-sse/translator/index.js:78` (same-format skip), `open-sse/providers/registry/ollama.js` + `ollama-local.js`, `open-sse/providers/registry/glm.js` (template).

## Constraints

- **Compatibility**: Must not break non-Claude clients routing to ollama — the openai/ollama-format path stays as fallback.
- **Format**: New transport uses `format:"claude"` and `prepareClaudeRequest` finalization (already runs when `targetFormat==="claude"` in translator/index.js:118).
- **Auth**: Ollama accepts an API key "not validated" for local; cloud uses the existing ollama API key. Confirm exact header scheme during investigation phase (likely `x-api-key` raw or `Authorization: bearer`).
- **Dependencies**: No new npm deps. Pure registry + transport config change.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Passthrough over custom translator | Ollama ships native `/v1/messages`; passthrough is lossless and ~10 lines vs a hand-rolled fragile translator | — Pending |
| Branch off master, planning from consolidated | Keep milestone isolated from consolidated's in-progress proxy/socks5 work; reuse mapped codebase docs | — Pending |
| Cover cloud + local in one milestone | Both share `format:"ollama"` and both expose `/v1/messages`; one transport pattern serves both | — Pending |
| Full thinking passthrough, no per-model `thinkingFormat` | Claude body carries `thinking`/`output_config.effort` verbatim; ollama accepts `thinking` blocks + emits `thinking_delta` | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-07 after milestone v1.0 start*