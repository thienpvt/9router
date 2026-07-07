import { describe, it, expect } from "vitest";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Phase 4 VAL-02: mocked `/v1/messages` SSE round-trip. Proves thinking +
// tool_use blocks survive end-to-end through the claude passthrough, against a
// recorded Anthropic SSE event sequence. CLAUDE→CLAUDE hits the identity
// passthrough at open-sse/translator/index.js:152 (returns [chunk]) — no
// translator registry needed (confirmed by the test passing without
// registerAll.js import).
//
// VAL-02 mock = inline recorded chunk array fed through translateResponse +
// runStream accumulator per golden-response-stream.test.js analog. NOT a fetch
// mock (CONTEXT.md line 47: "prefer constructing response chunks directly over
// modifying executor code"). No network, no vi.mock.

// runStream accumulator — copies the golden-response-stream.test.js analog
// (lines 24-33). Does NOT call stripVolatile: VAL-02 uses explicit assertions,
// not snapshots, so identity references must be preserved (out[i] === events[i]
// requires no JSON round-trip).
function runStream(targetFormat, sourceFormat, events) {
  const state = initState(sourceFormat);
  const all = [];
  for (const ev of events) {
    const out = translateResponse(targetFormat, sourceFormat, ev, state);
    if (Array.isArray(out)) all.push(...out);
    else if (out) all.push(out);
  }
  return all;
}

describe("Phase 4: VAL-02 round-trip (mocked /v1/messages)", () => {
  it("Contract VAL-02: thinking + tool_use survive end-to-end through claude passthrough (mocked /v1/messages)", () => {
    // Recorded ollama /v1/messages SSE contract — 12 events per Anthropic
    // Messages streaming shape: message_start → content_block_start/delta (thinking
    // + text + tool_use) → content_block_stop → message_delta (stop_reason +
    // usage) → message_stop.
    const events = [
      { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4-5", usage: { input_tokens: 10 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me think" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Answer" } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "get_weather" } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"city":"NYC"}' } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ];

    const out = runStream(FORMATS.CLAUDE, FORMATS.CLAUDE, events);

    // Order preserved, no events dropped: same count, same type sequence.
    expect(out.map((e) => e.type)).toEqual(events.map((e) => e.type));

    // Identity passthrough — each event reaches client UNCHANGED (no openai
    // intermediate hop). translateResponse returns [chunk] (===) on same-format.
    for (let i = 0; i < events.length; i++) {
      expect(out[i]).toBe(events[i]);
    }

    // VAL-02 headline invariants: thinking AND tool_use blocks survive.
    const thinkingDelta = out.find((e) => e.delta?.type === "thinking_delta");
    expect(thinkingDelta.delta.thinking).toBe("let me think");

    const toolUseStart = out.find((e) => e.content_block?.type === "tool_use");
    expect(toolUseStart.content_block.id).toBe("toolu_1");
    expect(toolUseStart.content_block.name).toBe("get_weather");

    // input_json_delta partial_json survives verbatim.
    const jsonDelta = out.find((e) => e.delta?.type === "input_json_delta");
    expect(jsonDelta.delta.partial_json).toBe('{"city":"NYC"}');

    // stop_reason + usage reach the client-facing stream (COMP-02/03 proven at
    // translator level; here at the SSE reconstruction level).
    const stopReason = out.find((e) => e.type === "message_delta");
    expect(stopReason.delta.stop_reason).toBe("tool_use");
    expect(stopReason.usage.output_tokens).toBe(5);
  });
});