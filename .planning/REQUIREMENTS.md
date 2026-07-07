# Requirements: 9Router — Claude→Ollama Passthrough Milestone

**Defined:** 2026-07-07
**Core Value:** Claude Code clients get lossless, zero-translation access to Ollama (cloud + local) through Ollama's native Anthropic-compatible endpoint.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Passthrough Transport

- [x] **PASS-01**: Ollama Cloud registry advertises a `claude`-format transport at `https://ollama.com/v1/messages` so a Claude-format client request resolves `targetFormat="claude"` and skips translation
- [x] **PASS-02**: Ollama Local registry advertises a `claude`-format transport at `http://localhost:11434/v1/messages` (host resolved via existing `resolveOllamaLocalHost`) with the same passthrough behavior
- [x] **PASS-03**: The existing `ollama`-format transport (`/api/chat`) remains the fallback when no claude transport matches, so non-Claude clients are unaffected

### Thinking

- [ ] **THINK-01**: Claude `thinking` content blocks in assistant messages pass through to ollama `/v1/messages` verbatim and the gateway surfaces ollama's `thinking_delta` SSE as Claude thinking blocks back to the client
- [ ] **THINK-02**: Claude `output_config.effort` (and the legacy `thinking` request field) reach ollama unchanged under the claude transport — `applyThinking` does not rewrite them into a vendor dialect for the ollama claude path
- [ ] **THINK-03**: `providerThinking` on/off/level injection (`chatCore.js:73-83`) continues to function for ollama under the claude transport

### Block Fidelity

- [ ] **BLK-01**: `tool_use` and `tool_result` content blocks round-trip losslessly (ids, names, JSON input preserved) through the claude passthrough
- [ ] **BLK-02**: `text` content blocks and `system` (string or array) pass through unchanged
- [ ] **BLK-03**: Base64 `image` content blocks pass through to ollama (ollama supports base64 only — URL images are out of scope)
- [ ] **BLK-04**: Streaming response reconstructs the Anthropic SSE event sequence (`message_start` → `content_block_*` → `message_delta` → `message_stop`) into the client-facing Claude stream without reordering or dropped events

### Compatibility

- [ ] **COMP-01**: Fields ollama ignores (`tool_choice`, `cache_control`, `metadata`) are either stripped before send or tolerated without erroring (verify which; ollama accepts `cache_control`/`anthropic-version` headers silently)
- [ ] **COMP-02**: `stop_reason` values from ollama (`end_turn`, `max_tokens`, `tool_use`) map correctly to the Claude `stop_reason` field the client expects
- [ ] **COMP-03**: Usage (`input_tokens`/`output_tokens`) from ollama flows into the gateway's usage tracking under the claude transport
- [x] **COMP-04**: Auth header scheme for ollama `/v1/messages` is confirmed and wired (local: API key not validated; cloud: existing ollama API key — likely `x-api-key` raw or `Authorization: bearer`, confirm against docs/probe)

### Validation

- [ ] **VAL-01**: A regression test asserts a Claude-format request to an ollama provider resolves `targetFormat="claude"` and produces a body structurally identical to the client's (no openai intermediate)
- [ ] **VAL-02**: A live/recorded round-trip test confirms thinking + tool_use blocks survive end-to-end against ollama cloud (or a mock of the `/v1/messages` contract)
- [ ] **VAL-03**: Non-Claude (openai-format) request to ollama still routes through `/api/chat` unchanged — guarded by a test

## v2 Requirements

Deferred to future milestone.

### Per-Model Native Knobs

- **NATIVE-01**: Map ollama-local per-model `think` boolean / vendor reasoning fields for models ollama runs but the gateway doesn't tag with `reasoning` caps today
- **NATIVE-02**: Surface ollama `budget_tokens` (accepted-not-enforced) behavior to the dashboard if ollama later enforces it

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Custom `claude:ollama` translator (hand-rolled lossy mapping) | Ollama ships native `/v1/messages`; passthrough is lossless and far smaller. Revisit only if ollama drops the endpoint. |
| Per-model `thinkingFormat` wiring for ollama under passthrough | Claude body carries `thinking`/`output_config.effort` verbatim; ollama accepts `thinking` blocks. Vendor-dialect rewrite (zai/qwen/etc.) becomes a no-op on the claude transport. |
| `budget_tokens` enforcement | Ollama docs: "accepted but not enforced." Not fixable gateway-side. |
| `/v1/messages/count_tokens`, `/v1/messages/batches` | Ollama does not support these. |
| `document` (PDF), `citations`, URL-image content blocks | Ollama `/v1/messages` does not support them (base64 images only). |
| Ollama Anthropic-compat quirks beyond passthrough (e.g. token-count approximations) | Inherent to ollama; not a gateway concern. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PASS-01 | Phase 1 | Complete |
| PASS-02 | Phase 1 | Complete |
| PASS-03 | Phase 1 | Complete |
| THINK-01 | Phase 2 | Pending |
| THINK-02 | Phase 2 | Pending |
| THINK-03 | Phase 2 | Pending |
| BLK-01 | Phase 2 | Pending |
| BLK-02 | Phase 2 | Pending |
| BLK-03 | Phase 2 | Pending |
| BLK-04 | Phase 2 | Pending |
| COMP-01 | Phase 3 | Pending |
| COMP-02 | Phase 3 | Pending |
| COMP-03 | Phase 3 | Pending |
| COMP-04 | Phase 1 | Complete |
| VAL-01 | Phase 4 | Pending |
| VAL-02 | Phase 4 | Pending |
| VAL-03 | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 17 total
- Mapped to phases: 17 (100%)
- Unmapped: 0

| Phase | Requirements |
|-------|--------------|
| Phase 1 — Passthrough Transport & Auth | PASS-01, PASS-02, PASS-03, COMP-04 (4) |
| Phase 2 — Thinking & Block Fidelity | THINK-01, THINK-02, THINK-03, BLK-01, BLK-02, BLK-03, BLK-04 (7) |
| Phase 3 — Compatibility & Fallback | COMP-01, COMP-02, COMP-03 (3) |
| Phase 4 — Validation & Tests | VAL-01, VAL-02, VAL-03 (3) |

---
*Requirements defined: 2026-07-07*
*Last updated: 2026-07-07 after roadmap creation (17/17 mapped)*
