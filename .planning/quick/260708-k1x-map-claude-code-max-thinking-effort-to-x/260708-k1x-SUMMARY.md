---
quick_id: 260708-k1x
slug: map-claude-code-max-thinking-effort-to-x
subsystem: translator
tags: [thinking, reasoning-effort, openai, claude-code, clamp]

requires: []
provides:
  - "OpenAI thinking effort clamp: max→xhigh (HTTP 400 prevention)"
affects: [translator, openai-provider, claude-code-transport]

tech-stack:
  added: []
  patterns: ["Per-format ceiling clamp at the leak point (single-line, no generic layer)"]

key-files:
  created:
    - "tests/unit/thinking-effort-openai-max-clamp.test.js"
  modified:
    - "open-sse/translator/concerns/thinkingUnified.js"

key-decisions:
  - "Clamp at the openai case only, not a generic layer — other formats already clamp correctly (claude-adaptive xhigh→high, step xhigh|max→high, deepseek xhigh|max→max). OpenAI was the lone gap."

requirements-completed: []

coverage:
  - id: D1
    description: "OpenAI thinking effort max→xhigh clamp prevents HTTP 400 from upstream"
    verification:
      - kind: unit
        ref: "tests/unit/thinking-effort-openai-max-clamp.test.js#client output_config.effort:\"max\" → reasoning_effort:\"xhigh\" (not \"max\")"
        status: pass
      - kind: unit
        ref: "tests/unit/thinking-effort-openai-max-clamp.test.js#direct reasoning_effort:\"max\" clamped to \"xhigh\""
        status: pass
      - kind: unit
        ref: "tests/unit/thinking-effort-openai-max-clamp.test.js#\"xhigh\" passes through unchanged (highest valid OpenAI level)"
        status: pass
      - kind: unit
        ref: "tests/unit/thinking-effort-openai-max-clamp.test.js#\"high\" passes through unchanged"
        status: pass
      - kind: unit
        ref: "tests/unit/thinking-effort-openai-max-clamp.test.js#max budget (thinking.budget_tokens:128000) → reasoning_effort:\"xhigh\" (budgetToLevel caps at xhigh)"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-08
status: complete
---

# Quick Task 260708-k1x: Map Claude Code max thinking effort to xhigh for OpenAI target

**One-line clamp in `applyFormat` case `"openai"`: `level === "max" ? "xhigh" : level` prevents HTTP 400 "max effort not support" from OpenAI upstream.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2
- **Files modified:** 1 source + 1 test

## Accomplishments
- `thinkingUnified.js` openai case clamps `"max"`→`"xhigh"` (the OpenAI enum ceiling per `L.openai`)
- 5-case regression test covers: client `output_config.effort:"max"`, direct `reasoning_effort:"max"`, `"xhigh"` passthrough, `"high"` passthrough, max `budget_tokens:128000` (budgetToLevel already caps at xhigh, never max)
- All 5 tests green: `cd tests && npx vitest run unit/thinking-effort-openai-max-clamp.test.js`

## Task Commits

1. **Task 1: Clamp max→xhigh in openai thinking format** - `4998e29` (fix)
2. **Task 2: Regression test** - `9379861` (test)

## Files Created/Modified
- `open-sse/translator/concerns/thinkingUnified.js` - Added one-line clamp + comment in `applyFormat` case `"openai"` (line 187-188)
- `tests/unit/thinking-effort-openai-max-clamp.test.js` - New vitest with 5 cases mirroring `ollama-claude-thinking-passthrough.test.js` import style

## Decisions Made
- Single-line clamp at the leak point, not a generic clamp layer. Other formats already clamp correctly (claude-adaptive maps xhigh→high, step maps xhigh|max→high, deepseek maps xhigh|max→max). OpenAI case was the lone gap — YAGNI on a generic layer.
- No new deps. Used existing `toLevel`/`budgetToLevel` infrastructure.

## Deviations from Plan

None - plan executed exactly as written. Test file mirrors import style as specified.

## Issues Encountered
None.

## Self-Check: PASSED

- FOUND: open-sse/translator/concerns/thinkingUnified.js
- FOUND: tests/unit/thinking-effort-openai-max-clamp.test.js
- FOUND: 4998e29
- FOUND: 9379861

---
*Quick: 260708-k1x*
*Completed: 2026-07-08*
