import { describe, expect, it, vi } from "vitest";
import {
  createPersonSessionLifecycle,
  type PersonAuthProvider,
  type PersonSessionTokens,
} from "../src/modules/identity/application/manage-person-session";
import { NodePersonPkceGenerator } from "../src/modules/identity/infrastructure/node-person-pkce";

const tokens: PersonSessionTokens = {
  accessToken: "header.payload.signature",
  refreshToken: "refresh-token-value-1234",
  expiresInSeconds: 3600,
};

describe("person session lifecycle", () => {
  it("creates one PKCE challenge and sends only its public challenge", async () => {
    const provider = providerStub();
    const lifecycle = createPersonSessionLifecycle({
      provider,
      verifier: { verify: vi.fn() },
      pkce: {
        createChallenge: () => ({
          verifier: "v".repeat(43),
          challenge: "c".repeat(43),
          state: "s".repeat(43),
        }),
      },
    });

    await expect(
      lifecycle.begin(
        "person@example.com",
        (state) => `https://eject.test/cb?state=${state}`,
      ),
    ).resolves.toEqual({
      outcome: "ACCEPTED",
      challenge: {
        verifier: "v".repeat(43),
        challenge: "c".repeat(43),
        state: "s".repeat(43),
      },
    });
    expect(provider.requestEmailSignIn).toHaveBeenCalledWith({
      email: "person@example.com",
      redirectTo: `https://eject.test/cb?state=${"s".repeat(43)}`,
      codeChallenge: "c".repeat(43),
    });
  });

  it("accepts exchange, OTP, and refresh tokens only after JWT verification", async () => {
    const provider = providerStub();
    const verify = vi.fn().mockResolvedValue({ personId: "person" });
    const lifecycle = createPersonSessionLifecycle({
      provider,
      verifier: { verify },
      pkce: new NodePersonPkceGenerator(),
    });

    await expect(lifecycle.exchangeCode("code", "verifier")).resolves.toEqual({
      outcome: "AUTHENTICATED",
      tokens,
    });
    await expect(
      lifecycle.verifyEmailOtp("person@example.com", "123456"),
    ).resolves.toEqual({ outcome: "AUTHENTICATED", tokens });
    await expect(lifecycle.refresh(tokens.refreshToken)).resolves.toEqual({
      outcome: "AUTHENTICATED",
      tokens,
    });
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it("maps provider rejection and unavailability without token verification", async () => {
    const provider = providerStub();
    vi.mocked(provider.exchangeCode).mockResolvedValueOnce({
      outcome: "REJECTED",
    });
    vi.mocked(provider.verifyEmailOtp).mockResolvedValueOnce({
      outcome: "UNAVAILABLE",
    });
    const verify = vi.fn();
    const lifecycle = createPersonSessionLifecycle({
      provider,
      verifier: { verify },
      pkce: new NodePersonPkceGenerator(),
    });

    await expect(lifecycle.exchangeCode("code", "verifier")).resolves.toEqual({
      outcome: "REJECTED",
    });
    await expect(
      lifecycle.verifyEmailOtp("person@example.com", "123456"),
    ).resolves.toEqual({ outcome: "UNAVAILABLE" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("fails closed when an auth provider returns an unverifiable access token", async () => {
    const lifecycle = createPersonSessionLifecycle({
      provider: providerStub(),
      verifier: { verify: vi.fn().mockResolvedValue(null) },
      pkce: new NodePersonPkceGenerator(),
    });
    await expect(lifecycle.refresh(tokens.refreshToken)).resolves.toEqual({
      outcome: "UNAVAILABLE",
    });
  });

  it("performs local provider logout only when an access token exists", async () => {
    const provider = providerStub();
    const lifecycle = createPersonSessionLifecycle({
      provider,
      verifier: { verify: vi.fn() },
      pkce: new NodePersonPkceGenerator(),
    });
    await expect(lifecycle.signOut(null)).resolves.toBe("SIGNED_OUT");
    await expect(lifecycle.signOut(tokens.accessToken)).resolves.toBe(
      "SIGNED_OUT",
    );
    expect(provider.signOut).toHaveBeenCalledTimes(1);
  });

  it("generates independent RFC 7636 S256 verifier, challenge, and state values", () => {
    const first = new NodePersonPkceGenerator().createChallenge();
    const second = new NodePersonPkceGenerator().createChallenge();
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      new Set([first.verifier, first.challenge, first.state, second.state])
        .size,
    ).toBe(4);
  });
});

function providerStub(): PersonAuthProvider {
  return {
    requestEmailSignIn: vi.fn().mockResolvedValue("ACCEPTED"),
    exchangeCode: vi.fn().mockResolvedValue({ outcome: "TOKENS", tokens }),
    verifyEmailOtp: vi.fn().mockResolvedValue({ outcome: "TOKENS", tokens }),
    refresh: vi.fn().mockResolvedValue({ outcome: "TOKENS", tokens }),
    signOut: vi.fn().mockResolvedValue("SIGNED_OUT"),
  };
}
