import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

import { PROVIDER_MODELS, getModelSupportedFormats, isValidModel } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import "../translator/registerAll.js";

// Official OpenCode Go endpoint families (opencode.ai/docs/go/#endpoints):
//   chat/completions — GLM, Kimi, DeepSeek, MiMo, Hy, LongCat, Omen
//   messages         — MiniMax, Qwen
//   responses        — Grok, GPT-5.6 Luna, Muse Spark
const CHAT_ONLY = [
  "glm-5", "glm-5.1", "glm-5.2", "glm-5.3", "glm-5.3-flash",
  "kimi-k2.5", "kimi-k2.6", "kimi-k2.7-code", "kimi-k3", "longcat-2.0",
  "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro",
  "deepseek-v4.1-flash",
  "mimo-v2-omni", "mimo-v2-pro", "mimo-v2.5", "mimo-v2.5-pro",
  "hy3", "hy3-preview", "hy4-preview", "omen-alpha",
];
const CLAUDE_CAPABLE = [
  "minimax-m2.5", "minimax-m2.7", "minimax-m3",
  "qwen3.5-plus", "qwen3.6-plus", "qwen3.7-max", "qwen3.7-plus",
  "qwen3.8-flash", "qwen3.8-max",
];
const RESPONSES_CAPABLE = [
  "gpt-5.6-luna", "grok-4.5", "grok-4.6",
  "muse-spark-1.2-contributor", "muse-spark-1.3-contributor",
];

const SYNTHETIC_UNKNOWN = "synthetic-unknown-model";

// Mirror of chatCore's per-model transport guard: use the sourceFormat-matched
// transport only when the model declares support for that sourceFormat.
function pickTransport(provider, sourceFormat, alias, model) {
  const supported = getModelSupportedFormats(alias, model);
  const rt = resolveTransport(provider, sourceFormat);
  const allowed = supported !== null ? supported.includes(sourceFormat) : isValidModel(alias, model);
  return allowed ? rt : null;
}

describe("OpenCode Go model catalog", () => {
  it("matches the official model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((m) => m.id).sort();
    expect(ids).toEqual([...CHAT_ONLY, ...CLAUDE_CAPABLE, ...RESPONSES_CAPABLE].sort());
  });

  it("registers deepseek-v4.1-flash as DeepSeek V4.1 Flash with [openai] format", () => {
    const entry = (PROVIDER_MODELS["opencode-go"] || []).find((m) => m.id === "deepseek-v4.1-flash");
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("DeepSeek V4.1 Flash");
    expect(entry?.supportedFormats).toEqual(["openai"]);
  });

  it("returns null supportedFormats and null transport for uncatalogued synthetic model", () => {
    expect(getModelSupportedFormats("opencode-go", SYNTHETIC_UNKNOWN)).toBeNull();
    expect(pickTransport("opencode-go", "claude", "opencode-go", SYNTHETIC_UNKNOWN)).toBeNull();
  });
});

describe("OpenCode Go per-model supportedFormats", () => {
  it("declares [openai, claude] for MiniMax + Qwen models", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai", "claude"]);
    }
  });

  it("declares [openai-responses] only for responses-family models", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai-responses"]);
    }
  });

  it("declares [openai] only for chat-only models (GLM/Kimi/DeepSeek/MiMo/Hy/Omen/LongCat) → guards /messages routing", () => {
    for (const m of CHAT_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai"]);
    }
  });
});

describe("OpenCode Go multi-endpoint transports", () => {
  it("declares openai / claude / openai-responses transports", () => {
    const formats = (PROVIDERS["opencode-go"].transports || []).map((t) => t.format);
    expect(formats).toEqual(["openai", "claude", "openai-responses"]);
  });

  it("resolveTransport picks the endpoint matching the client sourceFormat", () => {
    expect(resolveTransport("opencode-go", "claude").baseUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(resolveTransport("opencode-go", "openai-responses").baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
    expect(resolveTransport("opencode-go", "openai").baseUrl).toBe("https://opencode.ai/zen/go/v1/chat/completions");
  });

  it("uses x-api-key + anthropicVersion on the claude transport", () => {
    const t = resolveTransport("opencode-go", "claude");
    expect(t.auth.header).toBe("x-api-key");
    expect(t.auth.anthropicVersion).toBe(true);
  });
});

describe("OpenCode Go per-model transport guard (chatCore logic)", () => {
  it("routes MiniMax/Qwen + claude-format client to /messages", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    }
  });

  it("does NOT route chat-only models to /messages on a claude-format request", () => {
    for (const m of CHAT_ONLY) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)).toBeNull();
    }
  });

  it("routes responses-family + responses-format client to /responses", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
    }
  });

  it("does NOT route chat-only models (incl. DeepSeek) to /messages on a claude-format request", () => {
    for (const m of CHAT_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).not.toContain("claude");
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)).toBeNull();
    }
  });

  it("routes responses-only models to /responses, never to /messages or /chat/completions", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)).toBeNull();
      expect(pickTransport("opencode-go", "openai", "opencode-go", m)).toBeNull();
    }
  });

  it("does NOT route MiniMax/Qwen (no responses support) to /responses", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)).toBeNull();
    }
  });
});

describe("handler fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([SYNTHETIC_UNKNOWN, "deepseek-v4.1-flash"])(
    "routes %s to /chat/completions when requested via Claude format",
    async (testModel) => {
      const executor = getExecutor("opencode-go");
      let capturedArgs = null;
      let resolvedUrl = null;

      vi.spyOn(executor, "execute").mockImplementation(async (args) => {
        capturedArgs = args;
        resolvedUrl = executor.buildUrl(args.model, args.stream, 0, args.credentials);
        return {
          response: new Response(
            JSON.stringify({
              id: "chatcmpl-test",
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: args.model,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "fallback response" },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          ),
          url: resolvedUrl,
          headers: {},
          transformedBody: args.body,
        };
      });

      const result = await handleChatCore({
        body: {
          model: testModel,
          max_tokens: 100,
          messages: [{ role: "user", content: "hello" }],
          stream: false,
        },
        modelInfo: { provider: "opencode-go", model: testModel },
        credentials: { apiKey: "test-fake-key", providerSpecificData: {} },
        sourceFormatOverride: "claude",
        stream: false,
        rtkEnabled: false,
        headroomEnabled: false,
        cavemanEnabled: false,
        ponytailEnabled: false,
        pxpipeEnabled: false,
        log: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          line: vi.fn(),
          errorLine: vi.fn(),
        },
        connectionId: "test-connection-id",
      });

      expect(capturedArgs).not.toBeNull();
      expect(capturedArgs.credentials?.runtimeTransport).toBeUndefined();
      expect(Array.isArray(capturedArgs.body.messages)).toBe(true);
      expect(capturedArgs.body.messages[0]).toMatchObject({ role: "user", content: "hello" });
      expect(resolvedUrl).toBe("https://opencode.ai/zen/go/v1/chat/completions");
      expect(result.success).toBe(true);
      expect(result.response.status).toBe(200);
    }
  );
});
