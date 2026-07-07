---
phase: 04-validation-tests
fixed_at: 2026-07-08T00:40:00Z
review_path: .planning/phases/04-validation-tests/04-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-07-08T00:40:00Z
**Source review:** `.planning/phases/04-validation-tests/04-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (2 BLOCKER, 3 WARNING)
- Fixed: 5
- Skipped: 0

All fixes are test-only (no `open-sse/` source changes). Full ollama-claude
suite re-run from the isolated worktree: 6 files / 40 tests, all green.

## Fixed Issues

### CR-01: VAL-01 `toMatchObject` expected shape derived from same ref as `result`

**Files modified:** `tests/unit/ollama-claude-regression.test.js`
**Commit:** `f6f9268`
**Applied fix:** Snapshot `body` with `structuredClone(body)` BEFORE calling
`translateRequest`, then compare `result` toMatchObject against the snapshot
(not the mutated `body` ref). Applied to both the ollama VAL-01 case (asserts
messages/system/thinking/output_config/tools against snapshot) and the
ollama-local VAL-01 case (asserts messages/system/tools against snapshot). The
snapshot is taken before the call so the expected shape reflects the client's
pre-translation body — the assertion now actually detects passthrough
regressions (field rewrites/additions by translateRequest no longer reduce to
`result.X === result.X`).

### CR-02: VAL-01 cache_control assertion too narrow — did not lock COMP-01c/d

**Files modified:** `tests/unit/ollama-claude-regression.test.js`
**Commit:** `f6f9268`
**Applied fix:** Chose option (a) — assert the actual cache_control behavior.
`prepareClaudeRequest` (claude.js:241-244) strips `cache_control` from message
content blocks in Pass 1; Pass 2 re-adds `{type:"ephemeral"}` only to the last
non-thinking block of the LAST assistant. The test body has a user-only message
(no assistant), so the strip is permanent. Added
`expect(result.messages[0].content[0].cache_control).toBeUndefined()` and
renamed the `it` block to "prepareClaudeRequest strips cache_control from user
content blocks (COMP-01d)". Scoped to ollama. The test now encodes the COMP-01d
strip invariant instead of documenting it in prose.

### WR-01: VAL-03 verbatim re-statement of Phase 1 Contract B/C — no incremental coverage

**Files modified:** `tests/unit/ollama-claude-regression.test.js`
**Commit:** `f6f9268`
**Applied fix:** Reframed VAL-03 to add incremental value by asserting the full
routing decision chain (Phase 1's buildUrl atoms + the atoms Phase 1 omits):
`detectFormat(openaiBody) === "openai"` (proves the openai body is classified
correctly, not misdetected as claude), `resolveTransport("ollama"|"ollama-local",
"openai") === null`, and `getTargetFormat("ollama") === "ollama"` (proves the
non-Claude path's targetFormat is the ollama format — not asserted by Phase 1's
buildUrl test). Imported `detectFormat` and `getTargetFormat` from
`open-sse/services/provider.js`. Kept the existing buildUrl fallback assertion.
Comment documents that Phase 1 transport Contract B/C owns the buildUrl atoms.

### WR-02: VAL-01 (ollama) missing negative assertions beyond `choices`

**Files modified:** `tests/unit/ollama-claude-regression.test.js`
**Commit:** `f6f9268`
**Applied fix:** Expanded the negative-proof block in both VAL-01 cases to cover
the high-signal OpenAI-only fields that would appear if an openai intermediate
hop ran: `result.choices` (existing), `result.messages[0].tool_calls`,
`result.reasoning_effort`, `result.tools[0].function` (OpenAI tool shape). Added
a positive assertion `result.tools[0].input_schema` is defined (Claude tool
shape). Updated the header comment to enumerate the actual assertion surface
(choices / tool_calls / reasoning_effort / tools[*].function) instead of the
overclaimed "no openai rewrite".

### WR-03: `OllamaLocalExecutor` positive claude-path buildUrl untested in this file

**Files modified:** `tests/unit/ollama-claude-regression.test.js`
**Commit:** `f6f9268`
**Applied fix:** Added the positive claude-path buildUrl assertion as the
positive counterpart to the VAL-03 fallback:
`exec.buildUrl("", true, 0, {runtimeTransport: {baseUrl:
"http://localhost:11434/v1/messages", format: "claude"}})` returns
`"http://localhost:11434/v1/messages"`. This is the milestone's actual
dependency (the claude transport host-substituted /v1/messages). Comment notes
Phase 1 Contract C covers this atom; re-asserted here to keep the fallback +
positive paths together in the Phase 4 guard.

## VAL-02 cross-file notes (tests/unit/ollama-claude-round-trip.test.js)

Addressed per fix_guidance (outside the formal review scope but flagged by the
reviewer). Both fixes are in the same commit `f6f9268`:

1. **"End-to-end" overclaim** — Rewrote the header comment and `it` title to
   honestly describe the test as "same-format response passthrough round-trip
   (translateResponse identity slice)". Comment now explicitly states this is
   NOT end-to-end: no chatCore.js, no executor fetch, no SSE parser — the
   identity branch at translator/index.js:152 is provider-agnostic. Also
   corrected the misleading "Recorded ollama /v1/messages SSE contract" comment
   to "Inline mock ... NOT recorded from a live stream".

2. **Missing ping/error events** — Added `{type:"ping"}` (after message_start,
   keepalive) and `{type:"error", error:{type:"overloaded_error",
   message:"Overloaded"}}` (terminal) to the mock SSE array, per PROJECT.md
   line 51 documenting ollama emits both. The existing identity-loop assertion
   (`out[i] === events[i]`) already proves structural identity; added explicit
   `pingEvent === events[0]` and `errorEvent.error.type/message` assertions to
   document the non-data event forwarding invariant (forwarded, not dropped).

## Verification

Full ollama-claude suite re-run from the isolated worktree after all fixes:

```
cd tests && npx vitest run \
  unit/ollama-claude-regression.test.js \
  unit/ollama-claude-round-trip.test.js \
  unit/ollama-claude-transport.test.js \
  unit/ollama-claude-thinking-passthrough.test.js \
  unit/ollama-claude-block-fidelity.test.js \
  unit/ollama-claude-compat.test.js

Test Files  6 passed (6)
     Tests  40 passed (40)
```

Tier 1 (re-read modified sections) + Tier 2 (vitest runtime check) both passed.
No open-sse source files modified.

---

_Fixed: 2026-07-08T00:40:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
