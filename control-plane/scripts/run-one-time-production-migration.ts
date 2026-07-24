import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { migrate } from "../src/infrastructure/postgres/migrate";
import { postgresPoolConfigFromEnvironment } from "../src/infrastructure/postgres/pool-config";
import { cleanupRelationshipInvitations } from "./cleanup-relationship-invitations";
import {
  verifyCloudDatabase,
  type CloudDatabaseVerification,
} from "./verify-cloud-database";

type Environment = Readonly<Record<string, string | undefined>>;

const maximumCleanupBatches = 100;

export interface ProductionMigrationOperations {
  readonly migrate: (environment: Environment) => Promise<void>;
  readonly cleanup: (environment: Environment, now: Date) => Promise<number>;
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
      readonly deleted_invitations: number;
    });

export function prepareProductionMigrationEnvironment(
  environment: Environment,
): Environment | null {
  if (environment.VERCEL_ENV !== "production") return null;
  if (environment.VERCEL !== "1") {
    throw new Error("Production migration requires the Vercel build runtime");
  }
  if (environment.VERCEL_GIT_COMMIT_REF !== "main") {
    throw new Error("Production migration is restricted to the main branch");
  }
  if (environment.EJECT_AGENT_DELIVERY_ENABLED !== "false") {
    throw new Error("Production migration requires disabled agent delivery");
  }
  requireAbsent(environment, "EJECT_DEVICE_ENROLLMENT_ENABLED");
  requireAbsent(environment, "EJECT_SERVER_SIGNING_KEY_ID");
  requireAbsent(environment, "EJECT_SERVER_SIGNING_KEY_PKCS8_B64");
  if (
    environment.EJECT_DATABASE_SSL_CA_B64 === undefined ||
    environment.EJECT_DATABASE_SSL_CA_B64 === ""
  ) {
    throw new Error("Production migration requires the pinned database CA");
  }

  const databaseUrl = parseDatabaseUrl(environment.DATABASE_URL);
  if (
    !databaseUrl.hostname.endsWith(".pooler.supabase.com") ||
    databaseUrl.port !== "6543" ||
    databaseUrl.pathname !== "/postgres" ||
    databaseUrl.search !== "" ||
    databaseUrl.hash !== ""
  ) {
    throw new Error(
      "Production migration requires the expected Supabase transaction pooler",
    );
  }
  databaseUrl.port = "5432";

  return { ...environment, DATABASE_URL: databaseUrl.toString() };
}

export async function runOneTimeProductionMigration(input: {
  readonly environment: Environment;
  readonly now: Date;
  readonly operations: ProductionMigrationOperations;
}): Promise<ProductionMigrationResult> {
  const environment = prepareProductionMigrationEnvironment(input.environment);
  if (environment === null) return { production_migration: "SKIPPED" };

  await input.operations.migrate(environment);
  let deletedInvitations = 0;
  for (let batch = 0; batch < maximumCleanupBatches; batch += 1) {
    const deleted = await input.operations.cleanup(environment, input.now);
    deletedInvitations += deleted;
    if (deleted === 0) {
      const verification = await input.operations.verify(environment);
      return {
        production_migration: "APPLIED_AND_VERIFIED",
        ...verification,
        deleted_invitations: deletedInvitations,
      };
    }
  }
  throw new Error("Production invitation cleanup exceeded its bounded batches");
}

function requireAbsent(environment: Environment, name: string): void {
  const value = environment[name];
  if (value !== undefined && value !== "") {
    throw new Error(`Production migration requires ${name} to remain absent`);
  }
}

function parseDatabaseUrl(value: string | undefined): URL {
  if (value === undefined || value === "") {
    throw new Error("Production migration requires DATABASE_URL");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
    return url;
  } catch {
    throw new Error("Production migration requires a PostgreSQL DATABASE_URL");
  }
}

async function main(): Promise<void> {
  const migrationsDirectory = resolve(process.cwd(), "migrations");
  const result = await runOneTimeProductionMigration({
    environment: process.env,
    now: new Date(),
    operations: {
      migrate: async (environment) => {
        const pool = new Pool(
          postgresPoolConfigFromEnvironment(environment, 1),
        );
        try {
          await migrate(pool, migrationsDirectory);
        } finally {
          await pool.end();
        }
      },
      cleanup: (environment, now) =>
        cleanupRelationshipInvitations({ environment, now }),
      verify: (environment) =>
        verifyCloudDatabase({ environment, migrationsDirectory }),
    },
  });
  console.log(JSON.stringify(result, null, 2));
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
        : "Production migration hook failed",
    );
    process.exitCode = 1;
  });
}
