import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createCleanupRelationshipInvitations } from "../src/modules/permissions/application/manage-relationships";
import { PostgresRelationshipStore } from "../src/modules/permissions/infrastructure/postgres-relationship-store";
import { createPostgresDatabase } from "../src/infrastructure/postgres/database";
import { postgresPoolConfigFromEnvironment } from "../src/infrastructure/postgres/pool-config";

async function main(): Promise<void> {
  const pool = new Pool(postgresPoolConfigFromEnvironment(process.env, 1));
  const database = createPostgresDatabase(pool);
  try {
    const cleanup = createCleanupRelationshipInvitations({
      store: new PostgresRelationshipStore(database, randomUUID),
    });
    const deleted = await cleanup(new Date());
    console.log(JSON.stringify({ deleted }));
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Relationship invitation cleanup failed",
  );
  process.exitCode = 1;
});
