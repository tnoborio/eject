import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as personEnrollmentRoute } from "../src/app/api/person/v1/device-enrollments/route";
import { POST as agentEnrollmentRoute } from "../src/app/api/agent/v1/enroll/route";
import {
  handleAgentEnrollment,
  type AgentEnrollmentHttpDependencies,
} from "../src/modules/devices/transport/agent-enrollment-http-handler";
import {
  handleCreateDeviceEnrollment,
  handleListDevices,
  handleRevokeDevice,
  type PersonDeviceHttpDependencies,
} from "../src/modules/devices/transport/person-device-http-handlers";
import { parseExpectedOrigin } from "../src/modules/identity/transport/person-http-auth";

const origin = "https://eject.test";
const personId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const keyId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-07-22T00:00:00.000Z");
const token = "header.payload.signature";
const originalEnrollmentGate = process.env.EJECT_DEVICE_ENROLLMENT_ENABLED;

afterEach(() => {
  if (originalEnrollmentGate === undefined) {
    delete process.env.EJECT_DEVICE_ENROLLMENT_ENABLED;
  } else {
    process.env.EJECT_DEVICE_ENROLLMENT_ENABLED = originalEnrollmentGate;
  }
});

describe("person device HTTP handlers", () => {
  it("creates an enrollment from verified cookie identity with exact Origin", async () => {
    const dependencies = personDependencies();
    const response = await handleCreateDeviceEnrollment(
      personRequest("/api/person/v1/device-enrollments", {}),
      dependencies,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      enrollment_secret: "A".repeat(43),
      expires_at: new Date(now.getTime() + 600_000).toISOString(),
    });
    expect(dependencies.authenticate).toHaveBeenCalledWith(token);
    expect(dependencies.createEnrollment).toHaveBeenCalledWith(personId, now);
  });

  it("rejects cross-origin, body identity, missing session, and policy conflicts", async () => {
    const dependencies = personDependencies();
    const crossOrigin = personRequest("/api/person/v1/device-enrollments", {});
    crossOrigin.headers.set("origin", "https://attacker.test");
    await expect(
      handleCreateDeviceEnrollment(crossOrigin, dependencies),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      handleCreateDeviceEnrollment(
        personRequest("/api/person/v1/device-enrollments", {
          person_id: personId,
        }),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 400 });

    const missing = personRequest("/api/person/v1/device-enrollments", {});
    missing.headers.delete("cookie");
    await expect(
      handleCreateDeviceEnrollment(missing, dependencies),
    ).resolves.toMatchObject({ status: 401 });

    dependencies.createEnrollment = vi.fn(async () => ({
      outcome: "REJECTED" as const,
      reason: "DEVICE_ALREADY_REGISTERED" as const,
    }));
    await expect(
      handleCreateDeviceEnrollment(
        personRequest("/api/person/v1/device-enrollments", {}),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 409 });
  });

  it("revokes idempotently through a closed device-id body", async () => {
    const dependencies = personDependencies();
    const response = await handleRevokeDevice(
      personRequest("/api/person/v1/device-revocations", {
        device_id: deviceId,
      }),
      dependencies,
    );
    expect(response.status).toBe(204);
    expect(dependencies.revokeDevice).toHaveBeenCalledWith(
      personId,
      deviceId,
      now,
    );

    await expect(
      handleRevokeDevice(
        personRequest("/api/person/v1/device-revocations", {
          device_id: deviceId,
          owner_id: personId,
        }),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("lists only devices owned by the authenticated person", async () => {
    const dependencies = personDependencies();
    const response = await handleListDevices(
      new Request(`${origin}/api/person/v1/device-enrollments`, {
        headers: { cookie: `__Host-eject-access=${token}` },
      }),
      dependencies,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      devices: [
        {
          device_id: deviceId,
          enrollment_state: "READY",
          availability: "OFFLINE",
          has_approved_drive: true,
          platform: "WINDOWS",
          agent_version: "0.1.0",
          created_at: now.toISOString(),
        },
      ],
    });
    expect(dependencies.listDevices).toHaveBeenCalledWith(personId);

    await expect(
      handleListDevices(
        new Request(`${origin}/api/person/v1/device-enrollments?owner=other`, {
          headers: { cookie: `__Host-eject-access=${token}` },
        }),
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("keeps deployed enrollment routes disabled by default", async () => {
    process.env.EJECT_DEVICE_ENROLLMENT_ENABLED = "false";
    const response = await personEnrollmentRoute(
      personRequest("/api/person/v1/device-enrollments", {}),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "ENROLLMENT_DISABLED",
    });
    const agentResponse = await agentEnrollmentRoute(agentRequest());
    expect(agentResponse.status).toBe(404);
    await expect(agentResponse.json()).resolves.toEqual({
      error: "ENROLLMENT_DISABLED",
    });
  });

  it("requires a canonical HTTPS public origin", () => {
    expect(parseExpectedOrigin(origin)).toBe(origin);
    for (const value of [
      "not a url",
      "http://eject.test",
      "https://user@eject.test",
      "https://eject.test/path",
      "https://eject.test/",
    ]) {
      expect(() => parseExpectedOrigin(value)).toThrow("EJECT_PUBLIC_ORIGIN");
    }
  });
});

describe("agent enrollment HTTP handler", () => {
  it("accepts only the fixed Windows P-256 enrollment shape", async () => {
    const consumeEnrollment = vi.fn<
      AgentEnrollmentHttpDependencies["consumeEnrollment"]
    >(async () => ({ outcome: "ENROLLED" }));
    const response = await handleAgentEnrollment(agentRequest(), {
      consumeEnrollment,
      now: () => now,
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      device_id: deviceId,
      key_id: keyId,
      enrollment_state: "SETUP_IN_PROGRESS",
    });
    expect(consumeEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentSecret: "A".repeat(43),
        deviceId,
        keyId,
        platform: "WINDOWS",
        agentVersion: "0.1.0",
        now,
      }),
    );
  });

  it("rejects unknown fields, query parameters, malformed keys, and bounded outcomes", async () => {
    const consumeEnrollment = vi.fn<
      AgentEnrollmentHttpDependencies["consumeEnrollment"]
    >(async () => ({ outcome: "ENROLLED" }));
    const dependencies = { consumeEnrollment, now: () => now };
    await expect(
      handleAgentEnrollment(agentRequest({ extra: "field" }), dependencies),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      handleAgentEnrollment(agentRequest({ platform: "MACOS" }), dependencies),
    ).resolves.toMatchObject({ status: 400 });
    const queried = agentRequest();
    const queriedRequest = new Request(`${queried.url}?secret=no`, queried);
    await expect(
      handleAgentEnrollment(queriedRequest, dependencies),
    ).resolves.toMatchObject({ status: 400 });

    consumeEnrollment.mockResolvedValueOnce({
      outcome: "REJECTED",
      reason: "ENROLLMENT_FAILED",
    });
    await expect(
      handleAgentEnrollment(agentRequest(), dependencies),
    ).resolves.toMatchObject({ status: 401 });
  });
});

function personDependencies(): PersonDeviceHttpDependencies & {
  authenticate: ReturnType<typeof vi.fn>;
  createEnrollment: ReturnType<typeof vi.fn>;
  listDevices: ReturnType<typeof vi.fn>;
  revokeDevice: ReturnType<typeof vi.fn>;
} {
  return {
    expectedOrigin: origin,
    authenticate: vi.fn(async () => ({
      authenticated: true as const,
      context: { personId },
    })),
    createEnrollment: vi.fn(async () => ({
      outcome: "CREATED" as const,
      enrollmentSecret: "A".repeat(43),
      expiresAt: new Date(now.getTime() + 600_000),
    })),
    listDevices: vi.fn(async () => [
      {
        deviceId,
        enrollmentState: "READY" as const,
        availability: "OFFLINE" as const,
        hasApprovedDrive: true,
        platform: "WINDOWS" as const,
        agentVersion: "0.1.0",
        createdAt: now,
      },
    ]),
    revokeDevice: vi.fn(async () => {}),
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

function agentRequest(
  overrides: Readonly<Record<string, unknown>> = {},
): Request {
  const publicKey = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  }).publicKey.export({ format: "der", type: "spki" });
  return new Request(`${origin}/api/agent/v1/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enrollment_secret: "A".repeat(43),
      device_id: deviceId,
      key_id: keyId,
      public_key_spki: publicKey.toString("base64url"),
      platform: "WINDOWS",
      agent_version: "0.1.0",
      ...overrides,
    }),
  });
}
