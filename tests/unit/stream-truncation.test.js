import { describe, expect, it } from "vitest";

import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import { buildAbortedResponsesTerminalBytes } from "../../open-sse/utils/responsesStreamHelpers.js";

// Minimal stream controller stub. `connected` starts true; any terminal handler
// flips it false (mirrors the real createStreamController contract).
function makeController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => { connected = false; },
    handleError: () => { connected = false; },
    handleDisconnect: () => { connected = false; },
    abort: () => { connected = false; },
  };
}

const enc = (s) => new TextEncoder().encode(s);

// Build a pull-based upstream that delivers exactly one action per pull. This
// models a real network stream: chunks arrive across separate reads and a reset
// happens on a LATER read, so earlier chunks are already dequeued/forwarded.
// (A synchronous enqueue-then-error in start() would hit the spec's ResetQueue
// and discard buffered chunks — not what a live socket does.)
//   { chunk: "..." }      → enqueue bytes
//   { error: "MSG" }      → controller.error(new Error("MSG"))
//   { onPull: fn }        → side effect (e.g. flip the controller) before delivering
function scriptedUpstream(actions) {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      while (i < actions.length) {
        const a = actions[i++];
        if (a.onPull) { a.onPull(); continue; }
        if (a.error) { controller.error(new Error(a.error)); return; }
        controller.enqueue(enc(a.chunk));
        return;
      }
      controller.close();
    },
  });
}

// Drain the wrapped stream, capturing clean-close vs. error and decoded text.
async function drain(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let errored = false;
  let errMessage = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (e) {
    errored = true;
    errMessage = e?.message || String(e);
  }
  return { text, errored, errMessage };
}

function wrap(upstream, controller, onAbortTerminal = null) {
  return createDisconnectAwareStream(
    { readable: upstream, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
    controller,
    onAbortTerminal
  );
}

describe("stream truncation → client-visible error (the lost-work fix)", () => {
  it("ERRORS when a plain SSE stream is reset BEFORE any terminal marker", async () => {
    // Corporate-gateway idle drop mid-response: content flowed, then the socket
    // reset with no [DONE]/finish_reason/message_stop.
    const upstream = scriptedUpstream([
      { chunk: 'data: {"choices":[{"delta":{"content":"hel"},"finish_reason":null}]}\n\n' },
      { chunk: 'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n\n' },
      { error: "ECONNRESET" },
    ]);

    const { text, errored } = await drain(wrap(upstream, makeController(), null));
    // Partial content was forwarded, then the stream surfaced an error so the
    // client SDK sees a broken stream and retries — instead of a silent EOF.
    expect(text).toContain("hel");
    expect(errored).toBe(true);
  });

  it("ERRORS on stall-abort before terminal (isConnected() already false)", async () => {
    // pipeWithDisconnect fires handleError on stall, flipping isConnected()→false
    // BEFORE the next pull. The next pull must treat that as truncation, not EOF.
    const controller = makeController();
    const upstream = scriptedUpstream([
      { chunk: 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n' },
      { onPull: () => controller.handleError(new Error("stream stall timeout")) },
      // stream then goes quiet — no terminal ever arrives
    ]);

    const { text, errored } = await drain(wrap(upstream, controller, null));
    expect(text).toContain("partial");
    expect(errored).toBe(true);
  });

  it("does NOT error when [DONE] was seen, then the socket resets (complete-then-teardown)", async () => {
    const upstream = scriptedUpstream([
      { chunk: 'data: {"choices":[{"delta":{"content":"done content"}}]}\n\n' },
      { chunk: "data: [DONE]\n\n" },
      { error: "ECONNRESET" }, // post-completion teardown
    ]);

    const { text, errored } = await drain(wrap(upstream, makeController(), null));
    expect(text).toContain("done content");
    expect(text).toContain("[DONE]");
    expect(errored).toBe(false); // graceful — data already complete
  });

  it("does NOT error when Claude message_stop was seen before reset", async () => {
    const upstream = scriptedUpstream([
      { chunk: "event: content_block_delta\ndata: {\"delta\":{\"text\":\"hi\"}}\n\n" },
      { chunk: "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n" },
      { error: "socket hang up" },
    ]);

    const { text, errored } = await drain(wrap(upstream, makeController(), null));
    expect(text).toContain("message_stop");
    expect(errored).toBe(false);
  });

  it("treats finish_reason:null as NOT terminal (only a real reason counts)", async () => {
    const upstream = scriptedUpstream([
      { chunk: 'data: {"choices":[{"delta":{"content":"x"},"finish_reason":null}]}\n\n' },
      { error: "ETIMEDOUT" },
    ]);
    const { errored } = await drain(wrap(upstream, makeController(), null));
    expect(errored).toBe(true); // null reason ≠ completion
  });

  it("recognizes a real finish_reason as terminal (graceful)", async () => {
    const upstream = scriptedUpstream([
      { chunk: 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' },
      { error: "ECONNRESET" },
    ]);
    const { errored } = await drain(wrap(upstream, makeController(), null));
    expect(errored).toBe(false);
  });

  it("detects a terminal marker split across two chunks (tail carry-over)", async () => {
    const upstream = scriptedUpstream([
      { chunk: "data: [DO" },
      { chunk: "NE]\n\n" },
      { error: "ECONNRESET" },
    ]);
    const { errored } = await drain(wrap(upstream, makeController(), null));
    expect(errored).toBe(false); // marker spanned the boundary but was still seen
  });

  it("forwards a clean EOF (no error, no reset) as graceful completion", async () => {
    const upstream = scriptedUpstream([
      { chunk: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' },
      { chunk: "data: [DONE]\n\n" },
      // no error action → upstream closes normally
    ]);
    const { text, errored } = await drain(wrap(upstream, makeController(), null));
    expect(text).toContain("ok");
    expect(errored).toBe(false);
  });
});

describe("Responses passthrough still synthesizes a structured terminal", () => {
  it("emits response.failed + [DONE] on truncation (callback present)", async () => {
    const upstream = scriptedUpstream([
      { chunk: "event: response.created\ndata: {}\n\n" },
      { error: "stream stall timeout" },
    ]);

    const { text, errored } = await drain(
      wrap(upstream, makeController(), buildAbortedResponsesTerminalBytes)
    );
    expect(text).toContain("response.failed");
    expect(text).toContain("[DONE]");
    expect(errored).toBe(false); // structured failure is itself the signal
  });
});

describe("client cancel stays graceful", () => {
  it("does NOT error when the client cancels mid-stream", async () => {
    const upstream = scriptedUpstream([
      { chunk: 'data: {"choices":[{"delta":{"content":"streaming"}}]}\n\n' },
      { chunk: 'data: {"choices":[{"delta":{"content":"more"}}]}\n\n' },
      { chunk: 'data: {"choices":[{"delta":{"content":"and more"}}]}\n\n' },
    ]);

    const wrapped = wrap(upstream, makeController(), null);
    const reader = wrapped.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("streaming");
    // Client goes away — cancel must be graceful, not an error.
    await expect(reader.cancel("client_closed")).resolves.toBeUndefined();
  });
});
