import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createPostgresDatabase } from "../../src/infrastructure/postgres/database";
import { migrate } from "../../src/infrastructure/postgres/migrate";
import { PostgresDeviceEnrollmentStore } from "../../src/modules/devices/infrastructure/postgres-device-enrollment-store";

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL tests");
}

const pool = new Pool({ connectionString, max: 8 });
const database = createPostgresDatabase(pool);
const store = new PostgresDeviceEnrollmentStore(database, randomUUID);
const ownerId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const keyId = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const commandId = "66666666-6666-4666-8666-666666666666";
const now = new Date("2026-07-22T00:00:00.000Z");
const publicSpki = generateKeyPairSync("ec", {
  namedCurve: "P-256",
}).publicKey.export({ format: "der", type: "spki" });

beforeAll(async () => {
  const current = await pool.query<{ current_database: string }>(
    "SELECT current_database()",
  );
  if (current.rows[0]?.current_database !== "eject_test") {
    throw new Error(
      "PostgreSQL tests refuse to reset a database not named eject_test",
    );
  }
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrate(pool, resolve(process.cwd(), "migrations"));
});

beforeEach(async () => {
  await pool.query("TRUNCATE people, system_delivery_policy CASCADE");
  await pool.query(
    "INSERT INTO system_delivery_policy (singleton) VALUES (true)",
  );
  await pool.query(
    "INSERT INTO people (person_id, display_name) VALUES ($1, 'Owner')",
    [ownerId],
  );
});

afterAll(async () => {
  await database.destroy();
});

describe("PostgresDeviceEnrollmentStore", () => {
  it("stores only a digest and atomically binds one Windows P-256 device", async () => {
    const digest = secretDigest("one");
    await expect(createSession(digest)).resolves.toBe("CREATED");
    await expect(consume(digest)).resolves.toBe("ENROLLED");
    await expect(consume(digest)).resolves.toBe("ENROLLMENT_FAILED");

    const state = await pool.query<{
      used: boolean;
      digest_length: number;
      enrollment_state: string;
      platform: string;
      agent_version: string;
      algorithm: string;
      key_length: number;
    }>(`
      SELECT session.used_at IS NOT NULL AS used,
        octet_length(session.enrollment_digest)::int AS digest_length,
        device.enrollment_state, device.platform, device.agent_version,
        key.algorithm, octet_length(key.public_key_spki)::int AS key_length
      FROM device_enrollment_sessions session
      JOIN registered_devices device ON device.owner_id = session.owner_id
      JOIN device_keys key ON key.device_id = device.device_id
    `);
    expect(state.rows).toEqual([
      {
        used: true,
        digest_length: 32,
        enrollment_state: "SETUP_IN_PROGRESS",
        platform: "WINDOWS",
        agent_version: "0.1.0",
        algorithm: "ECDSA_P256_SHA256_P1363",
        key_length: publicSpki.byteLength,
      },
    ]);
    await expect(store.listDevices(ownerId)).resolves.toEqual([
      {
        deviceId,
        enrollmentState: "SETUP_IN_PROGRESS",
        availability: "OFFLINE",
        hasApprovedDrive: false,
        platform: "WINDOWS",
        agentVersion: "0.1.0",
        createdAt: now,
      },
    ]);
    await expect(store.listDevices(actorId)).resolves.toEqual([]);
  });

  it("allows exactly one winner when the same one-use secret races", async () => {
    const digest = secretDigest("race");
    await createSession(digest);
    const outcomes = await Promise.all([
      consume(digest),
      store.consumeEnrollment({
        ...consumeInput(digest),
        deviceId: "77777777-7777-4777-8777-777777777777",
        keyId: "88888888-8888-4888-8888-888888888888",
      }),
    ]);
    expect(outcomes.sort()).toEqual(["ENROLLED", "ENROLLMENT_FAILED"]);
    const counts = await pool.query<{ devices: number; keys: number }>(`
      SELECT (SELECT count(*)::int FROM registered_devices) AS devices,
        (SELECT count(*)::int FROM device_keys) AS keys
    `);
    expect(counts.rows[0]).toEqual({ devices: 1, keys: 1 });
  });

  it("rechecks expiry, account status, and the one-active-device constraint", async () => {
    const expired = secretDigest("expired");
    await store.createEnrollment({
      enrollmentId: randomUUID(),
      ownerId,
      secretDigest: expired,
      now: new Date(now.getTime() - 700_000),
      expiresAt: new Date(now.getTime() - 100_000),
    });
    await expect(consume(expired)).resolves.toBe("ENROLLMENT_FAILED");

    const active = secretDigest("active");
    await createSession(active);
    await consume(active);
    await expect(createSession(secretDigest("second"))).resolves.toBe(
      "DEVICE_ALREADY_REGISTERED",
    );

    await pool.query("UPDATE people SET account_status = 'RESTRICTED'");
    await expect(createSession(secretDigest("restricted"))).resolves.toBe(
      "ACCOUNT_UNAVAILABLE",
    );
  });

  it("revokes keys, pending enrollment, and undelivered commands atomically", async () => {
    await seedReadyDeviceAndCommand();
    const pending = secretDigest("pending");
    await pool.query(
      `INSERT INTO device_enrollment_sessions (
         enrollment_id, owner_id, enrollment_digest, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        ownerId,
        Buffer.from(pending),
        new Date(now.getTime() + 600_000),
        now,
      ],
    );

    await store.revokeDevice({ ownerId, deviceId, now });
    await store.revokeDevice({ ownerId, deviceId, now });

    const state = await pool.query<{
      device_state: string;
      availability: string;
      key_revoked: boolean;
      enrollment_used: boolean;
      command_status: string;
      cancellation_reason: string;
      cancelled_events: number;
    }>(`
      SELECT
        (SELECT enrollment_state FROM registered_devices WHERE device_id = '${deviceId}') AS device_state,
        (SELECT availability FROM registered_devices WHERE device_id = '${deviceId}') AS availability,
        (SELECT revoked_at IS NOT NULL FROM device_keys WHERE key_id = '${keyId}') AS key_revoked,
        (SELECT used_at IS NOT NULL FROM device_enrollment_sessions WHERE enrollment_digest = decode('${Buffer.from(pending).toString("hex")}', 'hex')) AS enrollment_used,
        (SELECT status FROM eject_commands WHERE command_id = '${commandId}') AS command_status,
        (SELECT cancellation_reason FROM eject_commands WHERE command_id = '${commandId}') AS cancellation_reason,
        (SELECT count(*)::int FROM eject_lifecycle_events WHERE command_id = '${commandId}' AND state = 'CANCELLED') AS cancelled_events
    `);
    expect(state.rows[0]).toEqual({
      device_state: "REVOKED",
      availability: "OFFLINE",
      key_revoked: true,
      enrollment_used: true,
      command_status: "CANCELLED",
      cancellation_reason: "DEVICE_REVOKED",
      cancelled_events: 1,
    });

    const replacement = secretDigest("replacement");
    await expect(createSession(replacement)).resolves.toBe("CREATED");
    await expect(
      store.consumeEnrollment({
        ...consumeInput(replacement),
        deviceId: "77777777-7777-4777-8777-777777777777",
        keyId: "88888888-8888-4888-8888-888888888888",
      }),
    ).resolves.toBe("ENROLLED");
    const devices = await pool.query<{ total: number; active: number }>(`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE enrollment_state <> 'REVOKED')::int AS active
      FROM registered_devices WHERE owner_id = '${ownerId}'
    `);
    expect(devices.rows[0]).toEqual({ total: 2, active: 1 });
  });

  it("does not reveal or revoke a device owned by someone else", async () => {
    await seedReadyDeviceAndCommand();
    await store.revokeDevice({
      ownerId: "99999999-9999-4999-8999-999999999999",
      deviceId,
      now,
    });
    const device = await pool.query<{ enrollment_state: string }>(
      "SELECT enrollment_state FROM registered_devices WHERE device_id = $1",
      [deviceId],
    );
    expect(device.rows[0]?.enrollment_state).toBe("READY");
  });
});

function secretDigest(value: string): Uint8Array {
  return createHash("sha256").update(value).digest();
}

function createSession(digest: Uint8Array) {
  return store.createEnrollment({
    enrollmentId: randomUUID(),
    ownerId,
    secretDigest: digest,
    now,
    expiresAt: new Date(now.getTime() + 600_000),
  });
}

function consume(digest: Uint8Array) {
  return store.consumeEnrollment(consumeInput(digest));
}

function consumeInput(digest: Uint8Array) {
  return {
    secretDigest: digest,
    deviceId,
    keyId,
    publicKeySpki: new Uint8Array(publicSpki),
    platform: "WINDOWS" as const,
    agentVersion: "0.1.0",
    now,
  };
}

async function seedReadyDeviceAndCommand(): Promise<void> {
  await pool.query(
    "INSERT INTO people (person_id, display_name) VALUES ($1, 'Actor')",
    [actorId],
  );
  await pool.query(
    `INSERT INTO registered_devices (
       device_id, owner_id, enrollment_state, availability, has_approved_drive,
       platform, agent_version, created_at
     ) VALUES ($1, $2, 'READY', 'AVAILABLE', true, 'WINDOWS', '0.1.0', $3)`,
    [deviceId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO device_keys (
       key_id, device_id, algorithm, public_key_spki, created_at
     ) VALUES ($1, $2, 'ECDSA_P256_SHA256_P1363', $3, $4)`,
    [keyId, deviceId, Buffer.from(publicSpki), now],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO eject_requests (
         request_id, actor_id, recipient_id, idempotency_key,
         request_fingerprint, action, outcome, command_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'EJECT', 'QUEUED', $6, $7)`,
      [
        requestId,
        actorId,
        ownerId,
        randomUUID(),
        "a".repeat(64),
        commandId,
        now,
      ],
    );
    await client.query(
      `INSERT INTO eject_commands (
         command_id, request_id, actor_id, recipient_id, device_id,
         issued_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        commandId,
        requestId,
        actorId,
        ownerId,
        deviceId,
        now,
        new Date(now.getTime() + 30_000),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
