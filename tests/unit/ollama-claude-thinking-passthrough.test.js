import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Phase 2: Thinking passthrough for ollama claude transport", () => {
  it("Contract THINK-02: applyThinking no-ops on ollama+claude path", () => {
    const body = { thinking: { type: "enabled" }, output_config: { effort: "high" } };
    const out = applyThinking(FORMATS.CLAUDE, "ollama-model", body, "ollama");
    expect(out.thinking.type).toBe("enabled");
    expect(out.output_config.effort).toBe("high");
  });

  it("Contract THINK-02 negative: applyThinking still strips for non-ollama non-reasoning provider", () => {
    const body = { thinking: { type: "enabled" }, output_config: { effort: "high" } };
    const out = applyThinking(FORMATS.CLAUDE, "some-model", body, "nonexistent-provider");
    expect(out.thinking).toBeUndefined();
    expect(out.output_config).toBeUndefined();
  });

  it("Contract THINK-03: providerThinking-injected thinking survives to translateRequest output", () => {
    const body = {
      model: "ollama-model",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 10000 },
    };
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      "ollama-model",
      body,
      false,
      null,
      "ollama",
    );
    expect(out.thinking.type).toBe("enabled");
  });

  it("Contract THINK-01 request: thinking content blocks in assistant messages survive translateRequest", () => {
    const body = {
      model: "ollama-model",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "reasoning here", signature: "sig-abc" },
            { type: "text", text: "answer" },
          ],
        },
        { role: "user", content: "continue" },
      ],
    };
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      "ollama-model",
      body,
      false,
      null,
      "ollama",
    );
    const assistantMsg = out.messages.find((m) => m.role === "assistant");
    const thinkingBlock = assistantMsg.content.find((b) => b.type === "thinking");
    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock.thinking).toBe("reasoning here");
    expect(thinkingBlock.signature).toBe("sig-abc");
  });
});