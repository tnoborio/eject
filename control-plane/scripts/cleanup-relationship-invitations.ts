import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { createCleanupRelationshipInvitations } from "../src/modules/permissions/application/manage-relationships";
import { PostgresRelationshipStore } from "../src/modules/permissions/infrastructure/postgres-relationship-store";
import { createPostgresDatabase } from "../src/infrastructure/postgres/database";
import { postgresPoolConfigFromEnvironment } from "../src/infrastructure/postgres/pool-config";

export async function cleanupRelationshipInvitations(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly now: Date;
}): Promise<number> {
  const pool = new Pool(
    postgresPoolConfigFromEnvironment(input.environment, 1),
  );
  const database = createPostgresDatabase(pool);
  try {
    const cleanup = createCleanupRelationshipInvitations({
      store: new PostgresRelationshipStore(database, randomUUID),
    });
    return await cleanup(input.now);
  } finally {
    await database.destroy();
  }
}

async function main(): Promise<void> {
  const deleted = await cleanupRelationshipInvitations({
    environment: process.env,
    now: new Date(),
  });
  console.log(JSON.stringify({ deleted }));
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
        : "Relationship invitation cleanup failed",
    );
    process.exitCode = 1;
  });
}
