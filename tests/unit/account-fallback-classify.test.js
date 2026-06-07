import { describe, it, expect } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

/**
 * Regression: a deterministic "input too large" 400 from Kiro / CodeWhisperer
 * (CONTENT_LENGTH_EXCEEDS_THRESHOLD) must NOT trigger account rotation — every
 * account would fail identically on the same oversized request. It should fail
 * fast with shouldFallback=false and no cooldown.
 */
describe("checkFallbackError — content-length-exceeded (non-fallback)", () => {
  const kiroBody =
    '{"message":"Input content length exceeds threshold.","reason":"CONTENT_LENGTH_EXCEEDS_THRESHOLD"}';

  it("does not fall back on Kiro CONTENT_LENGTH_EXCEEDS_THRESHOLD", () => {
    expect(checkFallbackError(400, kiroBody)).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("matches the human-readable 'Input content length exceeds' message", () => {
    expect(
      checkFallbackError(400, "Input content length exceeds threshold.")
    ).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("matches 'input is too long' phrasing", () => {
    expect(checkFallbackError(400, "input is too long")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("still falls back on a generic 400 (transient cooldown)", () => {
    const r = checkFallbackError(400, "some other bad request");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("still applies exponential backoff on 429 rate limits", () => {
    const r = checkFallbackError(429, "rate limit exceeded");
    expect(r.shouldFallback).toBe(true);
    expect(r.newBackoffLevel).toBe(1);
  });

  it("still falls back on 'Improperly formed request' 400 (Kiro schema guard)", () => {
    const r = checkFallbackError(400, "Improperly formed request");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });
});
