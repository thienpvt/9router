import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getProvider } from "../../src/lib/oauth/providers.js";

/**
 * Regression test for the Kiro AWS SSO OIDC (Builder ID / IDC) flow not
 * persisting profileArn. The OIDC /token endpoint returns no profileArn, so the
 * provider must fetch it from CodeWhisperer's ListAvailableProfiles via
 * postExchange and surface it through mapTokens.
 */
describe("kiro provider profileArn resolution", () => {
  const kiro = getProvider("kiro");

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches profileArn via ListAvailableProfiles when SSO token has none", async () => {
    const expectedArn = "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ profiles: [{ profileArn: expectedArn }] }),
    });

    const tokens = {
      access_token: "aoaAAAA-access",
      refresh_token: "aorAAAA-refresh",
      expires_in: 3600,
      profile_arn: null,
      _region: "us-east-1",
      _authMethod: "idc",
      _clientId: "client-id",
      _clientSecret: "client-secret",
    };

    const extra = await kiro.postExchange(tokens);
    expect(extra.profileArn).toBe(expectedArn);

    // Verify it hit the CodeWhisperer ListAvailableProfiles target.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://codewhisperer.us-east-1.amazonaws.com");
    expect(init.headers["x-amz-target"]).toBe(
      "AmazonCodeWhispererService.ListAvailableProfiles"
    );
    expect(init.headers.Authorization).toBe("Bearer aoaAAAA-access");

    const mapped = kiro.mapTokens(tokens, extra);
    expect(mapped.providerSpecificData.profileArn).toBe(expectedArn);
    expect(mapped.providerSpecificData.authMethod).toBe("idc");
  });

  it("prefers a profile matching the token region", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        profiles: [
          { profileArn: "arn:aws:codewhisperer:eu-west-1:111:profile/EU" },
          { profileArn: "arn:aws:codewhisperer:us-east-1:222:profile/US" },
        ],
      }),
    });

    const extra = await kiro.postExchange({
      access_token: "t",
      _region: "us-east-1",
      _authMethod: "builder-id",
    });
    expect(extra.profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:222:profile/US"
    );
  });

  it("skips the network call when profile_arn is already present (social flow)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const extra = await kiro.postExchange({
      access_token: "t",
      profile_arn: "arn:aws:codewhisperer:us-east-1:333:profile/SOCIAL",
    });
    expect(extra.profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:333:profile/SOCIAL"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null profileArn (does not throw) when the API call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "AccessDenied",
    });

    const extra = await kiro.postExchange({
      access_token: "t",
      _region: "us-east-1",
    });
    expect(extra.profileArn).toBeNull();

    const mapped = kiro.mapTokens({ access_token: "t" }, extra);
    expect(mapped.providerSpecificData.profileArn).toBeNull();
  });
});
