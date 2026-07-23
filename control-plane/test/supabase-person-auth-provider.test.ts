import { describe, expect, it, vi } from "vitest";
import { SupabasePersonAuthProvider } from "../src/modules/identity/infrastructure/supabase-person-auth-provider";

const publishableKey = `sb_publishable_${"a".repeat(32)}`;
const tokenResponse = {
  access_token: "header.payload.signature",
  refresh_token: "A1b2C3d4E5f6",
  expires_in: 3600,
  token_type: "bearer",
};

describe("Supabase person auth provider", () => {
  it("requests existing-user email PKCE without exposing verifier or enabling signup", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}));
    const provider = createProvider(fetcher);
    await expect(
      provider.requestEmailSignIn({
        email: "person@example.com",
        redirectTo: `https://eject.test/api/person/v1/auth/callback?state=${"s".repeat(43)}`,
        codeChallenge: "c".repeat(43),
      }),
    ).resolves.toBe("ACCEPTED");

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://project.supabase.co/auth/v1/otp?redirect_to=${encodeURIComponent(
        `https://eject.test/api/person/v1/auth/callback?state=${"s".repeat(43)}`,
      )}`,
    );
    expect(init.headers).toMatchObject({
      apikey: publishableKey,
    });
    expect(init.headers).not.toHaveProperty("authorization");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "person@example.com",
      data: {},
      create_user: false,
      code_challenge: "c".repeat(43),
      code_challenge_method: "s256",
    });
  });

  it("uses the exact PKCE, OTP, and refresh exchanges and returns bounded tokens", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(tokenResponse)));
    const provider = createProvider(fetcher);

    await expect(
      provider.exchangeCode({ code: "auth-code", codeVerifier: "verifier" }),
    ).resolves.toEqual({ outcome: "TOKENS", tokens: expectedTokens() });
    await expect(
      provider.verifyEmailOtp({ email: "person@example.com", token: "123456" }),
    ).resolves.toEqual({ outcome: "TOKENS", tokens: expectedTokens() });
    await expect(
      provider.refresh(tokenResponse.refresh_token),
    ).resolves.toEqual({
      outcome: "TOKENS",
      tokens: expectedTokens(),
    });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://project.supabase.co/auth/v1/token?grant_type=pkce",
      "https://project.supabase.co/auth/v1/verify",
      "https://project.supabase.co/auth/v1/token?grant_type=refresh_token",
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      auth_code: "auth-code",
      code_verifier: "verifier",
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      email: "person@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("separates rejected credentials from transient and malformed provider failures", async () => {
    const rejected = createProvider(
      vi.fn().mockResolvedValue(Response.json({}, { status: 400 })),
    );
    const limited = createProvider(
      vi.fn().mockResolvedValue(Response.json({}, { status: 429 })),
    );
    const malformed = createProvider(
      vi.fn().mockResolvedValue(Response.json({ access_token: "missing" })),
    );
    const unavailable = createProvider(
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    await expect(rejected.refresh("refresh-token-value-1234")).resolves.toEqual(
      {
        outcome: "REJECTED",
      },
    );
    await expect(limited.refresh("refresh-token-value-1234")).resolves.toEqual({
      outcome: "UNAVAILABLE",
    });
    await expect(
      malformed.refresh("refresh-token-value-1234"),
    ).resolves.toEqual({
      outcome: "UNAVAILABLE",
    });
    await expect(
      unavailable.refresh("refresh-token-value-1234"),
    ).resolves.toEqual({
      outcome: "UNAVAILABLE",
    });
  });

  it("treats bounded email responses generically and oversized responses as unavailable", async () => {
    const absentUser = createProvider(
      vi.fn().mockResolvedValue(Response.json({}, { status: 422 })),
    );
    const oversized = createProvider(
      vi
        .fn()
        .mockResolvedValue(
          new Response("", { headers: { "content-length": "65537" } }),
        ),
    );
    const misconfigured = createProvider(
      vi.fn().mockResolvedValue(Response.json({}, { status: 401 })),
    );
    await expect(
      absentUser.requestEmailSignIn({
        email: "nobody@example.com",
        redirectTo: "https://eject.test/callback",
        codeChallenge: "c".repeat(43),
      }),
    ).resolves.toBe("ACCEPTED");
    await expect(
      oversized.requestEmailSignIn({
        email: "person@example.com",
        redirectTo: "https://eject.test/callback",
        codeChallenge: "c".repeat(43),
      }),
    ).resolves.toBe("UNAVAILABLE");
    await expect(
      misconfigured.requestEmailSignIn({
        email: "person@example.com",
        redirectTo: "https://eject.test/callback",
        codeChallenge: "c".repeat(43),
      }),
    ).resolves.toBe("UNAVAILABLE");
  });

  it("performs local-scope logout and accepts already-invalid sessions", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    const provider = createProvider(fetcher);
    await expect(provider.signOut("header.payload.signature")).resolves.toBe(
      "SIGNED_OUT",
    );
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://project.supabase.co/auth/v1/logout?scope=local");
    expect(init.headers).toMatchObject({
      apikey: publishableKey,
      authorization: "Bearer header.payload.signature",
    });
  });

  it("uses a legacy anon JWT as both the API key and bearer credential", async () => {
    const legacyAnonKey = `${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;
    const fetcher = vi.fn().mockResolvedValue(Response.json({}));
    const provider = createProvider(fetcher, legacyAnonKey);

    await provider.requestEmailSignIn({
      email: "person@example.com",
      redirectTo: "https://eject.test/callback",
      codeChallenge: "c".repeat(43),
    });

    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      apikey: legacyAnonKey,
      authorization: `Bearer ${legacyAnonKey}`,
    });
  });

  it("rejects malformed issuer and publishable-key configuration", () => {
    expect(
      () =>
        new SupabasePersonAuthProvider({
          issuer: "http://project.supabase.co/auth/v1",
          publishableKey,
        }),
    ).toThrow("HTTPS /auth/v1");
    expect(
      () =>
        new SupabasePersonAuthProvider({
          issuer: "https://project.supabase.co/auth/v1",
          publishableKey: "secret with spaces",
        }),
    ).toThrow("publishable key");
    expect(
      () =>
        new SupabasePersonAuthProvider({
          issuer: "https://project.supabase.co/auth/v1",
          publishableKey: `sb_secret_${"a".repeat(32)}`,
        }),
    ).toThrow("publishable key");
  });
});

function createProvider(
  fetcher: ReturnType<typeof vi.fn>,
  key: string = publishableKey,
) {
  return new SupabasePersonAuthProvider({
    issuer: "https://project.supabase.co/auth/v1",
    publishableKey: key,
    fetch: fetcher as unknown as typeof fetch,
  });
}

function expectedTokens() {
  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresInSeconds: tokenResponse.expires_in,
  };
}
