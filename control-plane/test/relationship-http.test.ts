import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as invitationRoute } from "../src/app/api/person/v1/relationship-invitations/route";
import { POST as relationshipRoute } from "../src/app/api/person/v1/relationships/route";
import {
  handleAcceptRelationshipInvitation,
  handleCreateRelationshipInvitation,
  type PersonRelationshipHttpDependencies,
} from "../src/modules/permissions/transport/person-relationship-http-handlers";

const origin = "https://eject.test";
const personId = "11111111-1111-4111-8111-111111111111";
const token = "header.payload.signature";
const invitationCode = "A".repeat(43);
const now = new Date("2026-07-24T00:00:00.000Z");
const originalAuthGate = process.env.EJECT_PERSON_AUTH_ENABLED;

afterEach(() => {
  if (originalAuthGate === undefined) {
    delete process.env.EJECT_PERSON_AUTH_ENABLED;
  } else {
    process.env.EJECT_PERSON_AUTH_ENABLED = originalAuthGate;
  }
});

describe("person relationship HTTP handlers", () => {
  it("creates an owner-bound one-use invitation from an empty body", async () => {
    const dependencies = relationshipDependencies();
    const response = await handleCreateRelationshipInvitation(
      personRequest("/api/person/v1/relationship-invitations", {}),
      dependencies,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      invitation_code: invitationCode,
      expires_at: new Date(now.getTime() + 600_000).toISOString(),
    });
    expect(dependencies.createInvitation).toHaveBeenCalledWith(personId, now);

    await expect(
      handleCreateRelationshipInvitation(
        personRequest("/api/person/v1/relationship-invitations", {
          person_id: personId,
        }),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("accepts only one closed 43-character code field", async () => {
    const dependencies = relationshipDependencies();
    const response = await handleAcceptRelationshipInvitation(
      personRequest("/api/person/v1/relationships", {
        invitation_code: invitationCode,
      }),
      dependencies,
    );
    expect(response.status).toBe(204);
    expect(dependencies.acceptInvitation).toHaveBeenCalledWith(
      personId,
      invitationCode,
      now,
    );

    for (const body of [
      { invitation_code: "short" },
      { invitation_code: invitationCode, inviter_id: personId },
      { invitation_code: `${"A".repeat(42)}+` },
    ]) {
      await expect(
        handleAcceptRelationshipInvitation(
          personRequest("/api/person/v1/relationships", body),
          dependencies,
        ),
      ).resolves.toMatchObject({ status: 400 });
    }
  });

  it("fails closed for cross-origin, unauthenticated, and unavailable invitations", async () => {
    const dependencies = relationshipDependencies();
    const crossOrigin = personRequest(
      "/api/person/v1/relationship-invitations",
      {},
    );
    crossOrigin.headers.set("origin", "https://attacker.test");
    await expect(
      handleCreateRelationshipInvitation(crossOrigin, dependencies),
    ).resolves.toMatchObject({ status: 403 });

    dependencies.authenticate.mockResolvedValueOnce({
      authenticated: false,
      reason: "AUTHENTICATION_REQUIRED",
    });
    await expect(
      handleAcceptRelationshipInvitation(
        personRequest("/api/person/v1/relationships", {
          invitation_code: invitationCode,
        }),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 401 });

    dependencies.acceptInvitation.mockResolvedValueOnce({
      outcome: "REJECTED",
      reason: "INVITATION_UNAVAILABLE",
    });
    await expect(
      handleAcceptRelationshipInvitation(
        personRequest("/api/person/v1/relationships", {
          invitation_code: invitationCode,
        }),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 404 });
  });

  it("keeps relationship routes disabled before dependency initialization", async () => {
    process.env.EJECT_PERSON_AUTH_ENABLED = "false";
    await expect(
      invitationRoute(
        personRequest("/api/person/v1/relationship-invitations", {}),
      ),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      relationshipRoute(
        personRequest("/api/person/v1/relationships", {
          invitation_code: invitationCode,
        }),
      ),
    ).resolves.toMatchObject({ status: 404 });
  });
});

function relationshipDependencies(): PersonRelationshipHttpDependencies & {
  authenticate: ReturnType<typeof vi.fn>;
  createInvitation: ReturnType<typeof vi.fn>;
  acceptInvitation: ReturnType<typeof vi.fn>;
} {
  return {
    expectedOrigin: origin,
    authenticate: vi.fn(async () => ({
      authenticated: true as const,
      context: { personId },
    })),
    createInvitation: vi.fn(async () => ({
      outcome: "CREATED" as const,
      invitationCode,
      expiresAt: new Date(now.getTime() + 600_000),
    })),
    acceptInvitation: vi.fn(async () => ({
      outcome: "CONNECTED" as const,
    })),
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
