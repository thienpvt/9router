// Targeted input-content dump for Kiro/CodeWhisperer failures.
//
// Unlike requestLogger.js (which logs EVERY request behind ENABLE_REQUEST_LOGS),
// this writes the full outbound request body ONLY when a request fails in a way
// worth post-mortem investigation — primarily CONTENT_LENGTH_EXCEEDS_THRESHOLD.
// It is always on (no env gate) but only fires on the error path, so it has zero
// cost on the happy path.
//
// Files land in <cwd>/logs/kiro-content-errors/<timestamp>_<status>.json and the
// directory is pruned to the most recent MAX_FILES dumps to bound disk usage.
import fs from "fs";
import path from "path";

const DUMP_DIR = path.join(
  typeof process !== "undefined" && process.cwd ? process.cwd() : ".",
  "logs",
  "kiro-content-errors"
);
const MAX_FILES = 50;

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `_${String(date.getMilliseconds()).padStart(3, "0")}`
  );
}

// Summarize the conversationState so the dump is scannable without reading the
// whole (potentially multi-MB) body. Reports per-turn content sizes so an
// oversized turn is obvious at a glance.
function summarizeBody(body) {
  try {
    const cs = body?.conversationState || {};
    const history = Array.isArray(cs.history) ? cs.history : [];
    const turns = history.map((h, i) => {
      if (h.userInputMessage) {
        const ctx = h.userInputMessage.userInputMessageContext || {};
        return {
          i,
          role: "user",
          contentChars: (h.userInputMessage.content || "").length,
          toolResults: ctx.toolResults?.length || 0,
          tools: ctx.tools?.length || 0,
          images: h.userInputMessage.images?.length || 0,
        };
      }
      if (h.assistantResponseMessage) {
        return {
          i,
          role: "assistant",
          contentChars: (h.assistantResponseMessage.content || "").length,
          toolUses: h.assistantResponseMessage.toolUses?.length || 0,
        };
      }
      return { i, role: "unknown" };
    });
    const current = cs.currentMessage?.userInputMessage;
    return {
      totalBodyChars: JSON.stringify(body).length,
      historyTurns: history.length,
      currentMessageChars: (current?.content || "").length,
      currentTools:
        current?.userInputMessageContext?.tools?.length || 0,
      turns,
    };
  } catch {
    return { error: "failed to summarize body" };
  }
}

function prune() {
  try {
    const files = fs
      .readdirSync(DUMP_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, t: fs.statSync(path.join(DUMP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(MAX_FILES)) {
      try {
        fs.unlinkSync(path.join(DUMP_DIR, f));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Write a full dump of a failing Kiro request for later investigation.
 * Best-effort and never throws — logging must not break the request path.
 *
 * @param {object} params
 * @param {number} params.status        HTTP status from upstream
 * @param {string} params.errorText     upstream error body
 * @param {object} params.body          the outbound conversationState payload
 * @param {string} [params.url]         upstream URL hit
 * @param {string} [params.model]       resolved upstream model id
 * @param {string} [params.connectionId]
 * @returns {string|null} the dump file path, or null if logging failed
 */
export function dumpKiroContentError({ status, errorText, body, url, model, connectionId }) {
  try {
    fs.mkdirSync(DUMP_DIR, { recursive: true });
    const filePath = path.join(
      DUMP_DIR,
      `${formatTimestamp()}_${status || "err"}.json`
    );
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          status,
          errorText,
          url,
          model,
          connectionId,
          summary: summarizeBody(body),
          body,
        },
        null,
        2
      )
    );
    prune();
    return filePath;
  } catch (err) {
    console.log(`[Kiro] Failed to dump content error: ${err.message}`);
    return null;
  }
}

/**
 * Detect the deterministic "input too large" failure from Kiro/CodeWhisperer.
 * @param {number} status
 * @param {string} errorText
 * @returns {boolean}
 */
export function isContentLengthError(status, errorText) {
  if (status !== 400) return false;
  const t = (errorText || "").toLowerCase();
  return (
    t.includes("content_length_exceeds") ||
    t.includes("content length exceeds") ||
    t.includes("input is too long")
  );
}
