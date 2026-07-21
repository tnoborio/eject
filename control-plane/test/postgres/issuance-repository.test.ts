import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createPostgresDatabase } from "../../src/infrastructure/postgres/database";
import { migrate } from "../../src/infrastructure/postgres/migrate";
import { createIssueEject } from "../../src/modules/eject/application/issue-eject";
import { PostgresIssuanceStore } from "../../src/modules/eject/infrastructure/postgres-issuance-store";

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined)
  throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString, max: 8 });
const database = createPostgresDatabase(pool);
const issue = createIssueEject({
  store: new PostgresIssuanceStore(database),
  ids: { newId: randomUUID },
});

const actorId = "11111111-1111-4111-8111-111111111111";
const recipientId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-07-21T00:00:00.000Z");

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
  await pool.query(
    `INSERT INTO people (person_id, display_name, participation_state, availability)
     VALUES ($1, 'Actor', 'PARTICIPATION_READY', 'AVAILABLE'),
            ($2, 'Recipient', 'PARTICIPATION_READY', 'AVAILABLE')`,
    [actorId, recipientId],
  );
  await pool.query(
    "INSERT INTO relationships (person_low_id, person_high_id) VALUES ($1, $2)",
    [actorId, recipientId],
  );
  await pool.query(
    "INSERT INTO eject_grants (recipient_id, actor_id) VALUES ($1, $2)",
    [recipientId, actorId],
  );
  await pool.query(
    `INSERT INTO recipient_access_policies
       (recipient_id, selected_hourly_limit, cooldown_seconds) VALUES ($1, 3, 60)`,
    [recipientId],
  );
  await pool.query(
    `INSERT INTO recipient_entitlements
       (recipient_id, inbound_hourly_ceiling, source_version) VALUES ($1, 3, 'test')`,
    [recipientId],
  );
  await pool.query(
    `INSERT INTO registered_devices
       (device_id, owner_id, enrollment_state, availability, has_approved_drive)
     VALUES ($1, $2, 'READY', 'AVAILABLE', true)`,
    [deviceId, recipientId],
  );
  await pool.query(
    "UPDATE system_delivery_policy SET delivery_enabled = true, physical_hourly_ceiling = 3",
  );
});

afterAll(async () => {
  await database.destroy();
});

describe("PostgresIssuanceStore", () => {
  it("atomically queues a command, lifecycle, cooldown, and quota", async () => {
    const input = {
      actorId,
      recipientId,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      action: "EJECT" as const,
      replyToCommandId: null,
      now,
    };
    const result = await issue(input);
    expect(result).toMatchObject({ outcome: "QUEUED" });
    await expect(issue(input)).resolves.toEqual(result);

    const counts = await pool.query<{
      requests: number;
      commands: number;
      events: number;
      recipient_usage: number;
      sender_usage: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM eject_requests) AS requests,
        (SELECT count(*)::int FROM eject_commands) AS commands,
        (SELECT count(*)::int FROM eject_lifecycle_events) AS events,
        (SELECT accepted_in_window FROM recipient_eject_state WHERE recipient_id = '${recipientId}') AS recipient_usage,
        (SELECT accepted_in_window FROM sender_eject_state WHERE actor_id = '${actorId}') AS sender_usage
    `);
    expect(counts.rows[0]).toEqual({
      requests: 1,
      commands: 1,
      events: 3,
      recipient_usage: 1,
      sender_usage: 1,
    });
  });

  it("records a denial without a deliverable command or quota use", async () => {
    await pool.query(
      "INSERT INTO eject_blocks (recipient_id, actor_id) VALUES ($1, $2)",
      [recipientId, actorId],
    );
    const result = await issue({
      actorId,
      recipientId,
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      action: "EJECT",
      replyToCommandId: null,
      now: new Date(now.getTime() + 120_000),
    });
    expect(result).toMatchObject({
      outcome: "REJECTED",
      reason: "PERMISSION_REQUIRED",
    });
    const counts = await pool.query<{
      commands: number;
      recipient_usage: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM eject_commands) AS commands,
        (SELECT accepted_in_window FROM recipient_eject_state WHERE recipient_id = '${recipientId}') AS recipient_usage
    `);
    expect(counts.rows[0]).toEqual({ commands: 1, recipient_usage: 1 });
  });
});
