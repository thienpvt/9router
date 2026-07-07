import { describe, expect, it } from "vitest";
import { resolveTransport } from "../../open-sse/services/provider.js";
import OllamaLocalExecutor from "../../open-sse/executors/ollama-local.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Phase 4 VAL-01 + VAL-03: consolidate + clearly-label the regression + fallback
// guard already proven by Phase 1-3. Locks the passthrough contract against
// future refactors. No open-sse source changes.
//
// VAL-01: claude-format request to ollama resolves targetFormat=claude and the
// dispatched body is structurally identical to the client body (no openai
// intermediate hop). Phase 1 transport Contract A proves targetFormat=claude;
// Phase 2 block-fidelity proves field-level identity; VAL-01 formalizes it as a
// scoped deep-equal on the passthrough fields + a negative assertion (no
// "choices" array, no openai rewrite).
//
// prepareClaudeRequest (open-sse/translator/index.js:118-121, runs because
// targetFormat===CLAUDE) normalizes cache_control — system-array rewrite and
// message-block strip/re-add (COMP-01c/d). VAL-01's base assertion omits
// cache_control from the input body to keep the toMatchObject clean; a SEPARATE
// it block documents the cache_control interaction without false-asserting its
// identity (CONTEXT.md line 23 + Phase 3 COMP-01).
//
// VAL-03: non-Claude openai-format request to ollama resolves no claude
// transport and routes through /api/chat unchanged. Phase 1 Contract B+C proves
// the mechanics; this is the Phase 4 named guard locking the fallback (CONTEXT
// line 23, COMP WR-01).

describe("Phase 4: VAL-01 regression + VAL-03 fallback guard", () => {
  it("Contract VAL-01: dispatched body structurally identical to client body (no openai intermediate, ollama)", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
      system: "You are helpful",
      thinking: { type: "enabled" },
      output_config: { effort: "high" },
      tools: [{ name: "get_weather", input_schema: {} }],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      body.model,
      body,
      false,
      null,
      "ollama"
    );

    // Scoped deep-equal on the passthrough fields. NOT a full toEqual —
    // prepareClaudeRequest may add/normalize headers, cache_control, anthropic-version.
    expect(result).toMatchObject({
      messages: body.messages,
      system: body.system,
      thinking: body.thinking,
      output_config: body.output_config,
      tools: body.tools,
    });

    // Negative proof: never routed through OpenAI intermediate.
    expect(result).not.toHaveProperty("choices");
  });

  // Asymmetry vs VAL-01 (ollama): ollama-local traverses applyThinking's general
  // path (thinkingUnified.js:275 short-circuit is `provider === "ollama"` only —
  // the ponytail comment marks lifting to PROVIDERS[ollama].quirks when a second
  // native-claude provider lands). Consequence: thinking gets budget_tokens
  // normalized in and output_config (OpenAI-shaped) is stripped. The structural
  // passthrough still holds for messages/system/tools — that is the VAL-01
  // invariant; thinking/output_config normalization is documented, not asserted.
  it("Contract VAL-01 local: messages/system/tools structurally identical (no openai intermediate, ollama-local)", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
      system: "You are helpful",
      thinking: { type: "enabled" },
      output_config: { effort: "high" },
      tools: [{ name: "get_weather", input_schema: {} }],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      body.model,
      body,
      false,
      null,
      "ollama-local"
    );

    expect(result).toMatchObject({
      messages: body.messages,
      system: body.system,
      tools: body.tools,
    });
    expect(result).not.toHaveProperty("choices");
  });

  // Cache_control scoping: prepareClaudeRequest rewrites cache_control on
  // system arrays and message content blocks (COMP-01c/d). Do NOT assert
  // cache_control identity here — only prove the passthrough doesn't drop the
  // message even when cache_control is normalized. Documents the known
  // prepareClaudeRequest interaction (CONTEXT line 23, Phase 3 COMP-01).
  it("Contract VAL-01 cache_control: prepareClaudeRequest may rewrite cache_control; passthrough fields unaffected", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hi", cache_control: { type: "ephemeral" } },
          ],
        },
      ],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      body.model,
      body,
      false,
      null,
      "ollama"
    );

    // Text content survives — passthrough doesn't drop the message even when
    // cache_control is normalized by prepareClaudeRequest.
    expect(result.messages[0].content[0].text).toBe("hi");
    // NOTE: cache_control shape is NOT asserted — prepareClaudeRequest may
    // strip, move, or rewrite it (COMP-01d). The invariant is that the text
    // content survives, not that cache_control round-trips verbatim.
  });

  it("Contract VAL-03: openai-format request to ollama routes /api/chat (no claude transport matches)", () => {
    // Phase 1 transport Contract B + C proves the mechanics: resolveTransport
    // returns null AND buildUrl returns /api/chat without runtimeTransport.
    // This is the Phase 4 named guard locking the fallback.
    expect(resolveTransport("ollama", "openai")).toBeNull();
    expect(resolveTransport("ollama-local", "openai")).toBeNull();

    const exec = new OllamaLocalExecutor();
    expect(exec.buildUrl("", true, 0, null)).toBe("http://localhost:11434/api/chat");
  });
});