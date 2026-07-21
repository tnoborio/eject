import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";

interface PersonTable {
  person_id: string;
  display_name: string;
  account_status: string;
  participation_state: string;
  availability: string;
  created_at: Date;
}

interface EjectRequestTable {
  request_id: string;
  actor_id: string;
  recipient_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  action: string;
  reply_to_command_id: string | null;
  outcome: string;
  rejection_reason: string | null;
  command_id: string | null;
  created_at: Date;
}

export interface ControlPlaneDatabase {
  people: PersonTable;
  eject_requests: EjectRequestTable;
}

export function createPostgresDatabase(
  pool: Pool,
): Kysely<ControlPlaneDatabase> {
  return new Kysely<ControlPlaneDatabase>({
    dialect: new PostgresDialect({ pool }),
  });
}
