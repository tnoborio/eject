import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createPostgresDatabase } from "../../src/infrastructure/postgres/database";
import { migrate } from "../../src/infrastructure/postgres/migrate";
import { PostgresRecipientConsentStore } from "../../src/modules/permissions/infrastructure/postgres-recipient-consent-store";

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL tests");
}

const pool = new Pool({ connectionString, max: 8 });
const database = createPostgresDatabase(pool);
const store = new PostgresRecipientConsentStore(database, randomUUID);
const recipientId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const otherActorId = "33333333-3333-4333-8333-333333333333";
const deviceId = "44444444-4444-4444-8444-444444444444";
const actorRequestId = "55555555-5555-4555-8555-555555555555";
const otherRequestId = "66666666-6666-4666-8666-666666666666";
const actorCommandId = "77777777-7777-4777-8777-777777777777";
const otherCommandId = "88888888-8888-4888-8888-888888888888";
const now = new Date("2026-07-23T00:00:00.000Z");

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
    `INSERT INTO people (person_id, display_name) VALUES
      ($1, 'Recipient'), ($2, 'Actor'), ($3, 'Other actor')`,
    [recipientId, actorId, otherActorId],
  );
  await pool.query(
    "INSERT INTO recipient_access_policies (recipient_id) VALUES ($1)",
    [recipientId],
  );
});

afterAll(async () => {
  await database.destroy();
});

describe("PostgresRecipientConsentStore", () => {
  it("returns only active relationships and their directional grant state", async () => {
    await connect(actorId);
    await pool.query(
      `INSERT INTO relationships (
         person_low_id, person_high_id, active, created_at, ended_at
       ) VALUES ($1, $2, false, $3, $3)`,
      [recipientId, otherActorId, now],
    );
    await pool.query(
      "INSERT INTO eject_grants (recipient_id, actor_id) VALUES ($1, $2)",
      [recipientId, actorId],
    );

    await expect(store.read(recipientId)).resolves.toEqual({
      paused: false,
      connectedPeople: [
        {
          personId: actorId,
          displayName: "Actor",
          grantActive: true,
          accountAvailable: true,
        },
      ],
    });
    await expect(store.read(otherActorId)).resolves.toEqual({
      paused: false,
      connectedPeople: [],
    });
  });

  it("requires an active connection and cancels only the revoked actor's undelivered commands", async () => {
    await expect(
      store.setGrant({
        recipientId,
        actorId,
        granted: true,
        now,
      }),
    ).resolves.toBe("CONNECTION_REQUIRED");

    await connect(actorId);
    await connect(otherActorId);
    await expect(
      store.setGrant({
        recipientId,
        actorId,
        granted: true,
        now,
      }),
    ).resolves.toBe("UPDATED");
    await seedCommands();
    await expect(
      store.setGrant({
        recipientId,
        actorId,
        granted: false,
        now,
      }),
    ).resolves.toBe("UPDATED");

    const state = await commandState();
    expect(state).toEqual([
      {
        command_id: actorCommandId,
        status: "CANCELLED",
        cancellation_reason: "PERMISSION_REVOKED",
        cancelled_events: 1,
      },
      {
        command_id: otherCommandId,
        status: "DISPATCHED",
        cancellation_reason: null,
        cancelled_events: 0,
      },
    ]);
    await expect(store.read(recipientId)).resolves.toMatchObject({
      connectedPeople: [
        { personId: actorId, grantActive: false },
        { personId: otherActorId, grantActive: false },
      ],
    });
  });

  it("pauses idempotently and atomically cancels all undelivered recipient commands", async () => {
    await seedCommands();
    await store.setPaused({ recipientId, paused: true, now });
    await store.setPaused({ recipientId, paused: true, now });

    await expect(store.read(recipientId)).resolves.toMatchObject({
      paused: true,
    });
    expect(await commandState()).toEqual([
      {
        command_id: actorCommandId,
        status: "CANCELLED",
        cancellation_reason: "PERMISSION_REVOKED",
        cancelled_events: 1,
      },
      {
        command_id: otherCommandId,
        status: "CANCELLED",
        cancellation_reason: "PERMISSION_REVOKED",
        cancelled_events: 1,
      },
    ]);

    await store.setPaused({
      recipientId,
      paused: false,
      now: new Date(now.getTime() + 1_000),
    });
    await expect(store.read(recipientId)).resolves.toMatchObject({
      paused: false,
    });
  });
});

async function connect(personId: string): Promise<void> {
  await pool.query(
    `INSERT INTO relationships (person_low_id, person_high_id)
     VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))`,
    [recipientId, personId],
  );
}

async function seedCommands(): Promise<void> {
  await pool.query(
    `INSERT INTO registered_devices (
       device_id, owner_id, enrollment_state, availability,
       has_approved_drive, platform, agent_version, created_at
     ) VALUES (
       $1, $2, 'READY', 'AVAILABLE', true, 'WINDOWS', '0.1.0', $3
     )`,
    [deviceId, recipientId, now],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO eject_requests (
         request_id, actor_id, recipient_id, idempotency_key,
         request_fingerprint, action, outcome, command_id, created_at
       ) VALUES
         ($1, $2, $3, $4, $5, 'EJECT', 'QUEUED', $6, $7),
         ($8, $9, $3, $10, $11, 'EJECT', 'QUEUED', $12, $7)`,
      [
        actorRequestId,
        actorId,
        recipientId,
        randomUUID(),
        "a".repeat(64),
        actorCommandId,
        now,
        otherRequestId,
        otherActorId,
        randomUUID(),
        "b".repeat(64),
        otherCommandId,
      ],
    );
    await client.query(
      `INSERT INTO eject_commands (
         command_id, request_id, actor_id, recipient_id, device_id,
         status, issued_at, expires_at
       ) VALUES
         ($1, $2, $3, $4, $5, 'QUEUED', $6, $7),
         ($8, $9, $10, $4, $5, 'DISPATCHED', $6, $7)`,
      [
        actorCommandId,
        actorRequestId,
        actorId,
        recipientId,
        deviceId,
        now,
        new Date(now.getTime() + 30_000),
        otherCommandId,
        otherRequestId,
        otherActorId,
      ],
    );
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function commandState() {
  const result = await pool.query<{
    command_id: string;
    status: string;
    cancellation_reason: string | null;
    cancelled_events: number;
  }>(
    `SELECT command.command_id, command.status, command.cancellation_reason,
       count(event.event_id) FILTER (WHERE event.state = 'CANCELLED')::int
         AS cancelled_events
     FROM eject_commands command
     LEFT JOIN eject_lifecycle_events event
       ON event.command_id = command.command_id
     GROUP BY command.command_id
     ORDER BY command.command_id`,
  );
  return result.rows;
}
