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
const store = new PostgresRelationshipStore(database);
const inviterId = "11111111-1111-4111-8111-111111111111";
const accepterId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
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

  it("rejects self-use, expiry, unavailable accounts, and inactive prior relationships", async () => {
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
    await pool.query(
      `INSERT INTO relationships (
         person_low_id, person_high_id, active
       ) VALUES ($1, $2, false)`,
      [inviterId, accepterId],
    );
    const inactiveDigest = digest("inactive");
    await createInvitation(inactiveDigest);
    await expect(
      store.acceptInvitation({
        accepterId,
        invitationDigest: inactiveDigest,
        now,
      }),
    ).resolves.toBe("INVITATION_UNAVAILABLE");
  });

  it("consumes a code without altering grants when already connected", async () => {
    await pool.query(
      `INSERT INTO relationships (person_low_id, person_high_id)
       VALUES ($1, $2)`,
      [inviterId, accepterId],
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
