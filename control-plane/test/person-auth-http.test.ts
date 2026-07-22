import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonSessionLifecycle } from "../src/modules/identity/application/manage-person-session";
import {
  handleBeginPersonAuth,
  handleLogoutPersonSession,
  handlePersonAuthCallback,
  handleRefreshPersonSession,
  handleVerifyPersonOtp,
  type PersonAuthHttpDependencies,
} from "../src/modules/identity/transport/person-auth-http-handlers";
import { POST as gatedBegin } from "../src/app/api/person/v1/auth/magic-link/route";
import { GET as gatedCallback } from "../src/app/api/person/v1/auth/callback/route";
import { POST as gatedLogout } from "../src/app/api/person/v1/auth/logout/route";
import { POST as gatedRefresh } from "../src/app/api/person/v1/auth/refresh/route";
import { POST as gatedOtp } from "../src/app/api/person/v1/auth/verify-otp/route";

const origin = "https://eject.test";
const verifier = "v".repeat(43);
const state = "s".repeat(43);
const challengeCookie = `__Host-eject-pkce-verifier=${verifier}; __Host-eject-pkce-state=${state}`;
const tokens = {
  accessToken: "header.payload.signature",
  refreshToken: "refresh-token-value-1234",
  expiresInSeconds: 3600,
};

afterEach(() => {
  delete process.env.EJECT_PERSON_AUTH_ENABLED;
});

describe("person auth HTTP", () => {
  it("starts an existing-user magic-link flow with host-only PKCE cookies", async () => {
    const dependencies = dependenciesStub();
    const response = await handleBeginPersonAuth(
      post("/api/person/v1/auth/magic-link", { email: "person@example.com" }),
      dependencies,
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringContaining(
        `__Host-eject-pkce-verifier=${verifier}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
      ),
      expect.stringContaining(
        `__Host-eject-pkce-state=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
      ),
    ]);
    expect(dependencies.lifecycle.begin).toHaveBeenCalledWith(
      "person@example.com",
      expect.any(Function),
    );
    const redirect = vi
      .mocked(dependencies.lifecycle.begin)
      .mock.calls[0]?.[1](state);
    expect(redirect).toBe(
      `${origin}/api/person/v1/auth/callback?state=${state}`,
    );
  });

  it("keeps the challenge when email delivery is uncertain but returns a bounded failure", async () => {
    const dependencies = dependenciesStub();
    vi.mocked(dependencies.lifecycle.begin).mockResolvedValue({
      outcome: "UNAVAILABLE",
      challenge: { verifier, challenge: "c".repeat(43), state },
    });
    const response = await handleBeginPersonAuth(
      post("/api/person/v1/auth/magic-link", { email: "person@example.com" }),
      dependencies,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it("rejects cross-origin, unknown-field, query, and malformed email requests", async () => {
    const dependencies = dependenciesStub();
    const cases = [
      post(
        "/api/person/v1/auth/magic-link",
        { email: "person@example.com" },
        "https://evil.test",
      ),
      post("/api/person/v1/auth/magic-link", {
        email: "person@example.com",
        person_id: "person",
      }),
      post("/api/person/v1/auth/magic-link?next=/admin", {
        email: "person@example.com",
      }),
      post("/api/person/v1/auth/magic-link", { email: "not-an-email" }),
      new Request(`${origin}/api/person/v1/auth/magic-link`, {
        method: "POST",
        headers: {
          "content-type": "application/json-evil",
          origin,
        },
        body: JSON.stringify({ email: "person@example.com" }),
      }),
    ];
    for (const request of cases) {
      expect(
        (await handleBeginPersonAuth(request, dependencies)).status,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(dependencies.lifecycle.begin).not.toHaveBeenCalled();
  });

  it("exchanges an exact callback once, rotates session cookies, and redirects only to root", async () => {
    const dependencies = dependenciesStub();
    const response = await handlePersonAuthCallback(
      new Request(
        `${origin}/api/person/v1/auth/callback?state=${state}&code=${"a".repeat(32)}`,
        { headers: { cookie: challengeCookie } },
      ),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("__Host-eject-pkce-verifier=;"),
        expect.stringContaining("__Host-eject-pkce-state=;"),
        expect.stringContaining(
          `__Host-eject-access=${tokens.accessToken}; Path=/; Secure; HttpOnly; SameSite=Strict`,
        ),
        expect.stringContaining(
          `__Host-eject-refresh=${tokens.refreshToken}; Path=/; Secure; HttpOnly; SameSite=Strict`,
        ),
      ]),
    );
    expect(dependencies.lifecycle.exchangeCode).toHaveBeenCalledWith(
      "a".repeat(32),
      verifier,
    );
  });

  it("rejects missing, mismatched, duplicate, and open-redirect callback inputs", async () => {
    const dependencies = dependenciesStub();
    const cases = [
      `${origin}/api/person/v1/auth/callback?state=${"x".repeat(43)}&code=${"a".repeat(32)}`,
      `${origin}/api/person/v1/auth/callback?state=${state}&code=${"a".repeat(32)}&next=https://evil.test`,
      `${origin}/api/person/v1/auth/callback?state=${state}&state=${state}&code=${"a".repeat(32)}`,
    ];
    for (const url of cases) {
      const response = await handlePersonAuthCallback(
        new Request(url, { headers: { cookie: challengeCookie } }),
        dependencies,
      );
      expect(response.status).toBe(400);
      expect(response.headers.getSetCookie()).toHaveLength(2);
    }
    expect(dependencies.lifecycle.exchangeCode).not.toHaveBeenCalled();
  });

  it("verifies email OTP only in the initiating browser and installs the session", async () => {
    const dependencies = dependenciesStub();
    const request = post("/api/person/v1/auth/verify-otp", {
      email: "person@example.com",
      token: "123456",
    });
    request.headers.set("cookie", challengeCookie);
    const response = await handleVerifyPersonOtp(request, dependencies);
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toHaveLength(4);
    expect(dependencies.lifecycle.verifyEmailOtp).toHaveBeenCalledWith(
      "person@example.com",
      "123456",
    );
  });

  it("rotates refresh cookies and clears rejected sessions", async () => {
    const dependencies = dependenciesStub();
    const refreshRequest = () => {
      const request = post("/api/person/v1/auth/refresh", {});
      request.headers.set(
        "cookie",
        `__Host-eject-refresh=${tokens.refreshToken}`,
      );
      return request;
    };
    expect(
      (await handleRefreshPersonSession(refreshRequest(), dependencies)).status,
    ).toBe(204);

    vi.mocked(dependencies.lifecycle.refresh).mockResolvedValueOnce({
      outcome: "REJECTED",
    });
    const rejected = await handleRefreshPersonSession(
      refreshRequest(),
      dependencies,
    );
    expect(rejected.status).toBe(401);
    expect(rejected.headers.getSetCookie()).toHaveLength(2);
  });

  it("performs local logout and clears session and pending challenge cookies", async () => {
    const dependencies = dependenciesStub();
    const request = post("/api/person/v1/auth/logout", {});
    request.headers.set(
      "cookie",
      `__Host-eject-access=${tokens.accessToken}; ${challengeCookie}`,
    );
    const response = await handleLogoutPersonSession(request, dependencies);
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toHaveLength(4);
    expect(dependencies.lifecycle.signOut).toHaveBeenCalledWith(
      tokens.accessToken,
    );
  });

  it("keeps all auth routes default-disabled before dependency initialization", async () => {
    const responses = await Promise.all([
      gatedBegin(
        post("/api/person/v1/auth/magic-link", {
          email: "person@example.com",
        }),
      ),
      gatedCallback(
        new Request(
          `${origin}/api/person/v1/auth/callback?state=${state}&code=${"a".repeat(32)}`,
        ),
      ),
      gatedOtp(
        post("/api/person/v1/auth/verify-otp", {
          email: "person@example.com",
          token: "123456",
        }),
      ),
      gatedRefresh(post("/api/person/v1/auth/refresh", {})),
      gatedLogout(post("/api/person/v1/auth/logout", {})),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "PERSON_AUTH_DISABLED" });
    }
  });
});

function dependenciesStub(): PersonAuthHttpDependencies {
  return {
    expectedOrigin: origin,
    lifecycle: {
      begin: vi.fn().mockResolvedValue({
        outcome: "ACCEPTED",
        challenge: { verifier, challenge: "c".repeat(43), state },
      }),
      exchangeCode: vi.fn().mockResolvedValue({
        outcome: "AUTHENTICATED",
        tokens,
      }),
      verifyEmailOtp: vi.fn().mockResolvedValue({
        outcome: "AUTHENTICATED",
        tokens,
      }),
      refresh: vi.fn().mockResolvedValue({ outcome: "AUTHENTICATED", tokens }),
      signOut: vi.fn().mockResolvedValue("SIGNED_OUT"),
    } as unknown as PersonSessionLifecycle,
  };
}

function post(path: string, body: unknown, requestOrigin = origin): Request {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: requestOrigin,
    },
    body: JSON.stringify(body),
  });
}
