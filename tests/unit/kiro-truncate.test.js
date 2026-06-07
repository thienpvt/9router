import { describe, it, expect } from "vitest";
import {
  truncateKiroPayload,
  _internal,
} from "../../open-sse/translator/request/kiroTruncate.js";

const { TRUNCATION_PLACEHOLDER, jsonByteSize } = _internal;

// Build a Kiro payload with `n` alternating user/assistant history turns, each
// user turn ~`chars` bytes of content, plus a small currentMessage.
function buildPayload(n, chars = 2000) {
  const history = [];
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      history.push({
        userInputMessage: {
          content: `u${i}:` + "x".repeat(chars),
          modelId: "claude-opus-4-8",
        },
      });
    } else {
      history.push({
        assistantResponseMessage: { content: `a${i}:` + "y".repeat(chars) },
      });
    }
  }
  return {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: "cid",
      currentMessage: {
        userInputMessage: { content: "latest user request", modelId: "claude-opus-4-8" },
      },
      history,
    },
    profileArn: "arn:aws:codewhisperer:us-east-1:1:profile/X",
  };
}

describe("truncateKiroPayload", () => {
  it("is a no-op when under budget", () => {
    const p = buildPayload(4, 100);
    const before = JSON.parse(JSON.stringify(p));
    const r = truncateKiroPayload(p, { maxBytes: 1024 * 1024 });
    expect(r.truncated).toBe(false);
    expect(p).toEqual(before);
  });

  it("drops oldest turns to fit the byte budget", () => {
    const p = buildPayload(100, 2000); // ~ >200KB
    const maxBytes = 60 * 1024;
    const r = truncateKiroPayload(p, { maxBytes, minRecentTurns: 4 });
    expect(r.truncated).toBe(true);
    expect(r.droppedTurns).toBeGreaterThan(0);
    expect(jsonByteSize(p)).toBeLessThanOrEqual(maxBytes);
  });

  it("always keeps the currentMessage", () => {
    const p = buildPayload(100, 2000);
    truncateKiroPayload(p, { maxBytes: 40 * 1024, minRecentTurns: 4 });
    expect(p.conversationState.currentMessage.userInputMessage.content).toContain(
      "latest user request"
    );
  });

  it("keeps at least minRecentTurns when possible", () => {
    const p = buildPayload(100, 2000);
    truncateKiroPayload(p, { maxBytes: 80 * 1024, minRecentTurns: 4 });
    // History begins on a user turn and retains the most recent turns.
    expect(p.conversationState.history.length).toBeGreaterThanOrEqual(1);
    expect(p.conversationState.history[0].userInputMessage).toBeTruthy();
  });

  it("inserts the truncation placeholder into the first kept user turn", () => {
    const p = buildPayload(100, 2000);
    const r = truncateKiroPayload(p, { maxBytes: 60 * 1024, minRecentTurns: 4 });
    expect(r.droppedTurns).toBeGreaterThan(0);
    const first = p.conversationState.history[0].userInputMessage.content;
    expect(first.startsWith(TRUNCATION_PLACEHOLDER)).toBe(true);
  });

  it("history always starts on a user turn after truncation", () => {
    const p = buildPayload(101, 2000);
    truncateKiroPayload(p, { maxBytes: 70 * 1024, minRecentTurns: 4 });
    expect(p.conversationState.history[0].userInputMessage).toBeTruthy();
  });

  it("reconciles orphaned toolResults when their toolUse turn is dropped", () => {
    // Old assistant turn owns toolUseId 'tu-old'; a later kept user turn carries
    // its toolResult. After dropping the old assistant turn, the result must be
    // folded into text (no dangling structured reference → no Kiro 400).
    const history = [];
    history.push({ userInputMessage: { content: "x".repeat(40000), modelId: "m" } });
    history.push({
      assistantResponseMessage: { content: "old", toolUses: [{ toolUseId: "tu-old", name: "Read", input: {} }] },
    });
    // Filler to push the old turns out of budget.
    for (let i = 0; i < 40; i++) {
      history.push({ userInputMessage: { content: "u".repeat(2000), modelId: "m" } });
      history.push({ assistantResponseMessage: { content: "a".repeat(2000) } });
    }
    // A recent user turn still references the now-droppable tu-old.
    history.push({
      userInputMessage: {
        content: "recent",
        modelId: "m",
        userInputMessageContext: {
          toolResults: [{ toolUseId: "tu-old", status: "success", content: [{ text: "ORPHAN_RESULT" }] }],
        },
      },
    });
    const p = {
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "cid",
        currentMessage: { userInputMessage: { content: "now", modelId: "m" } },
        history,
      },
    };
    truncateKiroPayload(p, { maxBytes: 50 * 1024, minRecentTurns: 4 });

    // No surviving toolResult should reference a toolUseId absent from kept history.
    const validIds = new Set();
    for (const h of p.conversationState.history) {
      for (const tu of h.assistantResponseMessage?.toolUses || []) validIds.add(tu.toolUseId);
    }
    for (const h of p.conversationState.history) {
      for (const tr of h.userInputMessage?.userInputMessageContext?.toolResults || []) {
        expect(validIds.has(tr.toolUseId)).toBe(true);
      }
    }
  });

  it("shrinks an oversized currentMessage as a last resort", () => {
    const p = {
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "cid",
        currentMessage: {
          userInputMessage: { content: "HEAD" + "z".repeat(200000) + "TAIL", modelId: "m" },
        },
        history: [],
      },
    };
    const maxBytes = 50 * 1024;
    const r = truncateKiroPayload(p, { maxBytes });
    expect(r.truncated).toBe(true);
    expect(jsonByteSize(p)).toBeLessThanOrEqual(maxBytes);
    // Head and tail of the request are preserved.
    const c = p.conversationState.currentMessage.userInputMessage.content;
    expect(c.startsWith("HEAD")).toBe(true);
    expect(c.endsWith("TAIL")).toBe(true);
  });

  it("returns truncated:false for a payload without conversationState", () => {
    expect(truncateKiroPayload({ messages: [] }).truncated).toBe(false);
  });
});
