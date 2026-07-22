import { sql, type Kysely, type Transaction } from "kysely";
import type {
  IssueEjectInput,
  IssueEjectResult,
  IssuanceStore,
  IssuanceTransaction,
  StoredIdempotentResult,
} from "../application/issue-eject";
import type {
  AuthorizationFacts,
  AudienceScope,
  Availability,
  ParticipationState,
  RejectionReason,
  SenderEligibility,
} from "../domain/authorization";
import type { ControlPlaneDatabase } from "@/infrastructure/postgres/database";

interface FactRow {
  actor_restricted: boolean;
  actor_participation: ParticipationState;
  actor_availability: Availability;
  audience_scope: AudienceScope;
  sender_eligibility: SenderEligibility;
  relationship_active: boolean;
  directional_grant_active: boolean;
  blocked: boolean;
  recipient_paused: boolean;
  cooldown_until: Date | null;
  recipient_count: number;
  sender_count: number;
  sender_limit: number;
  recipient_limit: number;
  plan_limit: number;
  physical_limit: number;
  delivery_enabled: boolean;
  device_id: string | null;
  device_eligible: boolean;
  eject_back_valid: boolean;
  cooldown_seconds: number;
}

interface StoredRow {
  request_fingerprint: string;
  outcome: "REJECTED" | "QUEUED";
  request_id: string;
  command_id: string | null;
  rejection_reason: RejectionReason | null;
}

export class PostgresIssuanceStore implements IssuanceStore {
  public constructor(
    private readonly database: Kysely<ControlPlaneDatabase>,
    private readonly maximumAttempts = 3,
  ) {}

  public async withSerializableRecipientLock<T>(
    recipientId: string,
    operation: (transaction: IssuanceTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      try {
        return await this.database
          .transaction()
          .setIsolationLevel("serializable")
          .execute(async (transaction) => {
            await sql`
              INSERT INTO recipient_eject_state (recipient_id, window_started_at)
              SELECT person_id, CURRENT_TIMESTAMP FROM people WHERE person_id = ${recipientId}::uuid
              ON CONFLICT (recipient_id) DO NOTHING
            `.execute(transaction);
            await sql`
              SELECT recipient_id FROM recipient_eject_state
              WHERE recipient_id = ${recipientId}::uuid
              FOR UPDATE
            `.execute(transaction);
            return operation(new PostgresIssuanceTransaction(transaction));
          });
      } catch (error) {
        if (!isRetryable(error) || attempt === this.maximumAttempts) {
          throw error;
        }
      }
    }

    throw new Error("Unreachable serialization retry state");
  }
}

class PostgresIssuanceTransaction implements IssuanceTransaction {
  private deviceId: string | null = null;
  private cooldownSeconds = 0;

  public constructor(
    private readonly transaction: Transaction<ControlPlaneDatabase>,
  ) {}

  public async findIdempotentResult(
    actorId: string,
    idempotencyKey: string,
  ): Promise<StoredIdempotentResult | null> {
    const result = await sql<StoredRow>`
      SELECT request_fingerprint, outcome, request_id, command_id, rejection_reason
      FROM eject_requests
      WHERE actor_id = ${actorId}::uuid AND idempotency_key = ${idempotencyKey}::uuid
    `.execute(this.transaction);
    const row = result.rows[0];
    if (row === undefined) return null;

    const common = { requestId: row.request_id };
    const storedResult: Exclude<
      IssueEjectResult,
      { outcome: "IDEMPOTENCY_CONFLICT" }
    > =
      row.outcome === "QUEUED"
        ? {
            outcome: "QUEUED",
            ...common,
            commandId: requireValue(row.command_id),
          }
        : {
            outcome: "REJECTED",
            ...common,
            reason: requireValue(row.rejection_reason),
          };
    return { fingerprint: row.request_fingerprint, result: storedResult };
  }

  public async loadAuthorizationFacts(
    input: IssueEjectInput,
  ): Promise<AuthorizationFacts> {
    await sql`
      INSERT INTO sender_eject_state (actor_id, window_started_at)
      SELECT person_id, ${input.now} FROM people WHERE person_id = ${input.actorId}::uuid
      ON CONFLICT (actor_id) DO NOTHING
    `.execute(this.transaction);
    await sql`
      SELECT actor_id FROM sender_eject_state WHERE actor_id = ${input.actorId}::uuid FOR UPDATE
    `.execute(this.transaction);

    const result = await sql<FactRow>`
      SELECT
        (actor.account_status = 'RESTRICTED') AS actor_restricted,
        actor.participation_state AS actor_participation,
        actor.availability AS actor_availability,
        policy.audience_scope,
        policy.sender_eligibility,
        EXISTS (
          SELECT 1 FROM relationships relationship
          WHERE relationship.person_low_id = LEAST(${input.actorId}::uuid, ${input.recipientId}::uuid)
            AND relationship.person_high_id = GREATEST(${input.actorId}::uuid, ${input.recipientId}::uuid)
            AND relationship.active
        ) AS relationship_active,
        EXISTS (SELECT 1 FROM eject_grants grant_row WHERE grant_row.recipient_id = ${input.recipientId}::uuid AND grant_row.actor_id = ${input.actorId}::uuid) AS directional_grant_active,
        EXISTS (SELECT 1 FROM eject_blocks block_row WHERE block_row.recipient_id = ${input.recipientId}::uuid AND block_row.actor_id = ${input.actorId}::uuid) AS blocked,
        policy.paused AS recipient_paused,
        recipient_state.cooldown_until,
        CASE WHEN recipient_state.window_started_at <= ${input.now}::timestamptz - interval '1 hour' THEN 0 ELSE recipient_state.accepted_in_window END::integer AS recipient_count,
        CASE WHEN sender_state.window_started_at <= ${input.now}::timestamptz - interval '1 hour' THEN 0 ELSE sender_state.accepted_in_window END::integer AS sender_count,
        sender_state.hourly_limit::integer AS sender_limit,
        policy.selected_hourly_limit::integer AS recipient_limit,
        CASE WHEN entitlement.valid_until IS NULL OR entitlement.valid_until > ${input.now}::timestamptz THEN COALESCE(entitlement.inbound_hourly_ceiling, 0) ELSE 0 END::integer AS plan_limit,
        COALESCE(system_policy.physical_hourly_ceiling, 0)::integer AS physical_limit,
        system_policy.delivery_enabled,
        device.device_id,
        (device.enrollment_state = 'READY' AND device.availability = 'AVAILABLE' AND device.has_approved_drive) AS device_eligible,
        EXISTS (
          SELECT 1 FROM eject_commands source
          WHERE source.command_id = ${input.replyToCommandId}::uuid
            AND source.actor_id = ${input.recipientId}::uuid
            AND source.recipient_id = ${input.actorId}::uuid
            AND source.status NOT IN ('CANCELLED', 'EXPIRED')
            AND NOT EXISTS (SELECT 1 FROM eject_commands reply WHERE reply.reply_to_command_id = source.command_id)
        ) AS eject_back_valid,
        policy.cooldown_seconds::integer
      FROM people actor
      JOIN recipient_access_policies policy ON policy.recipient_id = ${input.recipientId}::uuid
      JOIN recipient_eject_state recipient_state ON recipient_state.recipient_id = policy.recipient_id
      JOIN sender_eject_state sender_state ON sender_state.actor_id = actor.person_id
      JOIN system_delivery_policy system_policy ON system_policy.singleton
      LEFT JOIN recipient_entitlements entitlement ON entitlement.recipient_id = policy.recipient_id
      LEFT JOIN registered_devices device
        ON device.owner_id = policy.recipient_id
        AND device.enrollment_state <> 'REVOKED'
      WHERE actor.person_id = ${input.actorId}::uuid
    `.execute(this.transaction);
    const row = requireValue(result.rows[0]);
    this.deviceId = row.device_id;
    this.cooldownSeconds = row.cooldown_seconds;

    return {
      actorAuthenticated: true,
      actorRestricted: row.actor_restricted,
      actorParticipation: row.actor_participation,
      actorAvailability: row.actor_availability,
      audienceScope: row.audience_scope,
      senderEligibility: row.sender_eligibility,
      relationshipActive: row.relationship_active,
      directionalGrantActive: row.directional_grant_active,
      blocked: row.blocked,
      recipientPaused: row.recipient_paused,
      quietHoursActive: false,
      cooldownUntil: row.cooldown_until,
      recipientAcceptedInWindow: row.recipient_count,
      senderAcceptedInWindow: row.sender_count,
      senderLimit: row.sender_limit,
      exposureCeilings: {
        recipientSelected: row.recipient_limit,
        planEntitlement: row.plan_limit,
        physicalSafety: row.physical_limit,
      },
      deviceEligible: row.device_eligible,
      deliveryEnabled: row.delivery_enabled,
      requestKind: input.action === "EJECT" ? "STANDARD" : "EJECT_BACK",
      ejectBackValid: row.eject_back_valid,
    };
  }

  public async recordRejection(
    input: Parameters<IssuanceTransaction["recordRejection"]>[0],
  ): Promise<IssueEjectResult & { outcome: "REJECTED" }> {
    await sql`
      INSERT INTO eject_requests (
        request_id, actor_id, recipient_id, idempotency_key, request_fingerprint,
        action, reply_to_command_id, outcome, rejection_reason, created_at
      ) VALUES (
        ${input.requestId}::uuid, ${input.issue.actorId}::uuid, ${input.issue.recipientId}::uuid,
        ${input.issue.idempotencyKey}::uuid, ${input.fingerprint}, ${input.issue.action},
        ${input.issue.replyToCommandId}::uuid, 'REJECTED', ${input.reason}, ${input.issue.now}
      )
    `.execute(this.transaction);
    await this.insertEvent(
      input.requestedEventId,
      input.requestId,
      input.requestId,
      "REQUESTED",
      null,
      input.issue.now,
    );
    await this.insertEvent(
      input.rejectedEventId,
      input.requestId,
      input.requestId,
      "REJECTED",
      input.reason,
      input.issue.now,
    );
    return {
      outcome: "REJECTED",
      requestId: input.requestId,
      reason: input.reason,
    };
  }

  public async recordQueued(
    input: Parameters<IssuanceTransaction["recordQueued"]>[0],
  ): Promise<IssueEjectResult & { outcome: "QUEUED" }> {
    const deviceId = requireValue(this.deviceId);
    const expiresAt = new Date(input.issue.now.getTime() + 30_000);
    await sql`
      INSERT INTO eject_requests (
        request_id, actor_id, recipient_id, idempotency_key, request_fingerprint,
        action, reply_to_command_id, outcome, command_id, created_at
      ) VALUES (
        ${input.requestId}::uuid, ${input.issue.actorId}::uuid, ${input.issue.recipientId}::uuid,
        ${input.issue.idempotencyKey}::uuid, ${input.fingerprint}, ${input.issue.action},
        ${input.issue.replyToCommandId}::uuid, 'QUEUED', ${input.commandId}::uuid, ${input.issue.now}
      )
    `.execute(this.transaction);
    await sql`
      INSERT INTO eject_commands (
        command_id, request_id, actor_id, recipient_id, device_id, reply_to_command_id,
        issued_at, expires_at
      ) VALUES (
        ${input.commandId}::uuid, ${input.requestId}::uuid, ${input.issue.actorId}::uuid,
        ${input.issue.recipientId}::uuid, ${deviceId}::uuid, ${input.issue.replyToCommandId}::uuid,
        ${input.issue.now}, ${expiresAt}
      )
    `.execute(this.transaction);
    await this.insertEvent(
      input.requestedEventId,
      input.requestId,
      input.commandId,
      "REQUESTED",
      null,
      input.issue.now,
    );
    await this.insertEvent(
      input.authorizedEventId,
      input.requestId,
      input.commandId,
      "AUTHORIZED",
      null,
      input.issue.now,
    );
    await this.insertEvent(
      input.queuedEventId,
      input.requestId,
      input.commandId,
      "QUEUED",
      null,
      input.issue.now,
    );
    await sql`
      UPDATE recipient_eject_state SET
        window_started_at = CASE WHEN window_started_at <= ${input.issue.now}::timestamptz - interval '1 hour' THEN ${input.issue.now}::timestamptz ELSE window_started_at END,
        accepted_in_window = CASE WHEN window_started_at <= ${input.issue.now}::timestamptz - interval '1 hour' THEN 1 ELSE accepted_in_window + 1 END,
        cooldown_until = ${input.issue.now}::timestamptz + make_interval(secs => ${this.cooldownSeconds}),
        revision = revision + 1,
        updated_at = ${input.issue.now}
      WHERE recipient_id = ${input.issue.recipientId}::uuid
    `.execute(this.transaction);
    await sql`
      UPDATE sender_eject_state SET
        window_started_at = CASE WHEN window_started_at <= ${input.issue.now}::timestamptz - interval '1 hour' THEN ${input.issue.now}::timestamptz ELSE window_started_at END,
        accepted_in_window = CASE WHEN window_started_at <= ${input.issue.now}::timestamptz - interval '1 hour' THEN 1 ELSE accepted_in_window + 1 END,
        updated_at = ${input.issue.now}
      WHERE actor_id = ${input.issue.actorId}::uuid
    `.execute(this.transaction);
    return {
      outcome: "QUEUED",
      requestId: input.requestId,
      commandId: input.commandId,
    };
  }

  private async insertEvent(
    eventId: string,
    requestId: string,
    commandId: string,
    state: string,
    reason: string | null,
    occurredAt: Date,
  ): Promise<void> {
    await sql`
      INSERT INTO eject_lifecycle_events (event_id, request_id, command_id, state, reason_code, occurred_at)
      VALUES (${eventId}::uuid, ${requestId}::uuid, ${commandId}::uuid, ${state}, ${reason}, ${occurredAt})
    `.execute(this.transaction);
  }
}

function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required issuance fact is missing");
  return value;
}

function isRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  return error.code === "40001" || error.code === "40P01";
}
