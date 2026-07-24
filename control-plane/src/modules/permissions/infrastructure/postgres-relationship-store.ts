import { sql, type Kysely, type Transaction } from "kysely";
import type { ControlPlaneDatabase } from "@/infrastructure/postgres/database";
import type { RelationshipStore } from "../application/manage-relationships";

interface DatabaseError {
  readonly code?: string;
}

export class PostgresRelationshipStore implements RelationshipStore {
  public constructor(
    private readonly database: Kysely<ControlPlaneDatabase>,
    private readonly maximumAttempts = 3,
  ) {}

  public async createInvitation(
    input: Parameters<RelationshipStore["createInvitation"]>[0],
  ): ReturnType<RelationshipStore["createInvitation"]> {
    return this.withRetry(async (transaction) => {
      const inviter = await sql<{ account_status: string }>`
        SELECT account_status FROM people
        WHERE person_id = ${input.inviterId}::uuid
        FOR UPDATE
      `.execute(transaction);
      if (inviter.rows[0]?.account_status !== "ACTIVE") {
        return "ACCOUNT_UNAVAILABLE";
      }

      await sql`
        UPDATE relationship_invitations
        SET invalidated_at = ${input.now}
        WHERE inviter_id = ${input.inviterId}::uuid
          AND used_at IS NULL
          AND invalidated_at IS NULL
      `.execute(transaction);
      await sql`
        INSERT INTO relationship_invitations (
          invitation_id, inviter_id, invitation_digest,
          expires_at, created_at
        ) VALUES (
          ${input.invitationId}::uuid, ${input.inviterId}::uuid,
          ${Buffer.from(input.invitationDigest)}::bytea,
          ${input.expiresAt}, ${input.now}
        )
      `.execute(transaction);
      return "CREATED";
    });
  }

  public async acceptInvitation(
    input: Parameters<RelationshipStore["acceptInvitation"]>[0],
  ): ReturnType<RelationshipStore["acceptInvitation"]> {
    return this.withRetry(async (transaction) => {
      const invitation = await sql<{
        invitation_id: string;
        inviter_id: string;
        expires_at: Date;
        used_at: Date | null;
        invalidated_at: Date | null;
      }>`
        SELECT invitation_id, inviter_id, expires_at, used_at, invalidated_at
        FROM relationship_invitations
        WHERE invitation_digest =
          ${Buffer.from(input.invitationDigest)}::bytea
        FOR UPDATE
      `.execute(transaction);
      const selected = invitation.rows[0];
      if (
        selected === undefined ||
        selected.used_at !== null ||
        selected.invalidated_at !== null ||
        selected.expires_at.getTime() <= input.now.getTime() ||
        selected.inviter_id === input.accepterId
      ) {
        return "INVITATION_UNAVAILABLE";
      }

      const people = await sql<{
        person_id: string;
        account_status: string;
      }>`
        SELECT person_id, account_status FROM people
        WHERE person_id IN (
          ${selected.inviter_id}::uuid, ${input.accepterId}::uuid
        )
        ORDER BY person_id
        FOR UPDATE
      `.execute(transaction);
      if (
        people.rows.length !== 2 ||
        people.rows.some((person) => person.account_status !== "ACTIVE")
      ) {
        return "INVITATION_UNAVAILABLE";
      }

      const lowId =
        selected.inviter_id < input.accepterId
          ? selected.inviter_id
          : input.accepterId;
      const highId =
        selected.inviter_id < input.accepterId
          ? input.accepterId
          : selected.inviter_id;
      const relationship = await sql<{ active: boolean }>`
        SELECT active FROM relationships
        WHERE person_low_id = ${lowId}::uuid
          AND person_high_id = ${highId}::uuid
        FOR UPDATE
      `.execute(transaction);
      if (relationship.rows[0]?.active === false) {
        return "INVITATION_UNAVAILABLE";
      }

      await sql`
        UPDATE relationship_invitations
        SET used_at = ${input.now}
        WHERE invitation_id = ${selected.invitation_id}::uuid
      `.execute(transaction);
      if (relationship.rows[0]?.active === true) {
        return "ALREADY_CONNECTED";
      }
      await sql`
        INSERT INTO relationships (
          person_low_id, person_high_id, active, created_at
        ) VALUES (
          ${lowId}::uuid, ${highId}::uuid, true, ${input.now}
        )
      `.execute(transaction);
      return "CONNECTED";
    });
  }

  private async withRetry<T>(
    operation: (transaction: Transaction<ControlPlaneDatabase>) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      try {
        return await this.database
          .transaction()
          .setIsolationLevel("serializable")
          .execute(operation);
      } catch (error: unknown) {
        if (!isRetryable(error) || attempt === this.maximumAttempts)
          throw error;
      }
    }
    throw new Error("Unreachable relationship retry state");
  }
}

function isRetryable(error: unknown): error is DatabaseError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "40001" || error.code === "40P01")
  );
}
