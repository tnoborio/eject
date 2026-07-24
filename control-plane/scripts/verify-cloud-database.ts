import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { postgresPoolConfigFromEnvironment } from "../src/infrastructure/postgres/pool-config";

const migrationPattern = /^\d{4}_[a-z0-9_]+\.sql$/;

interface MigrationRow {
  filename: string;
  checksum: string;
}

interface DatabaseState {
  database_name: string;
  server_version_num: string;
  delivery_enabled: boolean;
  physical_hourly_ceiling: number | null;
  application_rows: string;
}

export interface CloudDatabaseVerification {
  readonly database: string;
  readonly postgres_major: 17;
  readonly tls: "CA_AND_HOSTNAME_VERIFIED";
  readonly migrations: readonly string[];
  readonly delivery_enabled: false;
  readonly physical_hourly_ceiling: null;
  readonly application_rows: number;
}

export async function verifyCloudDatabase(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly migrationsDirectory: string;
  readonly expectEmpty?: boolean;
}): Promise<CloudDatabaseVerification> {
  const poolConfig = postgresPoolConfigFromEnvironment(input.environment, 1);
  if (poolConfig.ssl === undefined || poolConfig.ssl === false) {
    throw new Error("Cloud database verification requires a pinned TLS CA");
  }
  const pool = new Pool(poolConfig);
  try {
    const migrations = await expectedMigrations(input.migrationsDirectory);
    const applied = await pool.query<MigrationRow>(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
    );
    assertMigrations(migrations, applied.rows);

    const state = await pool.query<DatabaseState>(`
      SELECT
        current_database() AS database_name,
        current_setting('server_version_num') AS server_version_num,
        policy.delivery_enabled,
        policy.physical_hourly_ceiling,
        (
          (SELECT count(*) FROM people) +
          (SELECT count(*) FROM relationships) +
          (SELECT count(*) FROM relationship_invitations) +
          (SELECT count(*) FROM eject_grants) +
          (SELECT count(*) FROM eject_blocks) +
          (SELECT count(*) FROM recipient_access_policies) +
          (SELECT count(*) FROM recipient_entitlements) +
          (SELECT count(*) FROM registered_devices) +
          (SELECT count(*) FROM recipient_eject_state) +
          (SELECT count(*) FROM sender_eject_state) +
          (SELECT count(*) FROM eject_requests) +
          (SELECT count(*) FROM eject_commands) +
          (SELECT count(*) FROM eject_lifecycle_events) +
          (SELECT count(*) FROM device_enrollment_sessions) +
          (SELECT count(*) FROM device_keys) +
          (SELECT count(*) FROM device_request_nonces) +
          (SELECT count(*) FROM agent_results)
        )::text AS application_rows
      FROM system_delivery_policy AS policy
      WHERE policy.singleton = true
    `);
    const snapshot = state.rows[0];
    if (snapshot === undefined)
      throw new Error("Database safety row is missing");
    if (!snapshot.server_version_num.startsWith("17")) {
      throw new Error("Cloud database is not PostgreSQL 17");
    }
    if (snapshot.delivery_enabled) {
      throw new Error("Cloud database delivery must remain disabled");
    }
    if (snapshot.physical_hourly_ceiling !== null) {
      throw new Error("Cloud database physical ceiling must remain unset");
    }
    const applicationRows = Number(snapshot.application_rows);
    if (input.expectEmpty === true && applicationRows !== 0) {
      throw new Error("Cloud database contains EJECT application rows");
    }

    return {
      database: snapshot.database_name,
      postgres_major: 17,
      tls: "CA_AND_HOSTNAME_VERIFIED",
      migrations: migrations.map(({ filename }) => filename),
      delivery_enabled: false,
      physical_hourly_ceiling: null,
      application_rows: applicationRows,
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const verification = await verifyCloudDatabase({
    environment: process.env,
    migrationsDirectory: resolve(process.cwd(), "migrations"),
    expectEmpty: parseArguments(process.argv.slice(2)),
  });
  console.log(JSON.stringify(verification, null, 2));
}

function parseArguments(arguments_: readonly string[]): boolean {
  if (arguments_.length === 0) return false;
  if (arguments_.length === 1 && arguments_[0] === "--expect-empty")
    return true;
  throw new Error("Usage: npm run verify:cloud-database -- [--expect-empty]");
}

async function expectedMigrations(directory: string): Promise<MigrationRow[]> {
  const filenames = (await readdir(directory))
    .filter((filename) => migrationPattern.test(filename))
    .sort();
  return Promise.all(
    filenames.map(async (filename) => ({
      filename,
      checksum: createHash("sha256")
        .update(await readFile(resolve(directory, filename), "utf8"), "utf8")
        .digest("hex"),
    })),
  );
}

function assertMigrations(
  expected: readonly MigrationRow[],
  applied: readonly MigrationRow[],
): void {
  if (expected.length !== applied.length) {
    throw new Error(
      "Cloud database migration set does not match the repository",
    );
  }
  for (const [index, migration] of expected.entries()) {
    const actual = applied[index];
    if (
      actual === undefined ||
      actual.filename !== migration.filename ||
      actual.checksum !== migration.checksum
    ) {
      throw new Error(
        `Cloud database migration mismatch: ${migration.filename}`,
      );
    }
  }
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Cloud database verification failed",
    );
    process.exitCode = 1;
  });
}
