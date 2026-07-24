import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createPostgresDatabase } from "../../src/infrastructure/postgres/database";
import { migrate } from "../../src/infrastructure/postgres/migrate";
import { PostgresRelationshipStore } from "../../src/modules/permissions/infrastructure/postgres-relationship-store";

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL tests");
}

const pool = new Pool({ connectionString, max: 8 });
const database = createPostgresDatabase(pool);
const store = new PostgresRelationshipStore(database, randomUUID);
const inviterId = "11111111-1111-4111-8111-111111111111";
const accepterId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const inviterDeviceId = "44444444-4444-4444-8444-444444444444";
const accepterDeviceId = "55555555-5555-4555-8555-555555555555";
const inviterCommandId = "66666666-6666-4666-8666-666666666666";
const accepterCommandId = "77777777-7777-4777-8777-777777777777";
const now = new Date("2026-07-24T00:00:00.000Z");

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
      ($1, 'Inviter'), ($2, 'Accepter'), ($3, 'Other')`,
    [inviterId, accepterId, otherId],
  );
});

afterAll(async () => {
  await database.destroy();
});

describe("PostgresRelationshipStore", () => {
  it("stores only a digest and invalidates the inviter's previous unused code", async () => {
    const firstDigest = digest("first");
    const secondDigest = digest("second");
    await expect(createInvitation(firstDigest)).resolves.toBe("CREATED");
    await expect(createInvitation(secondDigest)).resolves.toBe("CREATED");

    const rows = await pool.query<{
      digest_length: number;
      invalidated: boolean;
      used: boolean;
    }>(
      `SELECT octet_length(invitation_digest)::int AS digest_length,
         invalidated_at IS NOT NULL AS invalidated,
         used_at IS NOT NULL AS used
       FROM relationship_invitations
       ORDER BY invalidated_at NULLS LAST, invitation_id`,
    );
    expect(rows.rows).toEqual([
      { digest_length: 32, invalidated: true, used: false },
      { digest_length: 32, invalidated: false, used: false },
    ]);
    await expect(
      store.acceptInvitation({
        accepterId,
        invitationDigest: firstDigest,
        now,
      }),
    ).resolves.toBe("INVITATION_UNAVAILABLE");
  });

  it("allows exactly one accepter and creates no directional grant", async () => {
    const invitationDigest = digest("race");
    await createInvitation(invitationDigest);
    const results = await Promise.all([
      store.acceptInvitation({
        accepterId,
        invitationDigest,
        now,
      }),
      store.acceptInvitation({
        accepterId: otherId,
        invitationDigest,
        now,
      }),
    ]);
    expect(results.sort()).toEqual(["CONNECTED", "INVITATION_UNAVAILABLE"]);

    const state = await pool.query<{
      relationships: number;
      grants: number;
      used: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM relationships WHERE active) AS relationships,
         (SELECT count(*)::int FROM eject_grants) AS grants,
         (SELECT count(*)::int FROM relationship_invitations
            WHERE used_at IS NOT NULL) AS used`,
    );
    expect(state.rows[0]).toEqual({
      relationships: 1,
      grants: 0,
      used: 1,
    });
  });

  it("rejects self-use, expiry, and unavailable accounts", async () => {
    const expiredDigest = digest("expired");
    await store.createInvitation({
      invitationId: randomUUID(),
      inviterId,
      invitationDigest: expiredDigest,
      now: new Date(now.getTime() - 700_000),
      expiresAt: new Date(now.getTime() - 100_000),
    });
    await expect(
      store.acceptInvitation({
        accepterId,
        invitationDigest: expiredDigest,
        now,
      }),
    ).resolves.toBe("INVITATION_UNAVAILABLE");

    const selfDigest = digest("self");
    await createInvitation(selfDigest);
    await expect(
      store.acceptInvitation({
        accepterId: inviterId,
        invitationDigest: selfDigest,
        now,
      }),
    ).resolves.toBe("INVITATION_UNAVAILABLE");

    const restrictedDigest = digest("restricted");
    await createInvitation(restrictedDigest);
    await pool.query(
      "UPDATE people SET account_status = 'RESTRICTED' WHERE person_id = $1",
      [inviterId],
    );
    await expect(
      store.acceptInvitation({
        accepterId,
        invitationDigest: restrictedDigest,
        now,
      }),
    ).resolves.toBe("INVITATION_UNAVAILABLE");

    await pool.query(
      "UPDATE people SET account_status = 'ACTIVE' WHERE person_id = $1",
      [inviterId],
    );
  });

  it("consumes a code without altering grants when already connected", async () => {
    await pool.query(
      `INSERT INTO relationships (
         person_low_id, person_high_id, created_at
       ) VALUES ($1, $2, $3)`,
      [inviterId, accepterId, now],
    );
    await pool.query(
      `INSERT INTO eject_grants (recipient_id, actor_id)
       VALUES ($1, $2)`,
      [inviterId, accepterId],
    );
    const invitationDigest = digest("existing");
    await createInvitation(invitationDigest);
    await expect(
      store.acceptInvitation({
        accepterId,
        invitationDigest,
        now,
      }),
    ).resolves.toBe("ALREADY_CONNECTED");
    const grants = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM eject_grants",
    );
    expect(grants.rows[0]?.count).toBe(1);
  });

  it("disconnects both directional grants and reconnects only through a new code", async () => {
    await pool.query(
      `INSERT INTO relationships (
         person_low_id, person_high_id, created_at
       ) VALUES ($1, $2, $3)`,
      [inviterId, accepterId, now],
    );
    await pool.query(
      `INSERT INTO eject_grants (recipient_id, actor_id)
       VALUES ($1, $2), ($2, $1)`,
      [inviterId, accepterId],
    );
    await seedBidirectionalCommands();
    await expect(
      store.disconnectRelationship({
        personId: inviterId,
        otherPersonId: accepterId,
        now,
      }),
    ).resolves.toBe("DISCONNECTED");
    await expect(
      store.disconnectRelationship({
        personId: inviterId,
        otherPersonId: accepterId,
        now,
      }),
    ).resolves.toBe("UNCHANGED");

    const disconnected = await pool.query<{
      active: boolean;
      ended_at: Date | null;
      grants: number;
    }>(
      `SELECT relationship.active, relationship.ended_at,
         (SELECT count(*)::int FROM eject_grants) AS grants
       FROM relationships relationship
       WHERE person_low_id = $1 AND person_high_id = $2`,
      [inviterId, accepterId],
    );
    expect(disconnected.rows[0]).toMatchObject({
      active: false,
      ended_at: now,
      grants: 0,
    });
    const commands = await pool.query<{
      command_id: string;
      status: string;
      cancellation_reason: string | null;
      cancelled_events: number;
    }>(
      `SELECT command.command_id, command.status,
         command.cancellation_reason,
         count(event.event_id) FILTER (
           WHERE event.state = 'CANCELLED'
         )::int AS cancelled_events
       FROM eject_commands command
       LEFT JOIN eject_lifecycle_events event
         ON event.command_id = command.command_id
       GROUP BY command.command_id
       ORDER BY command.command_id`,
    );
    expect(commands.rows).toEqual([
      {
        command_id: inviterCommandId,
        status: "CANCELLED",
        cancellation_reason: "PERMISSION_REVOKED",
        cancelled_events: 1,
      },
      {
        command_id: accepterCommandId,
        status: "CANCELLED",
        cancellation_reason: "PERMISSION_REVOKED",
        cancelled_events: 1,
      },
    ]);

    const reconnectDigest = digest("reconnect");
    await createInvitation(reconnectDigest);
    await expect(
      store.acceptInvitation({
        accepterId,
        invitationDigest: reconnectDigest,
        now: new Date(now.getTime() + 1_000),
      }),
    ).resolves.toBe("CONNECTED");
    const reconnected = await pool.query<{
      active: boolean;
      ended_at: Date | null;
      grants: number;
    }>(
      `SELECT relationship.active, relationship.ended_at,
         (SELECT count(*)::int FROM eject_grants) AS grants
       FROM relationships relationship
       WHERE person_low_id = $1 AND person_high_id = $2`,
      [inviterId, accepterId],
    );
    expect(reconnected.rows[0]).toEqual({
      active: true,
      ended_at: null,
      grants: 0,
    });
  });

  it("deletes only invitation rows beyond the 24-hour retention boundary", async () => {
    await createInvitation(digest("current"));
    await pool.query(
      `INSERT INTO relationship_invitations (
         invitation_id, inviter_id, invitation_digest,
         expires_at, used_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        inviterId,
        Buffer.from(digest("stale")),
        new Date(now.getTime() - 25 * 60 * 60_000 + 600_000),
        new Date(now.getTime() - 25 * 60 * 60_000 + 1_000),
        new Date(now.getTime() - 25 * 60 * 60_000),
      ],
    );
    await expect(
      store.cleanupInvitations({
        before: new Date(now.getTime() - 24 * 60 * 60_000),
        limit: 500,
      }),
    ).resolves.toBe(1);
    const count = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM relationship_invitations",
    );
    expect(count.rows[0]?.count).toBe(1);
  });
});

function digest(value: string): Uint8Array {
  return createHash("sha256").update(value).digest();
}

function createInvitation(invitationDigest: Uint8Array) {
  return store.createInvitation({
    invitationId: randomUUID(),
    inviterId,
    invitationDigest,
    now,
    expiresAt: new Date(now.getTime() + 600_000),
  });
}

async function seedBidirectionalCommands(): Promise<void> {
  await pool.query(
    `INSERT INTO registered_devices (
       device_id, owner_id, enrollment_state, availability,
       has_approved_drive, platform, agent_version, created_at
     ) VALUES
       ($1, $2, 'READY', 'AVAILABLE', true, 'WINDOWS', '0.1.0', $5),
       ($3, $4, 'READY', 'AVAILABLE', true, 'WINDOWS', '0.1.0', $5)`,
    [inviterDeviceId, inviterId, accepterDeviceId, accepterId, now],
  );
  const inviterRequestId = randomUUID();
  const accepterRequestId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO eject_requests (
         request_id, actor_id, recipient_id, idempotency_key,
         request_fingerprint, action, outcome, command_id, created_at
       ) VALUES
         ($1, $2, $3, $4, $5, 'EJECT', 'QUEUED', $6, $7),
         ($8, $3, $2, $9, $10, 'EJECT', 'QUEUED', $11, $7)`,
      [
        inviterRequestId,
        inviterId,
        accepterId,
        randomUUID(),
        "a".repeat(64),
        inviterCommandId,
        now,
        accepterRequestId,
        randomUUID(),
        "b".repeat(64),
        accepterCommandId,
      ],
    );
    await client.query(
      `INSERT INTO eject_commands (
         command_id, request_id, actor_id, recipient_id, device_id,
         status, issued_at, expires_at
       ) VALUES
         ($1, $2, $3, $4, $5, 'QUEUED', $6, $7),
         ($8, $9, $4, $3, $10, 'DISPATCHED', $6, $7)`,
      [
        inviterCommandId,
        inviterRequestId,
        inviterId,
        accepterId,
        accepterDeviceId,
        now,
        new Date(now.getTime() + 30_000),
        accepterCommandId,
        accepterRequestId,
        inviterDeviceId,
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
