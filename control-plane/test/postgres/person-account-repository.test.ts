import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createPostgresDatabase } from "../../src/infrastructure/postgres/database";
import { migrate } from "../../src/infrastructure/postgres/migrate";
import { PostgresPersonAccountReader } from "../../src/modules/identity/infrastructure/postgres-person-account-reader";

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL tests");
}

const pool = new Pool({ connectionString, max: 2 });
const database = createPostgresDatabase(pool);
const accounts = new PostgresPersonAccountReader(database);
const personId = "11111111-1111-4111-8111-111111111111";

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

afterAll(async () => {
  await database.destroy();
});

describe("PostgresPersonAccountReader", () => {
  it("reads current account status without storing provider identity", async () => {
    await expect(accounts.loadAccountStatus(personId)).resolves.toBeNull();
    await pool.query(
      "INSERT INTO people (person_id, display_name) VALUES ($1, 'Person')",
      [personId],
    );
    await expect(accounts.loadAccountStatus(personId)).resolves.toBe("ACTIVE");

    await pool.query(
      "UPDATE people SET account_status = 'RESTRICTED' WHERE person_id = $1",
      [personId],
    );
    await expect(accounts.loadAccountStatus(personId)).resolves.toBe(
      "RESTRICTED",
    );
  });
});
