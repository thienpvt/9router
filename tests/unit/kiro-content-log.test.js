import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  isContentLengthError,
  dumpKiroContentError,
} from "../../open-sse/utils/kiroContentLog.js";

const DUMP_DIR = path.join(process.cwd(), "logs", "kiro-content-errors");

describe("kiroContentLog.isContentLengthError", () => {
  const kiroBody =
    '{"message":"Input content length exceeds threshold.","reason":"CONTENT_LENGTH_EXCEEDS_THRESHOLD"}';

  it("detects the CONTENT_LENGTH_EXCEEDS_THRESHOLD reason code", () => {
    expect(isContentLengthError(400, kiroBody)).toBe(true);
  });

  it("detects the human-readable phrasing", () => {
    expect(isContentLengthError(400, "Input content length exceeds threshold.")).toBe(true);
  });

  it("ignores other 400s", () => {
    expect(isContentLengthError(400, "Improperly formed request")).toBe(false);
  });

  it("ignores non-400 statuses even with matching text", () => {
    expect(isContentLengthError(429, kiroBody)).toBe(false);
  });
});

describe("kiroContentLog.dumpKiroContentError", () => {
  const written = [];

  afterAll(() => {
    for (const f of written) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  it("writes a dump file with a per-turn summary and the full body", () => {
    const body = {
      conversationState: {
        history: [
          { userInputMessage: { content: "x".repeat(1000) } },
          { assistantResponseMessage: { content: "ok", toolUses: [{}] } },
        ],
        currentMessage: {
          userInputMessage: {
            content: "hi",
            userInputMessageContext: { tools: [{}, {}] },
          },
        },
      },
    };

    const filePath = dumpKiroContentError({
      status: 400,
      errorText: "CONTENT_LENGTH_EXCEEDS_THRESHOLD",
      body,
      url: "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse",
      model: "claude-opus-4.8",
      connectionId: "abc12345",
    });

    expect(filePath).toBeTruthy();
    written.push(filePath);
    expect(fs.existsSync(filePath)).toBe(true);

    const dump = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(dump.status).toBe(400);
    expect(dump.model).toBe("claude-opus-4.8");
    expect(dump.connectionId).toBe("abc12345");
    expect(dump.summary.historyTurns).toBe(2);
    expect(dump.summary.turns[0]).toMatchObject({ role: "user", contentChars: 1000 });
    expect(dump.summary.turns[1]).toMatchObject({ role: "assistant", toolUses: 1 });
    expect(dump.summary.currentTools).toBe(2);
    // Full body is preserved for investigation.
    expect(dump.body.conversationState.history.length).toBe(2);
  });

  it("returns a path inside logs/kiro-content-errors", () => {
    const filePath = dumpKiroContentError({
      status: 400,
      errorText: "input is too long",
      body: { conversationState: {} },
    });
    written.push(filePath);
    expect(path.dirname(filePath)).toBe(DUMP_DIR);
  });
});
