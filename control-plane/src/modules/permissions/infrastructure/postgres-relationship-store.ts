import { sql, type Kysely, type Transaction } from "kysely";
import type { ControlPlaneDatabase } from "@/infrastructure/postgres/database";
import type { RelationshipStore } from "../application/manage-relationships";

interface DatabaseError {
  readonly code?: string;
}

export class PostgresRelationshipStore implements RelationshipStore {
  public constructor(
    private readonly database: Kysely<ControlPlaneDatabase>,
    private readonly newId: () => string,
    private readonly maximumAttempts = 3,
  ) {}

  public async createInvitation(
    input: Parameters<RelationshipStore["createInvitation"]>[0],
  ): ReturnType<RelationshipStore["createInvitation"]> {
    return this.withRetry(async (transaction) => {
      await this.cleanupInTransaction(
        transaction,
        new Date(input.now.getTime() - 24 * 60 * 60_000),
        100,
      );
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
      await this.cleanupInTransaction(
        transaction,
        new Date(input.now.getTime() - 24 * 60 * 60_000),
        100,
      );
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

      await sql`
        UPDATE relationship_invitations
        SET used_at = ${input.now}
        WHERE invitation_id = ${selected.invitation_id}::uuid
      `.execute(transaction);
      if (relationship.rows[0]?.active === true) {
        return "ALREADY_CONNECTED";
      }
      if (relationship.rows[0]?.active === false) {
        await sql`
          DELETE FROM eject_grants
          WHERE (recipient_id = ${lowId}::uuid AND actor_id = ${highId}::uuid)
             OR (recipient_id = ${highId}::uuid AND actor_id = ${lowId}::uuid)
        `.execute(transaction);
        await sql`
          UPDATE relationships
          SET active = true, created_at = ${input.now}, ended_at = NULL
          WHERE person_low_id = ${lowId}::uuid
            AND person_high_id = ${highId}::uuid
        `.execute(transaction);
        return "CONNECTED";
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

  public async disconnectRelationship(
    input: Parameters<RelationshipStore["disconnectRelationship"]>[0],
  ): ReturnType<RelationshipStore["disconnectRelationship"]> {
    const lowId =
      input.personId < input.otherPersonId
        ? input.personId
        : input.otherPersonId;
    const highId =
      input.personId < input.otherPersonId
        ? input.otherPersonId
        : input.personId;
    return this.withRetry(async (transaction) => {
      await sql`
        INSERT INTO recipient_eject_state (
          recipient_id, window_started_at
        )
        SELECT person_id, ${input.now}
        FROM people
        WHERE person_id IN (${lowId}::uuid, ${highId}::uuid)
        ON CONFLICT (recipient_id) DO NOTHING
      `.execute(transaction);
      const lockedPeople = await sql<{ recipient_id: string }>`
        SELECT recipient_id FROM recipient_eject_state
        WHERE recipient_id IN (${lowId}::uuid, ${highId}::uuid)
        ORDER BY recipient_id
        FOR UPDATE
      `.execute(transaction);
      if (lockedPeople.rows.length !== 2) return "UNCHANGED";

      const relationship = await sql<{ active: boolean }>`
        SELECT active FROM relationships
        WHERE person_low_id = ${lowId}::uuid
          AND person_high_id = ${highId}::uuid
        FOR UPDATE
      `.execute(transaction);
      if (relationship.rows[0]?.active !== true) return "UNCHANGED";

      await sql`
        UPDATE relationships
        SET active = false, ended_at = ${input.now}
        WHERE person_low_id = ${lowId}::uuid
          AND person_high_id = ${highId}::uuid
      `.execute(transaction);
      await sql`
        DELETE FROM eject_grants
        WHERE (recipient_id = ${lowId}::uuid AND actor_id = ${highId}::uuid)
           OR (recipient_id = ${highId}::uuid AND actor_id = ${lowId}::uuid)
      `.execute(transaction);
      const commands = await sql<{
        command_id: string;
        request_id: string;
      }>`
        SELECT command_id, request_id FROM eject_commands
        WHERE (
          (recipient_id = ${lowId}::uuid AND actor_id = ${highId}::uuid)
          OR
          (recipient_id = ${highId}::uuid AND actor_id = ${lowId}::uuid)
        )
          AND status IN ('QUEUED', 'DISPATCHED')
        ORDER BY recipient_id, command_id
        FOR UPDATE
      `.execute(transaction);
      for (const command of commands.rows) {
        await sql`
          UPDATE eject_commands
          SET status = 'CANCELLED',
              cancellation_reason = 'PERMISSION_REVOKED'
          WHERE command_id = ${command.command_id}::uuid
        `.execute(transaction);
        await sql`
          INSERT INTO eject_lifecycle_events (
            event_id, request_id, command_id, state, reason_code, occurred_at
          ) VALUES (
            ${this.newId()}::uuid, ${command.request_id}::uuid,
            ${command.command_id}::uuid, 'CANCELLED',
            'PERMISSION_REVOKED', ${input.now}
          )
        `.execute(transaction);
      }
      return "DISCONNECTED";
    });
  }

  public async cleanupInvitations(
    input: Parameters<RelationshipStore["cleanupInvitations"]>[0],
  ): ReturnType<RelationshipStore["cleanupInvitations"]> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 500
    ) {
      throw new Error("Relationship invitation cleanup limit is invalid");
    }
    return this.withRetry((transaction) =>
      this.cleanupInTransaction(transaction, input.before, input.limit),
    );
  }

  private async cleanupInTransaction(
    transaction: Transaction<ControlPlaneDatabase>,
    before: Date,
    limit: number,
  ): Promise<number> {
    const deleted = await sql<{ invitation_id: string }>`
      WITH stale AS (
        SELECT invitation_id
        FROM relationship_invitations
        WHERE COALESCE(used_at, invalidated_at, expires_at) < ${before}
        ORDER BY COALESCE(used_at, invalidated_at, expires_at), invitation_id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM relationship_invitations invitation
      USING stale
      WHERE invitation.invitation_id = stale.invitation_id
      RETURNING invitation.invitation_id
    `.execute(transaction);
    return deleted.rows.length;
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
