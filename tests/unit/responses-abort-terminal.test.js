import { describe, expect, it } from "vitest";

import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import { buildAbortedResponsesTerminalBytes } from "../../open-sse/utils/responsesStreamHelpers.js";

// Minimal stream controller stub
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

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

describe("Responses abort terminal synthesis", () => {
  it("emits response.failed + [DONE] when upstream errors (abort/stall)", async () => {
    // Upstream readable that errors mid-stream (simulates fetch abort on stall)
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: response.created\ndata: {}\n\n"));
        controller.error(new Error("stream stall timeout"));
      },
    });

    const out = createDisconnectAwareStream(
      { readable: upstream, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      makeController(),
      buildAbortedResponsesTerminalBytes
    );

    const text = await readAll(out);
    expect(text).toContain("event: response.failed");
    expect(text).toContain("data: [DONE]");
  });

  it("does not synthesize a Responses terminal for non-Responses streams (callback null)", async () => {
    // A non-Responses stream that truncates before any terminal marker must NOT
    // fabricate a response.failed/[DONE] (that framing is Responses-only). Under
    // the truncation fix it surfaces a transport error instead, so the client SDK
    // retries rather than accepting a silent empty EOF.
    const upstream = new ReadableStream({
      pull(controller) {
        if (!this._sent) { this._sent = true; controller.enqueue(new TextEncoder().encode("data: hi\n\n")); return; }
        controller.error(new Error("socket hang up"));
      },
    });

    const out = createDisconnectAwareStream(
      { readable: upstream, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      makeController(),
      null
    );

    let text = "";
    let errored = false;
    try {
      text = await readAll(out);
    } catch (e) {
      errored = true;
      expect(e.message).toContain("socket hang up");
    }
    expect(text).not.toContain("response.failed"); // no Responses framing synthesized
    expect(errored).toBe(true);                     // truncation surfaced as an error
  });
});
