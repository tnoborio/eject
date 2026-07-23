import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createConsumeDeviceEnrollment,
  createDeviceEnrollment,
  createListOwnedDevices,
  createRevokeDevice,
  type DeviceEnrollmentStore,
} from "../src/modules/devices/application/device-enrollment";
import { NodeDeviceEnrollmentCrypto } from "../src/modules/devices/infrastructure/node-device-enrollment-crypto";

const ownerId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const keyId = "33333333-3333-4333-8333-333333333333";
const enrollmentId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-07-22T00:00:00.000Z");

describe("device enrollment application", () => {
  it("creates one ten-minute enrollment while persisting only its digest", async () => {
    const store = fakeStore();
    const digest = new Uint8Array(32).fill(7);
    const create = createDeviceEnrollment({
      store,
      crypto: {
        generateSecret: () => ({ value: "secret-once", digest }),
        digestSecret: vi.fn(),
        isP256SubjectPublicKeyInfo: vi.fn(),
      },
      newId: () => enrollmentId,
    });

    await expect(create(ownerId, now)).resolves.toEqual({
      outcome: "CREATED",
      enrollmentSecret: "secret-once",
      expiresAt: new Date(now.getTime() + 600_000),
    });
    expect(store.createEnrollment).toHaveBeenCalledWith({
      enrollmentId,
      ownerId,
      secretDigest: digest,
      now,
      expiresAt: new Date(now.getTime() + 600_000),
    });
    expect(JSON.stringify(store.createEnrollment.mock.calls)).not.toContain(
      "secret-once",
    );
  });

  it("does not disclose a generated secret when account or device policy rejects", async () => {
    for (const reason of [
      "ACCOUNT_UNAVAILABLE",
      "DEVICE_ALREADY_REGISTERED",
    ] as const) {
      const store = fakeStore();
      store.createEnrollment.mockResolvedValueOnce(reason);
      const create = createDeviceEnrollment({
        store,
        crypto: {
          generateSecret: () => ({
            value: "never-returned",
            digest: new Uint8Array(32),
          }),
          digestSecret: vi.fn(),
          isP256SubjectPublicKeyInfo: vi.fn(),
        },
        newId: () => enrollmentId,
      });
      await expect(create(ownerId, now)).resolves.toEqual({
        outcome: "REJECTED",
        reason,
      });
    }
  });

  it("validates P-256 before consuming a secret and maps bounded outcomes", async () => {
    const store = fakeStore();
    const crypto = {
      generateSecret: vi.fn(),
      digestSecret: vi.fn(() => new Uint8Array(32).fill(9)),
      isP256SubjectPublicKeyInfo: vi.fn(() => false),
    };
    const consume = createConsumeDeviceEnrollment({ store, crypto });
    const input = {
      enrollmentSecret: "secret",
      deviceId,
      keyId,
      publicKeySpki: new Uint8Array([1]),
      platform: "WINDOWS" as const,
      agentVersion: "0.1.0",
      now,
    };
    await expect(consume(input)).resolves.toEqual({
      outcome: "REJECTED",
      reason: "INVALID_PUBLIC_KEY",
    });
    expect(crypto.digestSecret).not.toHaveBeenCalled();
    expect(store.consumeEnrollment).not.toHaveBeenCalled();

    crypto.isP256SubjectPublicKeyInfo.mockReturnValue(true);
    await expect(consume(input)).resolves.toEqual({ outcome: "ENROLLED" });
    expect(store.consumeEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId,
        keyId,
        agentVersion: "0.1.0",
        secretDigest: new Uint8Array(32).fill(9),
      }),
    );

    store.consumeEnrollment.mockResolvedValueOnce("IDENTIFIER_CONFLICT");
    await expect(consume(input)).resolves.toEqual({
      outcome: "REJECTED",
      reason: "IDENTIFIER_CONFLICT",
    });
  });

  it("revokes only through the owner-bound store port", async () => {
    const store = fakeStore();
    const revoke = createRevokeDevice({ store });
    await revoke(ownerId, deviceId, now);
    expect(store.revokeDevice).toHaveBeenCalledWith({ ownerId, deviceId, now });
  });

  it("lists devices only through the owner-bound store port", async () => {
    const store = fakeStore();
    const devices = [
      {
        deviceId,
        enrollmentState: "READY" as const,
        availability: "OFFLINE" as const,
        hasApprovedDrive: true,
        platform: "WINDOWS" as const,
        agentVersion: "0.1.0",
        createdAt: now,
      },
    ];
    store.listDevices.mockResolvedValueOnce(devices);
    const list = createListOwnedDevices({ store });
    await expect(list(ownerId)).resolves.toEqual(devices);
    expect(store.listDevices).toHaveBeenCalledWith(ownerId);
  });
});

describe("NodeDeviceEnrollmentCrypto", () => {
  it("generates 32 random bytes, stores their SHA-256, and accepts only canonical P-256 SPKI", () => {
    const crypto = new NodeDeviceEnrollmentCrypto();
    const secret = crypto.generateSecret();
    const decoded = Buffer.from(secret.value, "base64url");
    expect(secret.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(decoded).toHaveLength(32);
    expect(secret.digest).toEqual(
      createHash("sha256").update(decoded).digest(),
    );
    expect(crypto.digestSecret(secret.value)).toEqual(secret.digest);

    const p256 = publicSpki(
      generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey,
    );
    const p384 = publicSpki(
      generateKeyPairSync("ec", { namedCurve: "P-384" }).publicKey,
    );
    const rsa = publicSpki(
      generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey,
    );
    expect(crypto.isP256SubjectPublicKeyInfo(p256)).toBe(true);
    expect(crypto.isP256SubjectPublicKeyInfo(p384)).toBe(false);
    expect(crypto.isP256SubjectPublicKeyInfo(rsa)).toBe(false);
    expect(crypto.isP256SubjectPublicKeyInfo(new Uint8Array([1, 2, 3]))).toBe(
      false,
    );
  });
});

function publicSpki(key: KeyObject): Uint8Array {
  return key.export({ format: "der", type: "spki" });
}

function fakeStore() {
  return {
    listDevices: vi.fn<DeviceEnrollmentStore["listDevices"]>(async () => []),
    createEnrollment: vi.fn<DeviceEnrollmentStore["createEnrollment"]>(
      async () => "CREATED",
    ),
    consumeEnrollment: vi.fn<DeviceEnrollmentStore["consumeEnrollment"]>(
      async () => "ENROLLED",
    ),
    revokeDevice: vi.fn<DeviceEnrollmentStore["revokeDevice"]>(async () => {}),
  };
}
