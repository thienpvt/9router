// Byte-budget history truncation for Kiro / AWS CodeWhisperer requests.
//
// CodeWhisperer's GenerateAssistantResponse rejects oversized request bodies with
// HTTP 400 {"reason":"CONTENT_LENGTH_EXCEEDS_THRESHOLD"}. The limit is on the RAW
// SERIALIZED BYTES of the request payload — not tokens, not the model's context
// window. A long agentic session (many turns, large subagent tool results) plus
// the byte-heavy Kiro JSON shape easily exceeds it long before the model's token
// limit is reached.
//
// This trims the oldest history turns until the serialized payload fits a byte
// budget, always preserving the currentMessage (which carries the system prompt
// prefix) and the most recent N turns. It mirrors the approach proven in the
// Kiro-Go reference fork (proxy/translator.go: maxPayloadBytes = 900 KiB,
// minRecentHistoryTurns = 4). Runs AFTER RTK compression so truncation only does
// what compression couldn't.

// 900 KiB — conservatively below the observed (undocumented) upstream threshold,
// leaving headroom for headers and serialization overhead. Env-overridable.
const DEFAULT_MAX_PAYLOAD_BYTES = 900 * 1024;
const DEFAULT_MIN_RECENT_TURNS = 4;

const TRUNCATION_PLACEHOLDER =
  "[Earlier conversation history was truncated to fit the provider's request-size limit.]";

const _encoder = new TextEncoder();

function jsonByteSize(obj) {
  return _encoder.encode(JSON.stringify(obj)).length;
}

function resolveMaxBytes() {
  const raw = typeof process !== "undefined" && process.env?.KIRO_MAX_PAYLOAD_BYTES;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_PAYLOAD_BYTES;
}

function resolveMinRecentTurns() {
  const raw = typeof process !== "undefined" && process.env?.KIRO_MIN_RECENT_TURNS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_RECENT_TURNS;
}

/**
 * Fold toolResults whose toolUseId has no matching toolUse (in the kept history)
 * back into the user turn's plain text. Dropping old assistant turns orphans the
 * toolResults that referenced their toolUses — leaving the dangling structured
 * reference makes Kiro 400 ("Improperly formed request"). Mutates in place.
 */
function reconcileOrphanedToolResults(history, currentMessage) {
  const validIds = new Set();
  for (const h of history) {
    for (const tu of h?.assistantResponseMessage?.toolUses || []) {
      if (tu.toolUseId) validIds.add(tu.toolUseId);
    }
  }

  const carriers = currentMessage ? [...history, currentMessage] : history;
  for (const item of carriers) {
    const uim = item?.userInputMessage;
    const ctx = uim?.userInputMessageContext;
    if (!ctx?.toolResults?.length) continue;

    const kept = [];
    const salvaged = [];
    for (const tr of ctx.toolResults) {
      if (validIds.has(tr.toolUseId)) {
        kept.push(tr);
      } else {
        const text = Array.isArray(tr.content)
          ? tr.content.map((c) => c?.text || "").join("\n")
          : "";
        salvaged.push(`[Tool result: ${text}]`);
      }
    }

    if (salvaged.length === 0) continue;

    const extra = salvaged.join("\n");
    uim.content = uim.content ? `${uim.content}\n\n${extra}` : extra;
    ctx.toolResults = kept;
    if (kept.length === 0 && !ctx.tools?.length) {
      delete uim.userInputMessageContext;
    }
  }
}

/**
 * Shrink an over-budget currentMessage content as a last resort: keep the head
 * and tail, drop the middle, so both the system-prompt prefix and the actual
 * trailing user request survive.
 */
function shrinkText(text, maxChars) {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  const marker = "\n\n[... middle of this message truncated to fit size limit ...]\n\n";
  const keep = Math.max(0, maxChars - marker.length);
  const head = Math.floor(keep * 0.6);
  const tail = keep - head;
  return text.slice(0, head) + marker + text.slice(text.length - tail);
}

/**
 * Truncate a Kiro conversationState payload in place to fit a byte budget.
 *
 * @param {object} payload - Kiro request body with conversationState.
 * @param {object} [opts]
 * @param {number} [opts.maxBytes] - byte budget (default 900 KiB / env).
 * @param {number} [opts.minRecentTurns] - min recent history turns to keep.
 * @returns {{truncated: boolean, droppedTurns?: number, bytesBefore?: number, bytesAfter?: number}}
 */
export function truncateKiroPayload(payload, opts = {}) {
  const cs = payload?.conversationState;
  if (!cs) return { truncated: false };

  const maxBytes = opts.maxBytes ?? resolveMaxBytes();
  const minRecent = opts.minRecentTurns ?? resolveMinRecentTurns();

  const bytesBefore = jsonByteSize(payload);
  if (bytesBefore <= maxBytes) return { truncated: false, bytesBefore };

  const history = Array.isArray(cs.history) ? cs.history : [];

  // Base cost = everything except history (currentMessage, profileArn, inferenceConfig,
  // the conversationState wrapper). Per-turn cost measured once for prefix-sum dropping
  // so we never re-stringify the whole payload in a loop (this runs on every request).
  const savedHistory = cs.history;
  cs.history = [];
  const baseBytes = jsonByteSize(payload);
  cs.history = savedHistory;

  const turnBytes = history.map((t) => jsonByteSize(t) + 1); // +1 for the array comma
  const placeholderBytes = _encoder.encode(TRUNCATION_PLACEHOLDER).length + 8;

  // Keep the largest recent suffix that fits, but never fewer than minRecent turns.
  let suffix = 0;
  let startIdx = history.length;
  for (let i = history.length - 1; i >= 0; i--) {
    const next = suffix + turnBytes[i];
    const keptCount = history.length - i;
    if (baseBytes + next + placeholderBytes > maxBytes && keptCount > minRecent) break;
    suffix = next;
    startIdx = i;
  }

  let kept = history.slice(startIdx);
  // History must start on a user turn (Kiro alternation + the placeholder is folded
  // into the first user turn's text).
  while (kept.length > 0 && !kept[0].userInputMessage) kept = kept.slice(1);

  const droppedTurns = history.length - kept.length;

  // Dropping old assistant turns can orphan toolResults in kept user turns.
  reconcileOrphanedToolResults(kept, cs.currentMessage);

  // Prepend the truncation marker to the first kept user turn (or to currentMessage
  // if no history survives), so the model knows context was dropped.
  if (droppedTurns > 0) {
    if (kept[0]?.userInputMessage) {
      kept[0].userInputMessage.content =
        `${TRUNCATION_PLACEHOLDER}\n\n${kept[0].userInputMessage.content || ""}`;
    } else {
      const cm = cs.currentMessage?.userInputMessage;
      if (cm) cm.content = `${TRUNCATION_PLACEHOLDER}\n\n${cm.content || ""}`;
    }
  }

  cs.history = kept;

  // Last resort: if the currentMessage alone (plus the minimum kept turns) still
  // blows the budget, shrink the currentMessage content, then drop remaining
  // history entirely if even that is not enough.
  if (jsonByteSize(payload) > maxBytes) {
    const cm = cs.currentMessage?.userInputMessage;
    if (cm && typeof cm.content === "string") {
      const overshoot = jsonByteSize(payload) - maxBytes;
      cm.content = shrinkText(cm.content, Math.max(2000, cm.content.length - overshoot - 256));
    }
    if (jsonByteSize(payload) > maxBytes) {
      cs.history = [];
    }
  }

  return {
    truncated: droppedTurns > 0 || jsonByteSize(payload) < bytesBefore,
    droppedTurns,
    bytesBefore,
    bytesAfter: jsonByteSize(payload),
  };
}

export const _internal = {
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_MIN_RECENT_TURNS,
  TRUNCATION_PLACEHOLDER,
  reconcileOrphanedToolResults,
  shrinkText,
  jsonByteSize,
};
