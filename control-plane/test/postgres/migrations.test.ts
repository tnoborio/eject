import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../src/infrastructure/postgres/migrate";

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL tests");
}

const pool = new Pool({ connectionString, max: 4 });
const migrations = resolve(process.cwd(), "migrations");

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>(
    "SELECT current_database()",
  );
  if (database.rows[0]?.current_database !== "eject_test") {
    throw new Error(
      "PostgreSQL tests refuse to reset a database not named eject_test",
    );
  }

  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrate(pool, migrations);
});

afterAll(async () => {
  await pool.end();
});

describe("control-plane migrations", () => {
  it("replays from an empty database and is idempotent", async () => {
    await migrate(pool, migrations);
    const result = await pool.query<{
      filename: string;
      checksum_length: number;
    }>(
      "SELECT filename, length(checksum)::int AS checksum_length FROM schema_migrations",
    );
    expect(result.rows).toEqual([
      { filename: "0001_initial_control_plane.sql", checksum_length: 64 },
    ]);
  });

  it("rejects modified migration history by checksum", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "eject-migrations-"));
    const filename = "0001_initial_control_plane.sql";
    const original = await readFile(resolve(migrations, filename), "utf8");
    await writeFile(
      resolve(directory, filename),
      `${original}\n-- drift\n`,
      "utf8",
    );
    await expect(migrate(pool, directory)).rejects.toThrow(
      "Migration checksum mismatch",
    );
  });

  it("defaults delivery to disabled and exposure to zero", async () => {
    const delivery = await pool.query<{
      delivery_enabled: boolean;
      physical_hourly_ceiling: number | null;
    }>(
      "SELECT delivery_enabled, physical_hourly_ceiling FROM system_delivery_policy",
    );
    expect(delivery.rows).toEqual([
      { delivery_enabled: false, physical_hourly_ceiling: null },
    ]);

    await pool.query(
      "INSERT INTO people (person_id, display_name) VALUES ('11111111-1111-4111-8111-111111111111', 'Recipient')",
    );
    await pool.query(
      "INSERT INTO recipient_access_policies (recipient_id) VALUES ('11111111-1111-4111-8111-111111111111')",
    );
    const policy = await pool.query<{
      audience_scope: string;
      selected_hourly_limit: number;
    }>(
      "SELECT audience_scope, selected_hourly_limit FROM recipient_access_policies",
    );
    expect(policy.rows).toEqual([
      { audience_scope: "NAMED", selected_hourly_limit: 0 },
    ]);
  });

  it("enforces closed values and non-negative limits in PostgreSQL", async () => {
    await expect(
      pool.query(
        "UPDATE recipient_access_policies SET audience_scope = 'PUBLIC' WHERE recipient_id = '11111111-1111-4111-8111-111111111111'",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "UPDATE recipient_access_policies SET selected_hourly_limit = -1 WHERE recipient_id = '11111111-1111-4111-8111-111111111111'",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("contains no credential, email, or disc-content columns", async () => {
    const result = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name <> 'schema_migrations'
        AND column_name ~ '(password|secret|credential|email|disc|filename|device_path)'
    `);
    expect(result.rows).toEqual([]);
  });
});
