import { Pool, type PoolConfig } from "pg";

export function createVerificationPool(config: PoolConfig): Pool {
  const pool = new Pool(config);
  // pg removes failed idle clients itself. Consume the event so Node cannot
  // print err.client and its connection details as an uncaught exception.
  // Active query failures still reject and reach reportVerificationFailure.
  pool.on("error", () => undefined);
  return pool;
}
