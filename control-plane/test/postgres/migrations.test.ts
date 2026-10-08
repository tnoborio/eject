import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  assertDatabaseSecurity,
  inspectDatabaseSecurity,
} from "../../scripts/database-security";
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
      { filename: "0002_agent_transport_security.sql", checksum_length: 64 },
      {
        filename: "0003_device_enrollment_and_revocation.sql",
        checksum_length: 64,
      },
      {
        filename: "0004_invite_only_relationships.sql",
        checksum_length: 64,
      },
      {
        filename: "0005_relationship_lifecycle.sql",
        checksum_length: 64,
      },
      {
        filename: "0006_close_data_api_access.sql",
        checksum_length: 64,
      },
    ]);
  });

  it("enables RLS on every public table, including the migration ledger", async () => {
    const state = await inspectDatabaseSecurity(pool);
    expect(state.public_tables).toBeGreaterThan(0);
    expect(state.tables_without_rls).toBe(0);
    expect(state.connection_bypasses_rls).toBe(true);
    assertDatabaseSecurity(state);
    const ledger = await pool.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.schema_migrations'::regclass",
    );
    expect(ledger.rows).toEqual([{ relrowsecurity: true }]);
    const policies = await pool.query(
      "SELECT 1 FROM pg_policies WHERE schemaname = 'public'",
    );
    expect(policies.rows).toEqual([]);
    const forced = await pool.query(
      "SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relforcerowsecurity",
    );
    expect(forced.rows).toEqual([]);
  });

  it("leaves existing Data API roles without effective public table privileges", async () => {
    const state = await inspectDatabaseSecurity(pool);
    expect(state.api_table_privileges).toBe(0);
  });

  it("rejects a future public table without RLS in the cloud security verifier", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE TABLE public.rls_regression_probe (id integer)",
      );
      const state = await inspectDatabaseSecurity(client);
      expect(state.tables_without_rls).toBe(1);
      expect(() => assertDatabaseSecurity(state)).toThrow("row-level security");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("revokes existing and future direct API grants when the roles exist", async (context) => {
    const roles = await pool.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname",
    );
    if (roles.rows.length === 0) return context.skip();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE SEQUENCE public.api_existing_sequence");
      await client.query(
        "CREATE FUNCTION public.api_existing_function() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
      );
      for (const { rolname } of roles.rows) {
        // Names come only from the fixed role allowlist above.
        await client.query(
          `GRANT ALL ON ALL TABLES IN SCHEMA public TO "${rolname}"`,
        );
        await client.query(
          `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${rolname}"`,
        );
        await client.query(
          `GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO "${rolname}"`,
        );
        for (const kind of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
          await client.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ${kind} TO "${rolname}"`,
          );
        }
      }
      const exposed = await inspectDatabaseSecurity(client);
      expect(exposed.api_table_privileges).toBeGreaterThan(0);
      expect(() => assertDatabaseSecurity(exposed)).toThrow("Data API roles");
      await client.query(
        await readFile(
          resolve(migrations, "0006_close_data_api_access.sql"),
          "utf8",
        ),
      );
      assertDatabaseSecurity(await inspectDatabaseSecurity(client));
      await client.query("CREATE TABLE public.api_future_table (id serial)");
      await client.query(
        "ALTER TABLE public.api_future_table ENABLE ROW LEVEL SECURITY",
      );
      await client.query(
        "CREATE FUNCTION public.api_future_function() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
      );
      assertDatabaseSecurity(await inspectDatabaseSecurity(client));
      const sequenceGrants = await client.query(`
        SELECT 1 FROM pg_class AS c CROSS JOIN pg_roles AS r
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
          AND r.rolname IN ('anon', 'authenticated')
          AND has_sequence_privilege(r.oid, c.oid, 'USAGE, SELECT, UPDATE')
      `);
      expect(sequenceGrants.rows).toEqual([]);
      // PostgreSQL's implicit PUBLIC EXECUTE is separate from named role grants.
      const functionGrants = await client.query(`
        SELECT 1 FROM pg_proc AS p
        CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
        JOIN pg_roles AS r ON r.oid = acl.grantee
        WHERE p.pronamespace = 'public'::regnamespace
          AND r.rolname IN ('anon', 'authenticated')
      `);
      expect(functionGrants.rows).toEqual([]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("rejects an API connection role even when RLS would hide all rows", async (context) => {
    const roles = await pool.query(`
      SELECT 1 FROM pg_roles WHERE rolname = 'anon'
        AND pg_has_role(current_user, oid, 'SET')
    `);
    if (roles.rowCount === 0) return context.skip();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE anon");
      const state = await inspectDatabaseSecurity(client);
      expect(state.tables_without_rls).toBe(0);
      expect(state.api_table_privileges).toBe(0);
      expect(state.connection_bypasses_rls).toBe(false);
      expect(() => assertDatabaseSecurity(state)).toThrow("connection role");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("blocks anon SELECT and keeps RLS deny-by-default if SELECT is regranted", async (context) => {
    const roles = await pool.query(`
      SELECT 1 FROM pg_roles WHERE rolname = 'anon'
        AND pg_has_role(current_user, oid, 'SET')
    `);
    if (roles.rowCount === 0) return context.skip();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("GRANT USAGE ON SCHEMA public TO anon");
      const owner = await client.query(
        "SELECT 1 FROM public.system_delivery_policy",
      );
      expect(owner.rowCount).toBe(1);
      await client.query("SET LOCAL ROLE anon");
      await client.query("SAVEPOINT denied_select");
      await expect(
        client.query("SELECT 1 FROM public.system_delivery_policy"),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT denied_select");
      await client.query("RESET ROLE");
      // Even a PUBLIC column grant must be detected as effective API access.
      await client.query(
        "GRANT SELECT (singleton) ON public.system_delivery_policy TO PUBLIC",
      );
      const exposed = await inspectDatabaseSecurity(client);
      expect(exposed.api_table_privileges).toBeGreaterThan(0);
      expect(() => assertDatabaseSecurity(exposed)).toThrow("Data API roles");
      await client.query("SET LOCAL ROLE anon");
      const hidden = await client.query(
        "SELECT singleton FROM public.system_delivery_policy",
      );
      expect(hidden.rows).toEqual([]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
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
        AND column_name ~ '(password|secret|credential|private|email|disc|filename|device_path)'
    `);
    expect(result.rows).toEqual([]);
  });
});
