import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GET as consentRouteGet,
  POST as consentRoutePost,
} from "../src/app/api/person/v1/consent/route";
import {
  handleReadConsent,
  handleSetGrant,
  handleSetPaused,
  type PersonConsentHttpDependencies,
} from "../src/modules/permissions/transport/person-consent-http-handlers";

const origin = "https://eject.test";
const recipientId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const token = "header.payload.signature";
const now = new Date("2026-07-23T00:00:00.000Z");
const originalAuthGate = process.env.EJECT_PERSON_AUTH_ENABLED;

afterEach(() => {
  if (originalAuthGate === undefined) {
    delete process.env.EJECT_PERSON_AUTH_ENABLED;
  } else {
    process.env.EJECT_PERSON_AUTH_ENABLED = originalAuthGate;
  }
});

describe("person consent HTTP handlers", () => {
  it("reads only the authenticated recipient's bounded consent view", async () => {
    const dependencies = consentDependencies();
    const response = await handleReadConsent(
      new Request(`${origin}/api/person/v1/consent`, {
        headers: { cookie: `__Host-eject-access=${token}` },
      }),
      dependencies,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      paused: false,
      connected_people: [
        {
          person_id: actorId,
          display_name: "Actor",
          grant_active: false,
          account_available: true,
        },
      ],
    });
    expect(dependencies.readConsent).toHaveBeenCalledWith(recipientId);

    await expect(
      handleReadConsent(
        new Request(`${origin}/api/person/v1/consent?recipient=other`, {
          headers: { cookie: `__Host-eject-access=${token}` },
        }),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("sets pause from a closed body and exact same-origin request", async () => {
    const dependencies = consentDependencies();
    const response = await handleSetPaused(
      personRequest("/api/person/v1/consent", { paused: true }),
      dependencies,
    );
    expect(response.status).toBe(204);
    expect(dependencies.setPaused).toHaveBeenCalledWith(recipientId, true, now);

    await expect(
      handleSetPaused(
        personRequest("/api/person/v1/consent", {
          paused: false,
          recipient_id: recipientId,
        }),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 400 });
    const crossOrigin = personRequest("/api/person/v1/consent", {
      paused: false,
    });
    crossOrigin.headers.set("origin", "https://attacker.test");
    await expect(
      handleSetPaused(crossOrigin, dependencies),
    ).resolves.toMatchObject({ status: 403 });
  });

  it("sets only directional grants for another connected person", async () => {
    const dependencies = consentDependencies();
    const response = await handleSetGrant(
      personRequest("/api/person/v1/consent-grants", {
        person_id: actorId,
        granted: true,
      }),
      dependencies,
    );
    expect(response.status).toBe(204);
    expect(dependencies.setGrant).toHaveBeenCalledWith(
      recipientId,
      actorId,
      true,
      now,
    );

    dependencies.setGrant.mockResolvedValueOnce("CONNECTION_REQUIRED");
    await expect(
      handleSetGrant(
        personRequest("/api/person/v1/consent-grants", {
          person_id: actorId,
          granted: true,
        }),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 409 });

    await expect(
      handleSetGrant(
        personRequest("/api/person/v1/consent-grants", {
          person_id: recipientId,
          granted: true,
        }),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("keeps person consent routes disabled before dependency initialization", async () => {
    process.env.EJECT_PERSON_AUTH_ENABLED = "false";
    await expect(
      consentRouteGet(
        new Request(`${origin}/api/person/v1/consent`, { method: "GET" }),
      ),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      consentRoutePost(
        personRequest("/api/person/v1/consent", { paused: true }),
      ),
    ).resolves.toMatchObject({ status: 404 });
  });
});

function consentDependencies(): PersonConsentHttpDependencies & {
  authenticate: ReturnType<typeof vi.fn>;
  readConsent: ReturnType<typeof vi.fn>;
  setPaused: ReturnType<typeof vi.fn>;
  setGrant: ReturnType<typeof vi.fn>;
} {
  return {
    expectedOrigin: origin,
    authenticate: vi.fn(async () => ({
      authenticated: true as const,
      context: { personId: recipientId },
    })),
    readConsent: vi.fn(async () => ({
      paused: false,
      connectedPeople: [
        {
          personId: actorId,
          displayName: "Actor",
          grantActive: false,
          accountAvailable: true,
        },
      ],
    })),
    setPaused: vi.fn(async () => {}),
    setGrant: vi.fn(async () => "UPDATED" as const),
    now: () => now,
  };
}

function personRequest(
  path: string,
  body: Readonly<Record<string, unknown>>,
): Request {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      cookie: `__Host-eject-access=${token}`,
    },
    body: JSON.stringify(body),
  });
}
