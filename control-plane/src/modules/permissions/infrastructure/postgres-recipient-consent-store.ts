import { sql, type Kysely, type Transaction } from "kysely";
import type { ControlPlaneDatabase } from "@/infrastructure/postgres/database";
import type {
  RecipientConsentSnapshot,
  RecipientConsentStore,
  SetRecipientGrantResult,
} from "../application/manage-recipient-consent";

interface DatabaseError {
  readonly code?: string;
}

export class PostgresRecipientConsentStore implements RecipientConsentStore {
  public constructor(
    private readonly database: Kysely<ControlPlaneDatabase>,
    private readonly newId: () => string,
    private readonly maximumAttempts = 3,
  ) {}

  public async read(recipientId: string): Promise<RecipientConsentSnapshot> {
    const policy = await sql<{ paused: boolean }>`
      SELECT paused FROM recipient_access_policies
      WHERE recipient_id = ${recipientId}::uuid
    `.execute(this.database);
    const people = await sql<{
      person_id: string;
      display_name: string;
      account_available: boolean;
      grant_active: boolean;
    }>`
      SELECT connected.person_id, connected.display_name,
        (connected.account_status = 'ACTIVE') AS account_available,
        EXISTS (
          SELECT 1 FROM eject_grants grant_row
          WHERE grant_row.recipient_id = ${recipientId}::uuid
            AND grant_row.actor_id = connected.person_id
        ) AS grant_active
      FROM relationships relationship
      JOIN people connected ON connected.person_id = CASE
        WHEN relationship.person_low_id = ${recipientId}::uuid
          THEN relationship.person_high_id
        ELSE relationship.person_low_id
      END
      WHERE relationship.active
        AND (
          relationship.person_low_id = ${recipientId}::uuid
          OR relationship.person_high_id = ${recipientId}::uuid
        )
      ORDER BY connected.person_id
    `.execute(this.database);
    return {
      paused: policy.rows[0]?.paused ?? false,
      connectedPeople: people.rows.map((person) => ({
        personId: person.person_id,
        displayName: person.display_name,
        grantActive: person.grant_active,
        accountAvailable: person.account_available,
      })),
    };
  }

  public async setPaused(
    input: Parameters<RecipientConsentStore["setPaused"]>[0],
  ): Promise<void> {
    await this.withRecipientLock(input.recipientId, async (transaction) => {
      await sql`
        INSERT INTO recipient_access_policies (
          recipient_id, paused, updated_at
        ) VALUES (
          ${input.recipientId}::uuid, ${input.paused}, ${input.now}
        )
        ON CONFLICT (recipient_id) DO UPDATE
        SET paused = EXCLUDED.paused, updated_at = EXCLUDED.updated_at
      `.execute(transaction);
      if (input.paused) {
        await this.cancelOutstanding(
          transaction,
          input.recipientId,
          null,
          input.now,
        );
      }
    });
  }

  public async setGrant(
    input: Parameters<RecipientConsentStore["setGrant"]>[0],
  ): Promise<SetRecipientGrantResult> {
    return this.withRecipientLock(input.recipientId, async (transaction) => {
      await sql`
        INSERT INTO recipient_access_policies (recipient_id, updated_at)
        VALUES (${input.recipientId}::uuid, ${input.now})
        ON CONFLICT (recipient_id) DO NOTHING
      `.execute(transaction);
      if (input.granted) {
        const connection = await sql<{ eligible: boolean }>`
            SELECT EXISTS (
              SELECT 1
              FROM relationships relationship
              JOIN people actor ON actor.person_id = ${input.actorId}::uuid
              WHERE relationship.person_low_id =
                  LEAST(${input.recipientId}::uuid, ${input.actorId}::uuid)
                AND relationship.person_high_id =
                  GREATEST(${input.recipientId}::uuid, ${input.actorId}::uuid)
                AND relationship.active
                AND actor.account_status = 'ACTIVE'
            ) AS eligible
          `.execute(transaction);
        if (!connection.rows[0]?.eligible) return "CONNECTION_REQUIRED";
        await sql`
            INSERT INTO eject_grants (recipient_id, actor_id, created_at)
            VALUES (
              ${input.recipientId}::uuid, ${input.actorId}::uuid, ${input.now}
            )
            ON CONFLICT (recipient_id, actor_id) DO NOTHING
          `.execute(transaction);
        return "UPDATED";
      }

      await sql`
          DELETE FROM eject_grants
          WHERE recipient_id = ${input.recipientId}::uuid
            AND actor_id = ${input.actorId}::uuid
        `.execute(transaction);
      await this.cancelOutstanding(
        transaction,
        input.recipientId,
        input.actorId,
        input.now,
      );
      return "UPDATED";
    });
  }

  private async cancelOutstanding(
    transaction: Transaction<ControlPlaneDatabase>,
    recipientId: string,
    actorId: string | null,
    now: Date,
  ): Promise<void> {
    const commands = await sql<{ command_id: string; request_id: string }>`
      SELECT command_id, request_id FROM eject_commands
      WHERE recipient_id = ${recipientId}::uuid
        AND (${actorId}::uuid IS NULL OR actor_id = ${actorId}::uuid)
        AND status IN ('QUEUED', 'DISPATCHED')
      ORDER BY command_id
      FOR UPDATE
    `.execute(transaction);
    for (const command of commands.rows) {
      await sql`
        UPDATE eject_commands
        SET status = 'CANCELLED', cancellation_reason = 'PERMISSION_REVOKED'
        WHERE command_id = ${command.command_id}::uuid
      `.execute(transaction);
      await sql`
        INSERT INTO eject_lifecycle_events (
          event_id, request_id, command_id, state, reason_code, occurred_at
        ) VALUES (
          ${this.newId()}::uuid, ${command.request_id}::uuid,
          ${command.command_id}::uuid, 'CANCELLED', 'PERMISSION_REVOKED', ${now}
        )
      `.execute(transaction);
    }
  }

  private async withRecipientLock<T>(
    recipientId: string,
    operation: (transaction: Transaction<ControlPlaneDatabase>) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      try {
        return await this.database
          .transaction()
          .setIsolationLevel("serializable")
          .execute(async (transaction) => {
            await sql`
              INSERT INTO recipient_eject_state (
                recipient_id, window_started_at
              )
              SELECT person_id, CURRENT_TIMESTAMP
              FROM people
              WHERE person_id = ${recipientId}::uuid
              ON CONFLICT (recipient_id) DO NOTHING
            `.execute(transaction);
            const locked = await sql<{ recipient_id: string }>`
              SELECT recipient_id FROM recipient_eject_state
              WHERE recipient_id = ${recipientId}::uuid
              FOR UPDATE
            `.execute(transaction);
            if (locked.rows[0] === undefined) {
              throw new Error("Recipient consent owner is unavailable");
            }
            return operation(transaction);
          });
      } catch (error: unknown) {
        if (!isRetryable(error) || attempt === this.maximumAttempts)
          throw error;
      }
    }
    throw new Error("Unreachable recipient-consent retry state");
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
