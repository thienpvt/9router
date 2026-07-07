# Roadmap: 9Router — Claude→Ollama Passthrough (Milestone v1.0)

## Overview

This milestone delivers lossless, zero-translation routing for Claude-format clients to Ollama (cloud + local) via Ollama's native Anthropic-compatible `/v1/messages` endpoint, mirroring the existing GLM claude-transport pattern. The work is small (registry + transport config, no new deps, no custom translator) but carries real de-risking unknowns: the exact auth header scheme, SSE event handling, and field tolerance must be confirmed before wiring. Phases move from transport foundation → thinking/block fidelity → compatibility/usage → validation guards, so each phase delivers a coherent verifiable capability and the final phase proves non-Claude routing is unaffected.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Passthrough Transport & Auth** - Claude-format requests resolve targetFormat="claude" and reach ollama /v1/messages (cloud + local) with zero translation; auth scheme confirmed and wired; openai-format fallback preserved
- [ ] **Phase 2: Thinking & Block Fidelity** - Claude thinking, tool_use, text, and base64 image blocks round-trip losslessly; streaming SSE reconstructs the Anthropic event sequence
- [ ] **Phase 3: Compatibility & Fallback** - Unsupported fields tolerated, stop_reason and usage flow correctly into the Claude-compat response
- [ ] **Phase 4: Validation & Tests** - Regression, round-trip, and fallback-guard tests prove the passthrough contract holds

## Phase Details

### Phase 1: Passthrough Transport & Auth

**Goal**: Claude-format client requests to ollama (cloud + local) resolve `targetFormat="claude"` and reach ollama's native `/v1/messages` endpoint without translation, while non-Claude clients continue using the existing `/api/chat` transport unchanged
**Depends on**: Nothing (first phase)
**Requirements**: PASS-01, PASS-02, PASS-03, COMP-04
**Success Criteria** (what must be TRUE):

  1. A Claude-format request to Ollama Cloud resolves `targetFormat="claude"` and is sent to `https://ollama.com/v1/messages` with a body structurally identical to the client's (no openai intermediate hop)
  2. A Claude-format request to Ollama Local resolves `targetFormat="claude"` and is sent to `http://localhost:11434/v1/messages` (host resolved via existing `resolveOllamaLocalHost`) with the same zero-translation behavior
  3. Auth header scheme for ollama `/v1/messages` is confirmed (cloud: existing ollama API key — `x-api-key` raw or `Authorization: bearer`, confirmed against docs/probe; local: key not validated) and wired so requests authenticate successfully
  4. A non-Claude (openai-format) request to ollama still routes through the existing `/api/chat` transport unchanged — the openai/ollama-format path remains the fallback when no claude transport matches

**Plans**: 2 plans

Plans:
**Wave 1**

- [ ] 01-01-PLAN.md — Add claude transport to ollama + ollama-local registries (x-api-key raw auth, openai-format fallback preserved)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — Generalize OllamaLocalExecutor.buildUrl for runtimeTransport + Phase 1 contract self-check

### Phase 2: Thinking & Block Fidelity

**Goal**: Claude thinking, tool_use, tool_result, text, and base64 image content blocks round-trip losslessly through the passthrough, and ollama's streaming SSE reconstructs the full Anthropic event sequence back to the client
**Depends on**: Phase 1
**Requirements**: THINK-01, THINK-02, THINK-03, BLK-01, BLK-02, BLK-03, BLK-04
**Success Criteria** (what must be TRUE):

  1. Claude `thinking` content blocks in assistant messages pass through to ollama verbatim and ollama's `thinking_delta` SSE surfaces as Claude thinking blocks back to the client
  2. `output_config.effort` and the legacy `thinking` request field reach ollama unchanged under the claude transport (`applyThinking` is a no-op on the claude path; `providerThinking` on/off/level injection still functions)
  3. `tool_use` and `tool_result` content blocks round-trip losslessly (ids, names, JSON input preserved) through the claude passthrough
  4. `text` blocks and `system` (string or array) pass through unchanged; base64 `image` blocks pass through to ollama (URL images out of scope); streaming reconstructs the Anthropic SSE event sequence (`message_start` → `content_block_*` → `message_delta` → `message_stop`) without reordering or dropped events

**Plans**: TBD

Plans:

- [ ] 02-01: TBD

### Phase 3: Compatibility & Fallback

**Goal**: Fields ollama ignores are tolerated without erroring, ollama's `stop_reason` and usage values flow correctly into the gateway's Claude-compat response, and the non-Claude fallback path remains intact
**Depends on**: Phase 2
**Requirements**: COMP-01, COMP-02, COMP-03
**Success Criteria** (what must be TRUE):

  1. Fields ollama ignores (`tool_choice`, `cache_control`, `metadata`) are either stripped before send or tolerated without erroring — verified which; ollama does not return 4xx/5xx on these fields under the claude transport
  2. `stop_reason` values from ollama (`end_turn`, `max_tokens`, `tool_use`) map correctly to the Claude `stop_reason` field the client expects
  3. Usage (`input_tokens`/`output_tokens`) from ollama flows into the gateway's usage tracking under the claude transport

**Plans**: TBD

Plans:

- [ ] 03-01: TBD

### Phase 4: Validation & Tests

**Goal**: Regression, round-trip, and fallback-guard tests prove the passthrough contract holds and non-Claude routing is unaffected — locking the behavior against future refactors
**Depends on**: Phase 3
**Requirements**: VAL-01, VAL-02, VAL-03
**Success Criteria** (what must be TRUE):

  1. A regression test asserts a Claude-format request to an ollama provider resolves `targetFormat="claude"` and produces a body structurally identical to the client's (no openai intermediate)
  2. A live/recorded round-trip test confirms thinking + tool_use blocks survive end-to-end against ollama cloud (or a mock of the `/v1/messages` contract)
  3. A test guards that non-Claude (openai-format) requests to ollama still route through `/api/chat` unchanged

**Plans**: TBD

Plans:

- [ ] 04-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Passthrough Transport & Auth | 0/2 | Planning complete | - |
| 2. Thinking & Block Fidelity | 0/TBD | Not started | - |
| 3. Compatibility & Fallback | 0/TBD | Not started | - |
| 4. Validation & Tests | 0/TBD | Not started | - |

---
*Roadmap created: 2026-07-07*
*Milestone: v1.0 — Claude→Ollama Passthrough (Anthropic-compat endpoint)*
