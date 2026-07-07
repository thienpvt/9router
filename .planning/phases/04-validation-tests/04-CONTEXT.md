# Phase 4: Validation & Tests - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure/test phase — no grey areas; smart-discuss infrastructure skip)

<domain>
## Phase Boundary

Consolidate the passthrough contract into a formal regression + round-trip + fallback-guard suite (VAL-01/02/03). Proves the Phase 1-3 contract holds and locks it against future refactors. Much of VAL-01/03 is already covered by Phase 1's `ollama-claude-transport.test.js`; Phase 4 adds the VAL-02 round-trip (thinking + tool_use survive end-to-end against a mocked `/v1/messages`) and consolidates/labels the regression + fallback assertions as the formal gate.

</domain>

<decisions>
## Implementation Decisions

### VAL-02 round-trip: mock, not live
- The round-trip test uses a MOCK of ollama's `/v1/messages` SSE contract, NOT a live provider call. Rationale: (a) live needs credentials not present on plain checkout; (b) the test suite must pass green on a fresh checkout (CLAUDE.md: tests are vitest, not all-green but new tests must be self-contained); (c) REQUIREMENTS VAL-02 explicitly permits "a mock of the /v1/messages contract".
- The mock replays a recorded `/v1/messages` SSE sequence (`message_start` → `content_block_start`/`delta` (text_delta + thinking_delta + input_json_delta) → `content_block_stop` → `message_delta` (stop_reason + usage) → `message_stop`) per PROJECT.md's documented event shape. The test drives a request through the gateway's request→dispatch→response path (or the closest importable slice) and asserts thinking + tool_use blocks survive to the client-facing stream.

### VAL-01 + VAL-03: consolidate existing coverage
- VAL-01 (regression: claude-format request resolves targetFormat="claude", body structurally identical to client's) — already proven by Phase 1's transport test (resolveTransport + same-format skip). Phase 4 adds an explicit regression assertion if the existing test doesn't already assert "body structurally identical" (deep-equal of dispatched body vs client body, no openai intermediate).
- VAL-03 (non-Claude openai-format request routes /api/chat unchanged) — already proven by Phase 1's fallback contracts. Phase 4 ensures a named guard exists (Phase 3's WR-01 removed a duplicate; the ownership is Phase 1 transport test — confirm a clearly-named guard remains or add one here).

### Claude's Discretion
Exact test file structure (one consolidated `ollama-claude-regression.test.js` or separate files per VAL id), how to mock the SSE stream (a fake fetch/executor, or construct the response chunks directly and feed through translateResponse + the streaming reconstruction), and whether to add a snapshot of the dispatched body — at Claude's discretion, guided by the existing test harness pattern (vitest, direct imports, no network). No source code changes to open-sse expected.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tests/unit/ollama-claude-transport.test.js` (Phase 1) — resolveTransport + buildUrl + openai-fallback contracts. VAL-01/03 foundation.
- `tests/unit/ollama-claude-thinking-passthrough.test.js` (Phase 2) — thinking/effort survive translateRequest.
- `tests/unit/ollama-claude-block-fidelity.test.js` (Phase 2) — tool_use/tool_result/text/image round-trip + same-format response passthrough.
- `tests/unit/ollama-claude-compat.test.js` (Phase 3) — COMP-01/02/03 + usage extraction.
- `open-sse/translator/index.js` translateRequest (line 78 same-format skip) + translateResponse (line 152 passthrough) — the contract to lock.
- `open-sse/handlers/chatCore/sseToJsonHandler.js` — the streaming SSE → client path (for VAL-02's end-to-end slice).

### Established Patterns
- vitest, direct imports from `open-sse/`, no mocks/network, `describe("Phase N: ...")` + `it("Contract ...")` naming.
- Self-contained tests (CLAUDE.md: not all-green on plain checkout, new tests must not depend on known-failing infra).

### Integration Points
- `tests/unit/` — the consolidated regression/round-trip/fallback-guard suite.
- No open-sse source changes expected (Phase 4 locks behavior, doesn't change it). If the round-trip mock needs a seam (e.g. a fake executor), prefer constructing response chunks directly over modifying executor code.

</code_context>

<specifics>
## Specific Ideas

VAL-02 is the new deliverable: a mocked `/v1/messages` round-trip proving thinking + tool_use survive end-to-end. VAL-01/03 consolidate + clearly-label the regression + fallback assertions already proven in Phase 1. Keep it test-only — no open-sse source changes.

</specifics>

<deferred>
## Deferred Ideas

None within Phase 4 scope. Live round-trip against ollama cloud with real credentials is out of scope for the committed suite (the mock covers the contract; a live test would be a `*.real.test.js` under tests/translator/real/ skipped without creds).

</deferred>