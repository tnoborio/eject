import type { Kysely } from "kysely";
import type { ControlPlaneDatabase } from "@/infrastructure/postgres/database";
import type {
  PersonAccountReader,
  PersonAccountStatus,
} from "../application/authenticate-person-session";

export class PostgresPersonAccountReader implements PersonAccountReader {
  constructor(private readonly database: Kysely<ControlPlaneDatabase>) {}

  async loadAccountStatus(
    personId: string,
  ): Promise<PersonAccountStatus | null> {
    const person = await this.database
      .selectFrom("people")
      .select("account_status")
      .where("person_id", "=", personId)
      .executeTakeFirst();

    if (person === undefined) return null;
    if (
      person.account_status === "ACTIVE" ||
      person.account_status === "RESTRICTED"
    ) {
      return person.account_status;
    }
    throw new Error("Unknown person account status");
  }
}
