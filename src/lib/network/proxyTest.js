import { ProxyAgent, fetch as undiciFetch } from "undici";
import { isSocksProxyUrl, createSocksDispatcher } from "open-sse/utils/socksDispatcher.js";

const DEFAULT_TEST_URL = "https://google.com/";
const DEFAULT_TIMEOUT_MS = 8000;

function getErrorMessage(err) {
  if (!err) return "Unknown error";
  const base = err?.message || String(err);
  const causeCode = err?.cause?.code || err?.code;
  const causeMessage = err?.cause?.message;

  if (causeMessage && causeMessage !== base) {
    return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
  }

  if (causeCode && !base.includes(causeCode)) {
    return `${base} (${causeCode})`;
  }

  return base;
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

const HTTP_PROXY_SCHEMES = new Set(["http:", "https:"]);
const SUPPORTED_PROXY_SCHEMES = "http, https, socks, socks4, socks4a, socks5, socks5h";

/**
 * Classify a proxy URL into { kind: "socks" | "http" } or { error } with a
 * helpful message. Undici's ProxyAgent only reports "must start with http/https"
 * for any non-http scheme, which hides SOCKS support and masks simple typos
 * (e.g. "sock5s://" instead of "socks5://"), so we detect those up front.
 */
function classifyProxyUrl(proxyUrl) {
  if (isSocksProxyUrl(proxyUrl)) return { kind: "socks" };

  let protocol;
  try {
    protocol = new URL(proxyUrl).protocol.toLowerCase();
  } catch {
    return {
      error: `Invalid proxy URL "${proxyUrl}". Expected e.g. socks5://host:port or http://host:port.`,
    };
  }

  if (HTTP_PROXY_SCHEMES.has(protocol)) return { kind: "http" };

  const hint = protocol.startsWith("sock") ? ` Did you mean "socks5:"?` : "";
  return {
    error: `Unsupported proxy protocol "${protocol}". Supported schemes: ${SUPPORTED_PROXY_SCHEMES}.${hint}`,
  };
}

export async function testProxyUrl({ proxyUrl, testUrl, timeoutMs } = {}) {
  const normalizedProxyUrl = normalizeString(proxyUrl);
  if (!normalizedProxyUrl) {
    return { ok: false, status: 400, error: "proxyUrl is required" };
  }

  const normalizedTestUrl = normalizeString(testUrl) || DEFAULT_TEST_URL;
  const timeoutMsRaw = Number(timeoutMs);
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, 30000)
      : DEFAULT_TIMEOUT_MS;

  let dispatcher;

  try {
    const classification = classifyProxyUrl(normalizedProxyUrl);
    if (classification.error) {
      return { ok: false, status: 400, error: classification.error };
    }

    try {
      dispatcher =
        classification.kind === "socks"
          ? createSocksDispatcher(normalizedProxyUrl)
          : new ProxyAgent({ uri: normalizedProxyUrl });
    } catch (err) {
      return {
        ok: false,
        status: 400,
        error: `Invalid proxy URL: ${err?.message || String(err)}`,
      };
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const res = await undiciFetch(normalizedTestUrl, {
        method: "HEAD",
        dispatcher,
        signal: controller.signal,
        headers: {
          "User-Agent": "9Router",
        },
      });

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: normalizedTestUrl,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? "Proxy test timed out"
          : getErrorMessage(err);
      return { ok: false, status: 500, error: message };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {
      // ignore
    }
  }
}
