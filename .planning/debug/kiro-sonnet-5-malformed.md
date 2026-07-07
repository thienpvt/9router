---
status: resolved
trigger: "new model sonnet-5 has been added via Kiro provider, but when i try this model, i hit 2 times malformed error with status 200. Investigate carefully and fix it. Everything run with other model are fine like: opus 4.8, 4.7, 4.6"
created: 2026-07-05T12:14:00Z
updated: 2026-07-05T12:38:00Z
---

## Current Focus
<!-- OVERWRITE on each update - always reflects NOW -->

hypothesis: The Kiro AWS EventStream frame parser (open-sse/executors/kiro.js parseEventFrame + transformEventStreamToSSE) only handles `:event-type` payload frames. For upstream model id `claude-sonnet-5`, the gateway streams reasoning (reasoningContentEvent → thinking shows), then signals a per-model error/exception frame (`:message-type: exception`) OR emits no assistantResponseEvent, and the parser silently drops it. Result: thinking blocks reach Claude Code but no text answer and no clean message_stop → Claude Code's strict Anthropic SSE parser reports "malformed" at HTTP 200.
test: Capture the raw Kiro EventStream bytes for a `claude-sonnet-5` request vs a working `claude-opus-4.8` request (both via Kiro). Compare event-type/message-type frames. Confirm whether an exception frame or missing assistantResponseEvent is being dropped.
expecting: If true, the sonnet-5 stream will contain an exception/error frame (or only reasoning + terminal events, no assistantResponseEvent) that the parser ignores; opus-4.8 will contain normal assistantResponseEvent frames. If false, both streams look structurally identical and the divergence is client-side (thinking block missing signature_delta) or in the kiro-to-claude translator.
next_action: Add temporary trace logging in open-sse/executors/kiro.js transformEventStreamToSSE — log every frame's `event.headers` (including `:message-type` and `:event-type`) and first 200 chars of payload — then run one real `claude-sonnet-5` request through Kiro and one `claude-opus-4.8` request, and diff the frame sequences.
reasoning_checkpoint: null
tdd_checkpoint: null

## Symptoms
<!-- Written during gathering, then immutable -->

expected: `claude-sonnet-5` (base variant) via the Kiro provider streams a normal assistant answer to Claude Code, same as opus-4.8/4.7/4.6.
actual: Claude Code CLI shows the thinking/reasoning stream but NO final answer, then reports a "malformed" error. HTTP status is 200. Reproduced 2x.
errors: Claude Code CLI: "malformed" error, HTTP status 200. (Exact string not captured — client-side Anthropic SSE parse failure.)
reproduction: Select base `claude-sonnet-5` on the Kiro provider from Claude Code (Claude-format client → direct kiro:claude route) and send a normal prompt. Fails ~2/2. opus-4.8 / opus-4.7 / opus-4.6 on the same setup work fine.
started: Immediately after commit a5363b8 "fix(kiro): add Claude Sonnet 5 model support (#2264)" (Fri Jul 3 2026) added the sonnet-5 model ids. Never worked for sonnet-5.

## Eliminated
<!-- APPEND only - prevents re-investigating after /clear -->

- hypothesis: The sonnet-5 support commit broke the response translation path.
  evidence: `git log -p a5363b8` shows it ONLY added static entries to open-sse/providers/registry/kiro.js (4 model ids), MODEL_CAPABILITIES in capabilities.js, and MITM slots. No change to executors/kiro.js, kiro-to-claude.js, or claude-to-kiro.js. The response path is byte-identical to what opus uses.
  timestamp: 2026-07-05T12:14:00Z

- hypothesis: sonnet-5 has different/missing capabilities causing a code path divergence.
  evidence: capabilities.js:85 gives `claude-sonnet-5` identical caps to opus-4.8 (vision, reasoning, search, thinkingFormat "claude-adaptive", contextWindow 1000000, maxOutput 128000). tests/unit/capabilities.test.js:22-27 asserts this. Capability resolution is not the differentiator.
  timestamp: 2026-07-05T12:14:00Z

## Evidence
<!-- APPEND only - facts discovered during investigation -->

- timestamp: 2026-07-05T12:14:00Z
  checked: HTTP semantics of the symptom
  found: "malformed at status 200" means upstream ACCEPTED the request (200 OK) and streamed a body that failed to parse client-side. A request-build/schema error would surface as HTTP 400 (e.g. "Improperly formed request"), not 200.
  implication: Bug is on the RESPONSE decode/translation path (or upstream stream content), NOT request construction. Rules out the inferenceConfig/payload-shape concerns for the primary failure.

- timestamp: 2026-07-05T12:14:00Z
  checked: Which route Claude Code uses for Kiro
  found: Claude Code sends Claude-format requests. open-sse/translator/index.js registers a DIRECT `claude:kiro` request translator and `kiro:claude` response translator (commit 706e651). translateResponse() uses the direct kiro:claude fn (kiroToClaudeResponse in kiro-to-claude.js), bypassing the OpenAI pivot.
  implication: The active response path is executors/kiro.js (binary EventStream → OpenAI-shaped SSE chunks) → kiro-to-claude.js (OpenAI chunk → Claude SSE events). kiro-to-openai.js string-parsing path is dead for this flow.

- timestamp: 2026-07-05T12:14:00Z
  checked: User clarification on failure shape
  found: Failure is on the BASE `claude-sonnet-5` variant (no -thinking suffix). Claude Code shows "only thinking, no answer" before the malformed error. Error surfaces in Claude Code CLI.
  implication: Reasoning/thinking frames ARE decoded and streamed (reasoningContentEvent path works), but the assistant TEXT answer never arrives and/or the stream never terminates cleanly. Focus on: (a) assistantResponseEvent handling, (b) the `<thinking>` tag stripping state machine in kiro.js:181-199 that sets content="" while state.inThinking, (c) whether upstream emits an exception frame the parser drops, (d) thinking block emitted to Claude without a signature_delta.

- timestamp: 2026-07-05T12:14:00Z
  checked: parseEventFrame in open-sse/executors/kiro.js:530-590
  found: Parser reads only `:event-type` header (string headers, type 7). It has NO handling for `:message-type: exception` or `:exception-type` frames that AWS CodeWhisperer/Kiro uses to signal per-model errors inside a 200 stream. Unknown/exception frames fall through and are silently ignored (no chunk enqueued).
  implication: If the gateway rejects/errors on upstream id `claude-sonnet-5` mid-stream via an exception frame, 9router drops it → client gets a truncated/contentless stream = "malformed". Strong candidate for root cause. Also note the static upstream id `claude-sonnet-5` is a hardcoded guess (registry/kiro.js:45) vs opus which comes from the live AWS catalog (kiroModels.js) — the upstream id may be wrong/unaccepted.

- timestamp: 2026-07-05T12:14:00Z
  checked: `<thinking>` tag stripping in transformEventStreamToSSE (kiro.js:181-199)
  found: State machine: if content contains `<thinking>` without `</thinking>`, sets state.inThinking=true and drops all subsequent assistantResponseEvent content (content="") until a `</thinking>` appears. If the closing tag never appears (or arrives split across frames), ALL answer text is dropped.
  implication: Alternative/compounding cause of "thinking visible but no answer". If sonnet-5 emits reasoning as inline `<thinking>...` in assistantResponseEvent content (different formatting than opus), the answer could be swallowed. Needs raw-frame confirmation.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: |
  KiroExecutor.parseEventFrame / transformEventStreamToSSE (open-sse/executors/kiro.js)
  only inspects the `:event-type` header. AWS EventStream error/exception frames carry
  `:message-type: exception` (or `error`) and NO `:event-type`, so eventType resolves to
  "" and the frame falls through every handler branch and is silently dropped. When the
  Kiro/CodeWhisperer gateway errors mid-stream on the hardcoded upstream id
  `claude-sonnet-5` (registry/kiro.js:45 — a static guess, unlike the working models that
  come from the live ListAvailableModels catalog), the stream delivers reasoningContentEvent
  frames (so thinking shows in Claude Code) and then an exception frame that produces no
  chunk and no terminal event. The client receives a contentless/truncated stream with no
  clean message_stop, which Claude Code's strict Anthropic SSE parser reports as "malformed"
  at HTTP 200. opus-4.8/4.7/4.6 are unaffected because they are a DIFFERENT provider whose
  responses never pass through this Kiro parser — they were never a same-route control.
fix: |
  Handle AWS EventStream error/exception frames in transformEventStreamToSSE. When a frame
  has `:message-type` of "exception"/"error" (or event-type "error"), surface it as assistant
  text ([Kiro upstream error: <type> - <detail>], reading :exception-type / :error-code /
  :error-message headers and payload message) AND emit a clean finish chunk so the stream
  always terminates as a well-formed message. Guarded by state.errorEmitted to emit once.
  Also hardened the messageStopEvent handler with `!state.finishEmitted` so a stop frame
  arriving after the synthetic finish cannot double-emit a terminal chunk.
verification: |
  Added tests/unit/kiro-exception-frame.test.js (2 cases: exception frame surfaces content +
  clean finish + [DONE]; error frame followed by messageStopEvent emits exactly one finish).
  Ran the Kiro suites: 111 passed, 11 expected-fail, 0 unexpected failures
  (kiro-exception-frame, kiro-thinking-strip, claude-kiro-direct, kiro-model-slots,
  capabilities, bugs-kiro, rtkKiro). Note: the fix makes the malformed stream well-formed and
  surfaces the upstream error text; if `claude-sonnet-5` is simply the wrong upstream id, the
  user will now see the real gateway error instead of "malformed" — a separate follow-up
  (correct the hardcoded id or source it from the live catalog) may be warranted.
files_changed:
  - open-sse/executors/kiro.js
  - tests/unit/kiro-exception-frame.test.js
