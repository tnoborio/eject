import type { Pool, PoolClient } from "pg";

export interface DatabaseSecurity {
  public_tables: number;
  tables_without_rls: number;
  api_roles: number;
  api_table_privileges: number;
  connection_bypasses_rls: boolean;
}

export async function inspectDatabaseSecurity(
  client: Pool | PoolClient,
): Promise<DatabaseSecurity> {
  const result = await client.query<DatabaseSecurity>(`
    WITH public_tables AS (
      SELECT c.* FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ), api_roles AS (
      SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
    )
    SELECT
      (SELECT count(*)::int FROM public_tables) AS public_tables,
      (SELECT count(*)::int FROM public_tables WHERE NOT relrowsecurity)
        AS tables_without_rls,
      (SELECT count(*)::int FROM api_roles) AS api_roles,
      (SELECT count(*)::int FROM public_tables AS t CROSS JOIN api_roles AS r
        WHERE has_table_privilege(r.oid, t.oid,
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
        OR has_any_column_privilege(r.oid, t.oid,
          'SELECT, INSERT, UPDATE, REFERENCES')) AS api_table_privileges,
      (r.rolbypassrls OR NOT EXISTS (
        SELECT 1 FROM public_tables AS t
        WHERE t.relowner <> r.oid OR t.relforcerowsecurity
      )) AS connection_bypasses_rls
    FROM pg_roles AS r WHERE r.rolname = current_user
  `);
  const state = result.rows[0];
  if (state === undefined)
    throw new Error("Database security state is missing");
  return state;
}

export function assertDatabaseSecurity(state: DatabaseSecurity): void {
  if (state.public_tables === 0 || state.tables_without_rls !== 0) {
    throw new Error("Public tables must all have row-level security enabled");
  }
  if (state.api_table_privileges !== 0) {
    throw new Error("Data API roles must have no public table privileges");
  }
  if (!state.connection_bypasses_rls) {
    throw new Error(
      "Database connection role must own all public tables without FORCE RLS or have BYPASSRLS",
    );
  }
}
