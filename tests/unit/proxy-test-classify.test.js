import { describe, it, expect } from "vitest";
import { testProxyUrl } from "../../src/lib/network/proxyTest.js";

// Regression tests for the misleading "must start with http: or https:" error.
// A typo'd scheme (e.g. "sock5s://") previously fell through to undici's
// ProxyAgent, which only reports http/https — hiding SOCKS support entirely.

describe("testProxyUrl — proxy URL classification", () => {
  it("gives a typo hint for the 'sock5s' scheme instead of an http-only error", async () => {
    const res = await testProxyUrl({ proxyUrl: "sock5s://127.0.0.1:1080" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toContain("Unsupported proxy protocol");
    expect(res.error).toContain('Did you mean "socks5:"');
    // The old, confusing message must no longer surface.
    expect(res.error).not.toContain("must start with");
  });

  it("lists supported schemes for an unrelated unsupported protocol", async () => {
    const res = await testProxyUrl({ proxyUrl: "ftp://127.0.0.1:1080" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toContain("Unsupported proxy protocol");
    expect(res.error).toContain("socks5");
  });

  it("reports a clear message for a totally malformed URL", async () => {
    const res = await testProxyUrl({ proxyUrl: "not a url" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toContain("Invalid proxy URL");
  });

  it("requires a proxyUrl", async () => {
    const res = await testProxyUrl({ proxyUrl: "" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toContain("proxyUrl is required");
  });

  it("accepts a valid socks5 scheme (reaches the connection stage, not a 400)", async () => {
    // Port 1 refuses, so this fails at connect time — but it must NOT be
    // rejected as an invalid/unsupported URL (status 400). A connection
    // failure is status 500, proving the SOCKS path was taken.
    const res = await testProxyUrl({
      proxyUrl: "socks5://127.0.0.1:1",
      timeoutMs: 2000,
    });
    expect(res.ok).toBe(false);
    expect(res.status).not.toBe(400);
  });
});
