export interface EnrollmentSecret {
  readonly value: string;
  readonly digest: Uint8Array;
}

export interface DeviceEnrollmentCrypto {
  generateSecret(): EnrollmentSecret;
  digestSecret(value: string): Uint8Array;
  isP256SubjectPublicKeyInfo(value: Uint8Array): boolean;
}

export interface DeviceEnrollmentStore {
  listDevices(ownerId: string): Promise<readonly RegisteredDeviceSummary[]>;

  createEnrollment(input: {
    readonly enrollmentId: string;
    readonly ownerId: string;
    readonly secretDigest: Uint8Array;
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<"CREATED" | "ACCOUNT_UNAVAILABLE" | "DEVICE_ALREADY_REGISTERED">;

  consumeEnrollment(input: {
    readonly secretDigest: Uint8Array;
    readonly deviceId: string;
    readonly keyId: string;
    readonly publicKeySpki: Uint8Array;
    readonly platform: "WINDOWS";
    readonly agentVersion: string;
    readonly now: Date;
  }): Promise<
    | "ENROLLED"
    | "ENROLLMENT_FAILED"
    | "DEVICE_ALREADY_REGISTERED"
    | "IDENTIFIER_CONFLICT"
  >;

  revokeDevice(input: {
    readonly ownerId: string;
    readonly deviceId: string;
    readonly now: Date;
  }): Promise<void>;
}

export interface RegisteredDeviceSummary {
  readonly deviceId: string;
  readonly enrollmentState: "SETUP_IN_PROGRESS" | "READY" | "REVOKED";
  readonly availability: "AVAILABLE" | "PAUSED" | "OFFLINE";
  readonly hasApprovedDrive: boolean;
  readonly platform: "WINDOWS";
  readonly agentVersion: string;
  readonly createdAt: Date;
}

export function createListOwnedDevices(dependencies: {
  readonly store: DeviceEnrollmentStore;
}) {
  return async function list(
    ownerId: string,
  ): Promise<readonly RegisteredDeviceSummary[]> {
    return dependencies.store.listDevices(ownerId);
  };
}

export type CreateDeviceEnrollmentResult =
  | {
      readonly outcome: "CREATED";
      readonly enrollmentSecret: string;
      readonly expiresAt: Date;
    }
  | {
      readonly outcome: "REJECTED";
      readonly reason: "ACCOUNT_UNAVAILABLE" | "DEVICE_ALREADY_REGISTERED";
    };

export function createDeviceEnrollment(dependencies: {
  readonly store: DeviceEnrollmentStore;
  readonly crypto: DeviceEnrollmentCrypto;
  readonly newId: () => string;
}) {
  return async function createForOwner(
    ownerId: string,
    now: Date,
  ): Promise<CreateDeviceEnrollmentResult> {
    const secret = dependencies.crypto.generateSecret();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const outcome = await dependencies.store.createEnrollment({
      enrollmentId: dependencies.newId(),
      ownerId,
      secretDigest: secret.digest,
      now,
      expiresAt,
    });
    return outcome === "CREATED"
      ? {
          outcome: "CREATED",
          enrollmentSecret: secret.value,
          expiresAt,
        }
      : { outcome: "REJECTED", reason: outcome };
  };
}

export type ConsumeDeviceEnrollmentResult =
  | { readonly outcome: "ENROLLED" }
  | {
      readonly outcome: "REJECTED";
      readonly reason:
        | "ENROLLMENT_FAILED"
        | "DEVICE_ALREADY_REGISTERED"
        | "IDENTIFIER_CONFLICT"
        | "INVALID_PUBLIC_KEY";
    };

export function createConsumeDeviceEnrollment(dependencies: {
  readonly store: DeviceEnrollmentStore;
  readonly crypto: DeviceEnrollmentCrypto;
}) {
  return async function consume(input: {
    readonly enrollmentSecret: string;
    readonly deviceId: string;
    readonly keyId: string;
    readonly publicKeySpki: Uint8Array;
    readonly platform: "WINDOWS";
    readonly agentVersion: string;
    readonly now: Date;
  }): Promise<ConsumeDeviceEnrollmentResult> {
    if (!dependencies.crypto.isP256SubjectPublicKeyInfo(input.publicKeySpki)) {
      return { outcome: "REJECTED", reason: "INVALID_PUBLIC_KEY" };
    }
    const outcome = await dependencies.store.consumeEnrollment({
      secretDigest: dependencies.crypto.digestSecret(input.enrollmentSecret),
      deviceId: input.deviceId,
      keyId: input.keyId,
      publicKeySpki: input.publicKeySpki,
      platform: input.platform,
      agentVersion: input.agentVersion,
      now: input.now,
    });
    return outcome === "ENROLLED"
      ? { outcome: "ENROLLED" }
      : { outcome: "REJECTED", reason: outcome };
  };
}

export function createRevokeDevice(dependencies: {
  readonly store: DeviceEnrollmentStore;
}) {
  return async function revoke(
    ownerId: string,
    deviceId: string,
    now: Date,
  ): Promise<void> {
    await dependencies.store.revokeDevice({ ownerId, deviceId, now });
  };
}
