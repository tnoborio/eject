import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { createPostgresDatabase } from "../../src/infrastructure/postgres/database";
import { migrate } from "../../src/infrastructure/postgres/migrate";
import { createIssueEject } from "../../src/modules/eject/application/issue-eject";
import { PostgresIssuanceStore } from "../../src/modules/eject/infrastructure/postgres-issuance-store";

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL tests");
}

const applicationName = "eject-transaction-concurrency-test";
const pool = new Pool({
  connectionString,
  max: 12,
  application_name: applicationName,
});
const database = createPostgresDatabase(pool);
const issue = createIssueEject({
  store: new PostgresIssuanceStore(database),
  ids: { newId: randomUUID },
});

const actorOneId = "11111111-1111-4111-8111-111111111111";
const actorTwoId = "22222222-2222-4222-8222-222222222222";
const recipientId = "33333333-3333-4333-8333-333333333333";
const baseTime = new Date("2026-07-21T00:00:00.000Z");

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
    "INSERT INTO system_delivery_policy (singleton, delivery_enabled, physical_hourly_ceiling) VALUES (true, true, 10)",
  );
});

afterAll(async () => {
  await database.destroy();
});

describe("issuance transaction concurrency", () => {
  it("serializes two contenders for the final recipient slot", async () => {
    await seedRecipient(recipientId, [actorOneId, actorTwoId], 1);
    const gate = await lockRecipient(recipientId);

    const contenders = [
      issue(standardInput(actorOneId, recipientId, randomUUID())),
      issue(standardInput(actorTwoId, recipientId, randomUUID())),
    ];
    await waitForLockWaiters(2);
    await gate.query("COMMIT");
    gate.release();

    const results = await Promise.all(contenders);
    expect(results.map((result) => result.outcome).sort()).toEqual([
      "QUEUED",
      "REJECTED",
    ]);
    expect(results).toContainEqual(
      expect.objectContaining({ outcome: "REJECTED", reason: "RATE_LIMITED" }),
    );
    await expectCounts({ requests: 2, commands: 1, recipientUsage: 1 });
  });

  it("coalesces concurrent duplicate requests into one command", async () => {
    await seedRecipient(recipientId, [actorOneId], 2);
    const gate = await lockRecipient(recipientId);
    const input = standardInput(actorOneId, recipientId, randomUUID());

    const duplicates = [issue(input), issue(input)];
    await waitForLockWaiters(2);
    await gate.query("COMMIT");
    gate.release();

    const results = await Promise.all(duplicates);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ outcome: "QUEUED" });
    await expectCounts({ requests: 1, commands: 1, recipientUsage: 1 });
  });

  it("rolls back every issuance write when a lifecycle insert fails", async () => {
    await seedRecipient(recipientId, [actorOneId], 2);
    const duplicateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const issueWithCollidingIds = createIssueEject({
      store: new PostgresIssuanceStore(database),
      ids: { newId: () => duplicateId },
    });

    await expect(
      issueWithCollidingIds(
        standardInput(actorOneId, recipientId, randomUUID()),
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expectCounts({ requests: 0, commands: 0, recipientUsage: 0 });
    const events = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM eject_lifecycle_events",
    );
    expect(events.rows[0]?.count).toBe(0);
  });

  it("rechecks authorization after a concurrent grant revocation", async () => {
    await seedRecipient(recipientId, [actorOneId], 2);
    const revocation = await pool.connect();
    await revocation.query("BEGIN");
    await revocation.query(
      "UPDATE recipient_eject_state SET revision = revision + 1 WHERE recipient_id = $1",
      [recipientId],
    );
    await revocation.query(
      "DELETE FROM eject_grants WHERE recipient_id = $1 AND actor_id = $2",
      [recipientId, actorOneId],
    );

    const pending = issue(standardInput(actorOneId, recipientId, randomUUID()));
    await waitForLockWaiters(1);
    await revocation.query("COMMIT");
    revocation.release();

    await expect(pending).resolves.toMatchObject({
      outcome: "REJECTED",
      reason: "PERMISSION_REQUIRED",
    });
    await expectCounts({ requests: 1, commands: 0, recipientUsage: 0 });
  });

  it("allows exactly one concurrent eject-back for a source command", async () => {
    await seedRecipient(recipientId, [actorOneId], 3);
    await seedRecipient(actorOneId, [recipientId], 3, false);
    const source = await issue(
      standardInput(actorOneId, recipientId, randomUUID()),
    );
    if (source.outcome !== "QUEUED") {
      throw new Error("Source command was not queued");
    }

    const gate = await lockRecipient(actorOneId);
    const replies = [
      issue(ejectBackInput(recipientId, actorOneId, source.commandId)),
      issue(ejectBackInput(recipientId, actorOneId, source.commandId)),
    ];
    await waitForLockWaiters(2);
    await gate.query("COMMIT");
    gate.release();

    const results = await Promise.all(replies);
    expect(results.map((result) => result.outcome).sort()).toEqual([
      "QUEUED",
      "REJECTED",
    ]);
    expect(results).toContainEqual(
      expect.objectContaining({
        outcome: "REJECTED",
        reason: "PERMISSION_REQUIRED",
      }),
    );
    const repliesStored = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM eject_commands WHERE reply_to_command_id = $1",
      [source.commandId],
    );
    expect(repliesStored.rows[0]?.count).toBe(1);
  });
});

async function seedRecipient(
  targetId: string,
  actorIds: readonly string[],
  limit: number,
  grant = true,
): Promise<void> {
  const people = [...new Set([targetId, ...actorIds])];
  for (const personId of people) {
    await pool.query(
      `INSERT INTO people (person_id, display_name, participation_state, availability)
       VALUES ($1, $2, 'PARTICIPATION_READY', 'AVAILABLE')
       ON CONFLICT (person_id) DO NOTHING`,
      [personId, `Person ${personId.slice(0, 8)}`],
    );
  }
  await pool.query(
    `INSERT INTO recipient_access_policies
       (recipient_id, selected_hourly_limit, cooldown_seconds)
     VALUES ($1, $2, 0)`,
    [targetId, limit],
  );
  await pool.query(
    `INSERT INTO recipient_entitlements
       (recipient_id, inbound_hourly_ceiling, source_version)
     VALUES ($1, $2, 'concurrency-test')`,
    [targetId, limit],
  );
  await pool.query(
    `INSERT INTO registered_devices
       (device_id, owner_id, enrollment_state, availability, has_approved_drive)
     VALUES ($1, $2, 'READY', 'AVAILABLE', true)`,
    [randomUUID(), targetId],
  );
  await pool.query(
    `INSERT INTO recipient_eject_state (recipient_id, window_started_at)
     VALUES ($1, $2)`,
    [targetId, baseTime],
  );
  if (grant) {
    for (const actorId of actorIds) {
      const [low, high] = [actorId, targetId].sort();
      await pool.query(
        "INSERT INTO relationships (person_low_id, person_high_id) VALUES ($1, $2)",
        [low, high],
      );
      await pool.query(
        "INSERT INTO eject_grants (recipient_id, actor_id) VALUES ($1, $2)",
        [targetId, actorId],
      );
    }
  }
}

async function lockRecipient(targetId: string): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query(
    "SELECT recipient_id FROM recipient_eject_state WHERE recipient_id = $1 FOR UPDATE",
    [targetId],
  );
  return client;
}

async function waitForLockWaiters(expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM pg_stat_activity
       WHERE application_name = $1 AND wait_event_type = 'Lock'`,
      [applicationName],
    );
    if ((result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Timed out waiting for ${expected} PostgreSQL lock waiters`);
}

function standardInput(actorId: string, targetId: string, key: string) {
  return {
    actorId,
    recipientId: targetId,
    idempotencyKey: key,
    action: "EJECT" as const,
    replyToCommandId: null,
    now: baseTime,
  };
}

function ejectBackInput(actorId: string, targetId: string, sourceId: string) {
  return {
    actorId,
    recipientId: targetId,
    idempotencyKey: randomUUID(),
    action: "EJECT_BACK" as const,
    replyToCommandId: sourceId,
    now: new Date(baseTime.getTime() + 1_000),
  };
}

async function expectCounts(expected: {
  requests: number;
  commands: number;
  recipientUsage: number;
}): Promise<void> {
  const counts = await pool.query<{
    requests: number;
    commands: number;
    recipient_usage: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM eject_requests) AS requests,
       (SELECT count(*)::int FROM eject_commands) AS commands,
       COALESCE((SELECT accepted_in_window FROM recipient_eject_state WHERE recipient_id = $1), 0)::int AS recipient_usage`,
    [recipientId],
  );
  expect(counts.rows[0]).toEqual({
    requests: expected.requests,
    commands: expected.commands,
    recipient_usage: expected.recipientUsage,
  });
}
