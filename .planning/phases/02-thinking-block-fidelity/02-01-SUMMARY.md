---
phase: 02-thinking-block-fidelity
plan: 01
subsystem: translator
tags: [ollama, claude, thinking, applyThinking, vitest]
requires: [Phase 1 ollama claude transport wired]
provides: [applyThinking ollama-claude no-op, thinking field passthrough, output_config.effort passthrough]
affects: [open-sse/translator/concerns/thinkingUnified.js]
tech-stack:
  added: []
  patterns: [provider-gated early-return mirroring handlesThinkingBlocks gate]
key-files:
  created:
    - tests/unit/ollama-claude-thinking-passthrough.test.js
  modified:
    - open-sse/translator/concerns/thinkingUnified.js
decisions:
  - "Short-circuit applyThinking for ollama+claude at function top (before !caps.reasoning branch) rather than capability flag"
  - "Use FORMATS.CLAUDE constant, no hardcoded strings (CLAUDE.md rule)"
  - "Do NOT add ollama to handlesThinkingBlocks (different concern — assistant-message thinking-block rewrites)"
metrics:
  duration: ~15min
  completed: 2026-07-07
  tasks: 2
  files: 2
status: complete
---

# Phase 2 Plan 1: Thinking Passthrough for Ollama Claude Transport Summary

applyThinking short-circuited for ollama+claude path — client thinking field + output_config.effort now survive to ollama unchanged. 4-contract vitest self-check proves the contract.

## What Was Built

### Behavioral Change (1 line + import + comment)
`open-sse/translator/concerns/thinkingUnified.js` `applyThinking`: added early-return `if (provider === "ollama" && targetFormat === FORMATS.CLAUDE) return body;` placed BEFORE the `!caps.reasoning` branch (line 275). This prevents `stripAll(body)` from deleting `thinking`, `output_config`, `reasoning_effort` etc. when ollama is the target under claude transport.

Why ollama hit the strip branch: `getCapabilitiesForModel("ollama", model)` returns `reasoning: false` (default, ollama has no capability entry) → `stripAll` ran → client thinking fields deleted before reaching ollama. Ollama `/v1/messages` accepts thinking natively, so the strip was wrong.

Import added: `import { FORMATS } from "../formats.js";` (per CLAUDE.md — use constant, no hardcoded "claude").

Ponytail comment: `ceiling = ollama under claude transport. Lift into PROVIDERS[ollama].quirks or a capability flag if a second native-claude provider lands.`

### Self-Check (4 contracts)
`tests/unit/ollama-claude-thinking-passthrough.test.js` — vitest, no mocks, direct imports. One runnable file covering:

| Contract | What it asserts | Result |
|----------|------------------|--------|
| THINK-02 | `applyThinking(claude, ollama-model, {thinking, output_config}, "ollama")` preserves both fields | pass (was RED before fix) |
| THINK-02 negative | Same body, `provider="nonexistent-provider"` → both fields deleted by `stripAll` (regression guard) | pass (ollama-specific) |
| THINK-03 | Body with `thinking:{type:"enabled",budget_tokens:10000}` (mimics chatCore.js:63 injection) → `translateRequest(claude→claude, ..., "ollama")` preserves `thinking.type` | pass (was RED before fix) |
| THINK-01 request | Assistant message with `[{type:"thinking",thinking:"...",signature:"..."}]` → `translateRequest(claude→claude, ..., "ollama")` preserves thinking block verbatim | pass (same-format skip already correct) |

## TDD Gate Compliance

RED gate: `test(02-01): add thinking passthrough self-check` (20cd2e3) — THINK-02 + THINK-03 failed before implementation. Confirmed RED.
GREEN gate: `feat(02-01): short-circuit applyThinking for ollama claude path` (fc60745) — all 4 contracts pass after implementation.

## Verification

```
cd tests && npx vitest run unit/ollama-claude-thinking-passthrough.test.js
→ Tests 4 passed (4)
```

## Deviations from Plan

None — plan executed exactly as written. Short-circuit placed per CONTEXT decision (before `!caps.reasoning` branch), uses `FORMATS.CLAUDE` constant, `handlesThinkingBlocks` NOT modified, no ollama reasoning capability tag added.

## Threat Surface

No new attack surface. Short-circuit returns body unchanged — no new input parsing, no mutation. Ollama already behind Phase 1 auth. Threat register T-02-01/T-02-02/T-02-SC all disposition=accept, no mitigations required.

## Known Stubs

None.

## Self-Check: PASSED

- `tests/unit/ollama-claude-thinking-passthrough.test.js` FOUND
- `open-sse/translator/concerns/thinkingUnified.js` modified FOUND
- `git log` contains 20cd2e3 (RED) FOUND
- `git log` contains fc60745 (GREEN) FOUND