import { Pool } from "pg";
import { createPostgresDatabase } from "@/infrastructure/postgres/database";
import { postgresPoolConfigFromEnvironment } from "@/infrastructure/postgres/pool-config";

interface RuntimeDatabaseGlobal {
  pool?: Pool;
  database?: ReturnType<typeof createPostgresDatabase>;
}

const shared = globalThis as typeof globalThis & {
  ejectRuntimeDatabase?: RuntimeDatabaseGlobal;
};

export function getRuntimeDatabase(): ReturnType<
  typeof createPostgresDatabase
> {
  const state = (shared.ejectRuntimeDatabase ??= {});
  if (state.database !== undefined) return state.database;
  const pool = (state.pool ??= new Pool(
    postgresPoolConfigFromEnvironment(process.env, 5),
  ));
  return (state.database = createPostgresDatabase(pool));
}
