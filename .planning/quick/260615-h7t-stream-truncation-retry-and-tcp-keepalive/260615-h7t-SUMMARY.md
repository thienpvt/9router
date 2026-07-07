---
quick_id: 260615-h7t
slug: stream-truncation-retry-and-tcp-keepalive
status: complete
date: 2026-06-15
---

# Quick Task 260615-h7t Summary: Stop losing work on silent gateway stream drops

## What was wrong
Behind an office gateway, long agent requests stalled and returned nothing —
the client showed "running" forever, forcing repeated Ctrl+C + continue. Root
cause (verified): `createDisconnectAwareStream` in
`open-sse/utils/streamHandler.js` closed the client stream GRACEFULLY on an
upstream reset or stall-abort, so a TRUNCATED response looked identical to a
COMPLETED one. The client SDK saw a clean EOF, assumed success, and never
retried → lost tokens, time, and context. All providers, shared path.

## Changes

### `open-sse/utils/streamHandler.js` — truncation vs. completion (the core fix)
- `createDisconnectAwareStream` now scans forwarded bytes for a provider terminal
  marker (`TERMINAL_MARKER_RE`: `[DONE]`, `message_stop`, a real `finish_reason`,
  `response.completed/failed`, Ollama `"done":true`) with a 32-char tail carry so
  a marker split across a chunk boundary is still detected.
- New `endTruncated()` decides the close behavior on any non-EOF termination:
  - client cancelled OR terminal marker already seen → graceful `close()`
    (response complete; the reset is just post-completion socket teardown).
  - `onAbortTerminal` present (Responses passthrough) → synthesize
    `response.failed` + `[DONE]` (unchanged behavior, now routed through one place).
  - genuine truncation (no terminal, no callback) → `controller.error()` so the
    client SDK detects a broken stream and retries.
- A `clientCancelled` flag set in `cancel()` keeps client Ctrl+C graceful.
- Removed the old blanket `isNetworkClose → close()` masking that swallowed drops.

### `open-sse/config/runtimeConfig.js`
- Added `envMsZeroable()` (allows explicit 0 as a disable sentinel).
- Added `UPSTREAM_TCP_KEEPALIVE_MS` (default 20000, 0=disable).

### `open-sse/utils/proxyFetch.js` — upstream TCP keepalive (best-effort)
- `getKeepAliveConnect()` / `getKeepAliveDispatcher()`: undici custom connector
  that flips `SO_KEEPALIVE` (verified working on the TLS socket, undici 7.27).
- Direct (no-proxy) path now routes through `keepAliveFetch` (the common topology).
- HTTP `ProxyAgent` gets the keepalive `connect`; manual MITM-bypass `net.Socket`
  gets `setKeepAlive`. SOCKS left on Agent defaults.
- Caveat documented in code: keepalive helps L3/L4 firewalls/NAT only; an L7
  filtering proxy ignores it — Task 1 is the safety net there.

### Tests
- `tests/unit/stream-truncation.test.js` (new, 10 cases): truncation→error,
  stall-abort→error, complete-then-reset→graceful, message_stop→graceful,
  finish_reason:null≠terminal, real finish_reason→graceful, split-marker→graceful,
  clean EOF→graceful, Responses→structured terminal, client-cancel→graceful.
- `tests/unit/responses-abort-terminal.test.js`: updated the non-Responses case to
  the new contract (truncation without a callback now errors instead of silently
  swallowing). Used a pull-based upstream so chunks aren't discarded by the
  ReadableStream ResetQueue (a synchronous enqueue-then-error in start() drops the
  buffer — not how a live socket behaves).

## Verification
- New + updated stream tests: **12 passed**.
- Full suite: 27 failures in 12 unrelated files (translator/db/oauth/etc.) — proven
  PRE-EXISTING by stashing all changes and reproducing the identical 27 failures on
  the clean tree. My changes add 12 green tests and introduce 0 regressions.
- ESLint on all 4 edited source/test files: clean (exit 0).
- `node --check` on all 3 edited source modules: OK.
- undici keepalive probe: `setKeepAlive` succeeds on TLSSocket; fetch reached
  Anthropic (401 as expected with empty body).

## Operator notes
- Fail-fast without code: `STREAM_STALL_TIMEOUT_MS=45000` turns the 6-min default
  hang into a 45s error → faster retry.
- Disable keepalive: `UPSTREAM_TCP_KEEPALIVE_MS=0`.
- If drops persist at a FIXED elapsed time regardless of activity, the gateway is a
  hard total-duration cap (not idle timeout) — no streaming trick survives that;
  use shorter requests or non-stream mode.

## Scope
Shared streaming + outbound fetch path. All providers benefit identically. No
provider-specific branching. Stall/connect timeouts unchanged (already tunable).

## Commit status
NOT committed — the working tree also contains unrelated pre-existing modifications
(`claude-to-kiro.js`, `cliTools.js`, and prior edits to the three files I extended).
Left to the user to stage/commit so unrelated WIP isn't entangled.
