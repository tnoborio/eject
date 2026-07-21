import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";

const MIGRATION_LOCK_ID = 1_845_322_301;
const migrationPattern = /^\d{4}_[a-z0-9_]+\.sql$/;

export async function migrate(pool: Pool, directory: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await ensureLedger(client);

    const files = (await readdir(directory))
      .filter((file) => migrationPattern.test(file))
      .sort();
    for (const file of files) {
      const sql = await readFile(resolve(directory, file), "utf8");
      const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
      const applied = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE filename = $1",
        [file],
      );

      if (applied.rowCount === 1) {
        if (applied.rows[0]?.checksum !== checksum) {
          throw new Error(`Migration checksum mismatch: ${file}`);
        }
        continue;
      }

      await applyMigration(client, file, checksum, sql);
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
      .catch(() => undefined);
    client.release();
  }
}

async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function applyMigration(
  client: PoolClient,
  filename: string,
  checksum: string,
  sql: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
      [filename, checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString });
  try {
    await migrate(pool, resolve(process.cwd(), "migrations"));
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
