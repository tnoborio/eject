import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
import { createVerificationPool } from "./verification-pool";
import { migrate } from "../src/infrastructure/postgres/migrate";
import { postgresPoolConfigFromEnvironment } from "../src/infrastructure/postgres/pool-config";
import {
  VerificationError,
  reportVerificationFailure,
} from "./verification-error";
import {
  verifyCloudDatabase,
  type CloudDatabaseVerification,
} from "./verify-cloud-database";

type Environment = Readonly<Record<string, string | undefined>>;

export interface ProductionMigrationPreflight {
  readonly rolbypassrls: boolean;
  readonly public_tables_owned_by_other_roles: number;
}

export interface ProductionMigrationOperations {
  readonly migrate: (environment: Environment) => Promise<void>;
  readonly preflight: (
    environment: Environment,
  ) => Promise<ProductionMigrationPreflight>;
  readonly verify: (
    environment: Environment,
  ) => Promise<CloudDatabaseVerification>;
}

export type ProductionMigrationResult =
  | {
      readonly production_migration: "SKIPPED";
    }
  | (CloudDatabaseVerification & {
      readonly production_migration: "APPLIED_AND_VERIFIED";
      readonly preflight: ProductionMigrationPreflight;
    });

export function prepareProductionMigrationEnvironment(
  environment: Environment,
): Environment | null {
  if (environment.VERCEL_ENV !== "production") return null;
  if (environment.VERCEL !== "1") {
    throw new VerificationError(
      "Production migration requires the Vercel build runtime",
    );
  }
  if (environment.VERCEL_GIT_COMMIT_REF !== "main") {
    throw new VerificationError(
      "Production migration is restricted to the main branch",
    );
  }
  if (environment.EJECT_AGENT_DELIVERY_ENABLED !== "false") {
    throw new VerificationError(
      "Production migration requires disabled agent delivery",
    );
  }
  requireAbsent(environment, "EJECT_DEVICE_ENROLLMENT_ENABLED");
  requireAbsent(environment, "EJECT_SERVER_SIGNING_KEY_ID");
  requireAbsent(environment, "EJECT_SERVER_SIGNING_KEY_PKCS8_B64");
  if (
    environment.EJECT_DATABASE_SSL_CA_B64 === undefined ||
    environment.EJECT_DATABASE_SSL_CA_B64 === ""
  ) {
    throw new VerificationError(
      "Production migration requires the pinned database CA",
    );
  }

  const databaseUrl = parseDatabaseUrl(environment.DATABASE_URL);
  if (
    !databaseUrl.hostname.endsWith(".pooler.supabase.com") ||
    databaseUrl.port !== "6543" ||
    databaseUrl.pathname !== "/postgres" ||
    databaseUrl.search !== "" ||
    databaseUrl.hash !== "" ||
    databaseUrl.href.includes("?") ||
    databaseUrl.href.includes("#")
  ) {
    throw new VerificationError(
      "Production migration requires the expected Supabase transaction pooler",
    );
  }
  databaseUrl.port = "5432";

  return { ...environment, DATABASE_URL: databaseUrl.toString() };
}

export async function runOneTimeProductionMigration(input: {
  readonly environment: Environment;
  readonly operations: ProductionMigrationOperations;
}): Promise<ProductionMigrationResult> {
  const environment = prepareProductionMigrationEnvironment(input.environment);
  if (environment === null) return { production_migration: "SKIPPED" };

  const preflight = await input.operations.preflight(environment);
  if (
    !preflight.rolbypassrls &&
    preflight.public_tables_owned_by_other_roles !== 0
  ) {
    throw new VerificationError(
      "Production migration role preflight requires bypass or ownership",
    );
  }
  await input.operations.migrate(environment);
  const verification = await input.operations.verify(environment);
  return {
    production_migration: "APPLIED_AND_VERIFIED",
    preflight,
    ...verification,
  };
}

// Use one session for the complete read-only transaction, before migrate can write.
export async function inspectProductionMigrationRole(
  client: Pick<PoolClient, "query">,
): Promise<ProductionMigrationPreflight> {
  await client.query("BEGIN READ ONLY");
  try {
    const result = await client.query<{
      rolbypassrls: boolean;
      public_tables_owned_by_other_roles: string;
    }>(`
      SELECT r.rolbypassrls,
             (SELECT count(*) FROM pg_class AS c
              JOIN pg_namespace AS n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                AND c.relowner <> r.oid) AS public_tables_owned_by_other_roles
      FROM pg_roles AS r
      WHERE r.rolname = current_user
    `);
    const row = result.rows[0];
    const count = Number(row?.public_tables_owned_by_other_roles);
    if (
      row === undefined ||
      typeof row.rolbypassrls !== "boolean" ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw new VerificationError(
        "Production migration role preflight is invalid",
      );
    }
    await client.query("COMMIT");
    return {
      rolbypassrls: row.rolbypassrls,
      public_tables_owned_by_other_roles: count,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function requireAbsent(environment: Environment, name: string): void {
  const value = environment[name];
  if (value !== undefined && value !== "") {
    throw new VerificationError(
      `Production migration requires ${name} to remain absent`,
    );
  }
}

function parseDatabaseUrl(value: string | undefined): URL {
  if (value === undefined || value === "") {
    throw new VerificationError("Production migration requires DATABASE_URL");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new VerificationError("unsupported protocol");
    }
    return url;
  } catch {
    throw new VerificationError(
      "Production migration requires a PostgreSQL DATABASE_URL",
    );
  }
}

async function main(): Promise<void> {
  const migrationsDirectory = resolve(process.cwd(), "migrations");
  const result = await runOneTimeProductionMigration({
    environment: process.env,
    operations: {
      preflight: async (environment) => {
        const pool = createVerificationPool(
          postgresPoolConfigFromEnvironment(environment, 1),
        );
        try {
          const client = await pool.connect();
          try {
            return await inspectProductionMigrationRole(client);
          } finally {
            client.release();
          }
        } finally {
          await pool.end();
        }
      },
      migrate: async (environment) => {
        const pool = createVerificationPool(
          postgresPoolConfigFromEnvironment(environment, 1),
        );
        try {
          await migrate(pool, migrationsDirectory);
        } finally {
          await pool.end();
        }
      },
      verify: (environment) =>
        verifyCloudDatabase({ environment, migrationsDirectory }),
    },
  });
  console.log(JSON.stringify(result, null, 2));
}

// Do not inspect unexpected process failures, even dedicated error types:
// they may carry connection details or come from outside the verified path.
export function reportUnexpectedProductionMigrationFailure(): never {
  console.error("Production migration hook failed");
  process.exit(1);
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  process.on("uncaughtException", reportUnexpectedProductionMigrationFailure);
  process.on("unhandledRejection", reportUnexpectedProductionMigrationFailure);
  void main().catch(reportVerificationFailure);
}
