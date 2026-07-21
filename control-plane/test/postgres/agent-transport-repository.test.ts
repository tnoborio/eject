import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createPostgresDatabase } from "../../src/infrastructure/postgres/database";
import { migrate } from "../../src/infrastructure/postgres/migrate";
import {
  createPollAgent,
  type AuthenticatedDeviceContext,
} from "../../src/modules/eject/application/agent-polling";
import { createIngestAgentResult } from "../../src/modules/eject/application/ingest-agent-result";
import { PostgresAgentTransportStore } from "../../src/modules/eject/infrastructure/postgres-agent-transport-store";

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL tests");
}

const pool = new Pool({ connectionString, max: 8 });
const database = createPostgresDatabase(pool);
const store = new PostgresAgentTransportStore(database);
const poll = createPollAgent({ store, newId: randomUUID });
const ingest = createIngestAgentResult({ store, newId: randomUUID });

const actorId = "11111111-1111-4111-8111-111111111111";
const recipientId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const keyId = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const commandId = "66666666-6666-4666-8666-666666666666";
const now = new Date("2026-07-21T00:00:00.000Z");
let publicSpki: Uint8Array;

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
  publicSpki = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  }).publicKey.export({ format: "der", type: "spki" });
});

beforeEach(async () => {
  await pool.query("TRUNCATE people, system_delivery_policy CASCADE");
  await pool.query(
    "INSERT INTO system_delivery_policy (singleton, delivery_enabled, physical_hourly_ceiling) VALUES (true, true, 5)",
  );
  await seedCommand();
});

afterAll(async () => {
  await database.destroy();
});

describe("PostgresAgentTransportStore", () => {
  it("dispatches one command and consumes a request nonce atomically", async () => {
    await expect(store.loadActivePublicKey(deviceId, keyId)).resolves.toEqual(
      publicSpki,
    );
    const context = deviceContext("poll-one");
    await expect(poll(context, now)).resolves.toMatchObject({
      outcome: "COMMAND",
      command: { commandId, deviceId, actorId, actorDisplayName: "Actor" },
    });
    await expect(poll(context, now)).resolves.toEqual({
      outcome: "REJECTED",
      reason: "REPLAYED_REQUEST",
    });

    const state = await pool.query<{
      status: string;
      nonces: number;
      dispatched: number;
    }>(`
      SELECT
        (SELECT status FROM eject_commands WHERE command_id = '${commandId}') AS status,
        (SELECT count(*)::int FROM device_request_nonces) AS nonces,
        (SELECT count(*)::int FROM eject_lifecycle_events WHERE state = 'DISPATCHED') AS dispatched
    `);
    expect(state.rows[0]).toEqual({
      status: "DISPATCHED",
      nonces: 1,
      dispatched: 1,
    });
  });

  it("stores an attempted result idempotently and preserves truthful outcome", async () => {
    await poll(deviceContext("poll-result"), now);
    const result = {
      commandId,
      deviceId,
      recordedAt: new Date(now.getTime() + 1_000),
      disposition: "ATTEMPTED" as const,
      attemptCount: 1 as const,
      result: "COMMAND_ACCEPTED" as const,
      physicalOutcome: "UNKNOWN" as const,
    };
    await expect(
      ingest(
        deviceContext("result-one"),
        result,
        new Date(now.getTime() + 2_000),
      ),
    ).resolves.toEqual({ outcome: "STORED" });
    await expect(
      ingest(
        deviceContext("result-two"),
        result,
        new Date(now.getTime() + 3_000),
      ),
    ).resolves.toEqual({ outcome: "ALREADY_STORED" });
    await expect(
      ingest(
        deviceContext("result-three"),
        { ...result, result: "DRIVE_BUSY" },
        new Date(now.getTime() + 4_000),
      ),
    ).resolves.toEqual({
      outcome: "REJECTED",
      reason: "RESULT_CONFLICT",
    });

    const state = await pool.query<{
      status: string;
      results: number;
      delivered: number;
      attempted: number;
      unknown: number;
    }>(`
      SELECT
        (SELECT status FROM eject_commands WHERE command_id = '${commandId}') AS status,
        (SELECT count(*)::int FROM agent_results) AS results,
        (SELECT count(*)::int FROM eject_lifecycle_events WHERE state = 'DELIVERED') AS delivered,
        (SELECT count(*)::int FROM eject_lifecycle_events WHERE state = 'ATTEMPTED') AS attempted,
        (SELECT count(*)::int FROM eject_lifecycle_events WHERE state = 'OUTCOME_UNKNOWN') AS unknown
    `);
    expect(state.rows[0]).toEqual({
      status: "OUTCOME_UNKNOWN",
      results: 1,
      delivered: 1,
      attempted: 1,
      unknown: 1,
    });
  });

  it("records a local rejection without an attempted lifecycle", async () => {
    await poll(deviceContext("poll-rejected"), now);
    await expect(
      ingest(
        deviceContext("result-rejected"),
        {
          commandId,
          deviceId,
          recordedAt: new Date(now.getTime() + 1_000),
          disposition: "REJECTED",
          attemptCount: 0,
          result: "AGENT_PAUSED",
          physicalOutcome: "NOT_ATTEMPTED",
        },
        new Date(now.getTime() + 2_000),
      ),
    ).resolves.toEqual({ outcome: "STORED" });

    const state = await pool.query<{
      status: string;
      rejected: number;
      attempted: number;
    }>(`
      SELECT
        (SELECT status FROM eject_commands WHERE command_id = '${commandId}') AS status,
        (SELECT count(*)::int FROM eject_lifecycle_events WHERE state = 'REJECTED_BY_AGENT') AS rejected,
        (SELECT count(*)::int FROM eject_lifecycle_events WHERE state = 'ATTEMPTED') AS attempted
    `);
    expect(state.rows[0]).toEqual({
      status: "REJECTED_BY_AGENT",
      rejected: 1,
      attempted: 0,
    });
  });

  it("cancels queued work when the database delivery gate is disabled", async () => {
    await pool.query(
      "UPDATE system_delivery_policy SET delivery_enabled = false",
    );
    await expect(poll(deviceContext("disabled"), now)).resolves.toEqual({
      outcome: "NO_COMMAND",
    });
    const command = await pool.query<{
      status: string;
      cancellation_reason: string;
    }>(
      "SELECT status, cancellation_reason FROM eject_commands WHERE command_id = $1",
      [commandId],
    );
    expect(command.rows[0]).toEqual({
      status: "CANCELLED",
      cancellation_reason: "DELIVERY_DISABLED",
    });
  });

  it("rechecks key revocation inside the poll transaction", async () => {
    await pool.query(
      "UPDATE device_keys SET revoked_at = $1 WHERE key_id = $2",
      [now, keyId],
    );
    await expect(
      store.loadActivePublicKey(deviceId, keyId),
    ).resolves.toBeNull();
    await expect(poll(deviceContext("revoked"), now)).resolves.toEqual({
      outcome: "REJECTED",
      reason: "AUTHENTICATION_FAILED",
    });
    const nonces = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM device_request_nonces",
    );
    expect(nonces.rows[0]?.count).toBe(0);
  });
});

function deviceContext(value: string): AuthenticatedDeviceContext {
  return {
    deviceId,
    keyId,
    nonceDigest: createHash("sha256").update(value).digest(),
  };
}

async function seedCommand(): Promise<void> {
  await pool.query(
    `INSERT INTO people (person_id, display_name, participation_state, availability)
     VALUES ($1, 'Actor', 'PARTICIPATION_READY', 'AVAILABLE'),
            ($2, 'Recipient', 'PARTICIPATION_READY', 'AVAILABLE')`,
    [actorId, recipientId],
  );
  await pool.query(
    `INSERT INTO registered_devices
       (device_id, owner_id, enrollment_state, availability, has_approved_drive)
     VALUES ($1, $2, 'READY', 'AVAILABLE', true)`,
    [deviceId, recipientId],
  );
  await pool.query(
    `INSERT INTO device_keys (key_id, device_id, algorithm, public_key_spki, created_at)
     VALUES ($1, $2, 'ECDSA_P256_SHA256_P1363', $3, $4)`,
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
        recipientId,
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
        recipientId,
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
