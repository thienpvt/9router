import { describe, expect, it } from "vitest";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { extractUsage, mergeUsage } from "../../open-sse/utils/usageTracking.js";

// Phase 3 COMP-01/02/03 + fallback guard. Proves existing same-format passthrough
// + generic usage extraction deliver the compatibility contract for ollama's
// Claude-native values, and locks the non-Claude fallback path. Tolerate, don't
// strip (CONTEXT D-01); no normalizer (D-02); generic extraction (D-03);
// fallback preserved (D-04).

describe("Phase 3: ollama claude compatibility contracts", () => {
  it("Contract COMP-01a: tool_choice preserved when tools array is non-empty (ollama)", () => {
    const model = "claude-sonnet-4-5";
    const toolChoice = { type: "auto" };
    const body = {
      model,
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "get_weather", description: "weather", input_schema: { type: "object" } },
      ],
      tool_choice: toolChoice,
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    expect(result.tool_choice).toEqual(toolChoice);
  });

  it("Contract COMP-01b: metadata survives translateRequest(claude->claude, ollama)", () => {
    const model = "claude-sonnet-4-5";
    const metadata = { user_id: "u1" };
    const body = {
      model,
      messages: [{ role: "user", content: "hi" }],
      metadata,
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    expect(result.metadata).toEqual(metadata);
  });

  it("Contract COMP-01c: cache_control on last system block rewritten to ephemeral+ttl, not stripped (ollama)", () => {
    const model = "claude-sonnet-4-5";
    const body = {
      model,
      system: [
        { type: "text", text: "base instructions", cache_control: { type: "ephemeral" } },
        { type: "text", text: "tail instructions", cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: "hi" }],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    // prepareClaudeRequest strips cache_control from all but last system block,
    // then rewrites the last as { type: "ephemeral", ttl: "1h" }. Proves tolerate-
    // don't-strip: cache_control survives in the canonical rewritten form.
    expect(Array.isArray(result.system)).toBe(true);
    expect(result.system.length).toBe(2);
    expect(result.system[0].cache_control).toBeUndefined();
    expect(result.system[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("Contract COMP-02a: message_delta stop_reason='tool_use' passes through unchanged", () => {
    const chunk = {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 1 },
    };
    const result = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(chunk);
    expect(result[0].delta.stop_reason).toBe("tool_use");
  });

  it("Contract COMP-02b: message_delta stop_reason='end_turn' passes through unchanged", () => {
    const chunk = {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 1 },
    };
    const result = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
    expect(result.length).toBe(1);
    expect(result[0]).toBe(chunk);
    expect(result[0].delta.stop_reason).toBe("end_turn");
  });

  it("Contract COMP-02c: message_delta stop_reason='max_tokens' passes through unchanged", () => {
    const chunk = {
      type: "message_delta",
      delta: { stop_reason: "max_tokens" },
      usage: { output_tokens: 1 },
    };
    const result = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
    expect(result.length).toBe(1);
    expect(result[0]).toBe(chunk);
    expect(result[0].delta.stop_reason).toBe("max_tokens");
  });

  it("Contract COMP-03a: extractUsage reads input_tokens from message_start (Claude shape)", () => {
    const start = {
      type: "message_start",
      message: { usage: { input_tokens: 100 } },
    };
    const u = extractUsage(start);
    expect(u).not.toBeNull();
    expect(u.prompt_tokens).toBe(100);
  });

  it("Contract COMP-03b: extractUsage reads output_tokens from message_delta (Claude shape)", () => {
    const delta = { type: "message_delta", usage: { output_tokens: 50 } };
    const u = extractUsage(delta);
    expect(u).not.toBeNull();
    expect(u.completion_tokens).toBe(50);
  });

  it("Contract COMP-03c: mergeUsage(start, delta) preserves input from start and output from delta", () => {
    const start = {
      type: "message_start",
      message: { usage: { input_tokens: 100 } },
    };
    const delta = { type: "message_delta", usage: { output_tokens: 50 } };
    const merged = mergeUsage(extractUsage(start), extractUsage(delta));
    expect(merged.prompt_tokens).toBe(100);
    expect(merged.completion_tokens).toBe(50);
  });

  it("Contract COMP-03d: cache_read_input_tokens flows through extractUsage + mergeUsage", () => {
    // Proves ollama cache fields ride the same Claude-shape branch (provider-agnostic).
    const start = {
      type: "message_start",
      message: { usage: { input_tokens: 100, cache_read_input_tokens: 40 } },
    };
    const delta = { type: "message_delta", usage: { output_tokens: 50 } };
    const merged = mergeUsage(extractUsage(start), extractUsage(delta));
    expect(merged.cache_read_input_tokens).toBe(40);
  });

  // Re-locks Phase 1 PASS-03: openai-format source must NOT bind a claude transport
  // for ollama or ollama-local; the non-Claude path stays on the default /api/chat.
  it("Contract Fallback-A: resolveTransport(ollama, openai) === null", () => {
    expect(resolveTransport("ollama", FORMATS.OPENAI)).toBeNull();
  });

  it("Contract Fallback-B: resolveTransport(ollama-local, openai) === null", () => {
    expect(resolveTransport("ollama-local", FORMATS.OPENAI)).toBeNull();
  });
});
