import { sql, type Kysely, type Transaction } from "kysely";
import type { ControlPlaneDatabase } from "@/infrastructure/postgres/database";
import type { DeviceKeyReader } from "@/modules/devices/application/authenticate-agent-request";
import type {
  AgentPollStore,
  AuthenticatedDeviceContext,
  PollStoreResult,
} from "../application/agent-polling";
import type {
  AgentResultStore,
  IngestResultOutcome,
} from "../application/ingest-agent-result";

interface CommandRow {
  command_id: string;
  request_id: string;
  device_id: string;
  actor_id: string;
  display_name: string;
  issued_at: Date;
  expires_at: Date;
  status: string;
  delivery_enabled: boolean;
  device_available: boolean;
}

interface ResultRow {
  request_fingerprint: string;
}

export class PostgresAgentTransportStore
  implements DeviceKeyReader, AgentPollStore, AgentResultStore
{
  public constructor(
    private readonly database: Kysely<ControlPlaneDatabase>,
    private readonly maximumAttempts = 3,
  ) {}

  public async loadActivePublicKey(
    deviceId: string,
    keyId: string,
  ): Promise<Uint8Array | null> {
    const result = await sql<{ public_key_spki: Uint8Array }>`
      SELECT key.public_key_spki
      FROM device_keys key
      JOIN registered_devices device ON device.device_id = key.device_id
      JOIN people owner ON owner.person_id = device.owner_id
      WHERE key.key_id = ${keyId}::uuid
        AND key.device_id = ${deviceId}::uuid
        AND key.revoked_at IS NULL
        AND device.enrollment_state = 'READY'
        AND owner.account_status = 'ACTIVE'
        AND owner.participation_state <> 'REVOKED'
    `.execute(this.database);
    return result.rows[0]?.public_key_spki ?? null;
  }

  public async poll(
    input: Parameters<AgentPollStore["poll"]>[0],
  ): Promise<PollStoreResult> {
    return this.withRetry(async (transaction) => {
      const nonce = await consumeNonce(transaction, input.device, input.now);
      if (nonce !== "ACCEPTED") return rejected(nonce);

      const selected = await sql<CommandRow>`
        SELECT command.command_id, command.request_id, command.device_id,
          command.actor_id, actor.display_name, command.issued_at,
          command.expires_at, command.status, policy.delivery_enabled,
          (device.availability = 'AVAILABLE' AND device.has_approved_drive) AS device_available
        FROM eject_commands command
        JOIN people actor ON actor.person_id = command.actor_id
        JOIN registered_devices device ON device.device_id = command.device_id
        CROSS JOIN system_delivery_policy policy
        WHERE command.device_id = ${input.device.deviceId}::uuid
          AND command.status IN ('QUEUED', 'DISPATCHED')
        ORDER BY command.issued_at, command.command_id
        LIMIT 1
        FOR UPDATE OF command
      `.execute(transaction);
      const command = selected.rows[0];
      if (command === undefined) return { outcome: "NO_COMMAND" };

      if (command.expires_at.getTime() <= input.now.getTime()) {
        await sql`
          UPDATE eject_commands SET status = 'EXPIRED'
          WHERE command_id = ${command.command_id}::uuid
        `.execute(transaction);
        await insertEvent(transaction, {
          eventId: input.expiredEventId,
          requestId: command.request_id,
          commandId: command.command_id,
          state: "EXPIRED",
          reason: "COMMAND_EXPIRED",
          occurredAt: input.now,
        });
        return { outcome: "NO_COMMAND" };
      }

      if (!command.delivery_enabled) {
        await sql`
          UPDATE eject_commands SET status = 'CANCELLED', cancellation_reason = 'DELIVERY_DISABLED'
          WHERE command_id = ${command.command_id}::uuid
        `.execute(transaction);
        await insertEvent(transaction, {
          eventId: input.cancelledEventId,
          requestId: command.request_id,
          commandId: command.command_id,
          state: "CANCELLED",
          reason: "DELIVERY_DISABLED",
          occurredAt: input.now,
        });
        return { outcome: "NO_COMMAND" };
      }

      if (!command.device_available) return { outcome: "NO_COMMAND" };

      if (command.status === "QUEUED") {
        await sql`
          UPDATE eject_commands SET status = 'DISPATCHED'
          WHERE command_id = ${command.command_id}::uuid
        `.execute(transaction);
        await insertEvent(transaction, {
          eventId: input.dispatchedEventId,
          requestId: command.request_id,
          commandId: command.command_id,
          state: "DISPATCHED",
          reason: null,
          occurredAt: input.now,
        });
      }

      return {
        outcome: "COMMAND",
        command: {
          commandId: command.command_id,
          deviceId: command.device_id,
          actorId: command.actor_id,
          actorDisplayName: command.display_name,
          issuedAt: command.issued_at,
          expiresAt: command.expires_at,
        },
      };
    });
  }

  public async ingest(
    input: Parameters<AgentResultStore["ingest"]>[0],
  ): Promise<IngestResultOutcome> {
    return this.withRetry(async (transaction) => {
      const nonce = await consumeNonce(
        transaction,
        input.device,
        input.receivedAt,
      );
      if (nonce !== "ACCEPTED") return rejected(nonce);

      const commandResult = await sql<{
        command_id: string;
        request_id: string;
        status: string;
      }>`
        SELECT command_id, request_id, status
        FROM eject_commands
        WHERE command_id = ${input.result.commandId}::uuid
          AND device_id = ${input.device.deviceId}::uuid
        FOR UPDATE
      `.execute(transaction);
      const command = commandResult.rows[0];
      if (command === undefined) {
        return { outcome: "REJECTED", reason: "COMMAND_MISMATCH" };
      }

      const existing = await sql<ResultRow>`
        SELECT request_fingerprint FROM agent_results
        WHERE device_id = ${input.device.deviceId}::uuid
          AND command_id = ${input.result.commandId}::uuid
      `.execute(transaction);
      const stored = existing.rows[0];
      if (stored !== undefined) {
        return stored.request_fingerprint === input.fingerprint
          ? { outcome: "ALREADY_STORED" }
          : { outcome: "REJECTED", reason: "RESULT_CONFLICT" };
      }

      if (command.status !== "DISPATCHED") {
        return { outcome: "REJECTED", reason: "COMMAND_MISMATCH" };
      }

      await sql`
        INSERT INTO agent_results (
          device_id, command_id, request_fingerprint, recorded_at, disposition,
          attempt_count, result_code, physical_outcome, received_at
        ) VALUES (
          ${input.device.deviceId}::uuid, ${input.result.commandId}::uuid,
          ${input.fingerprint}, ${input.result.recordedAt}, ${input.result.disposition},
          ${input.result.attemptCount}, ${input.result.result},
          ${input.result.physicalOutcome}, ${input.receivedAt}
        )
      `.execute(transaction);
      await insertEvent(transaction, {
        eventId: input.deliveredEventId,
        requestId: command.request_id,
        commandId: command.command_id,
        state: "DELIVERED",
        reason: null,
        occurredAt: input.receivedAt,
      });

      if (input.result.disposition === "REJECTED") {
        await sql`
          UPDATE eject_commands SET status = 'REJECTED_BY_AGENT'
          WHERE command_id = ${command.command_id}::uuid
        `.execute(transaction);
        await insertEvent(transaction, {
          eventId: input.dispositionEventId,
          requestId: command.request_id,
          commandId: command.command_id,
          state: "REJECTED_BY_AGENT",
          reason: input.result.result,
          occurredAt: input.receivedAt,
        });
        return { outcome: "STORED" };
      }

      await insertEvent(transaction, {
        eventId: input.dispositionEventId,
        requestId: command.request_id,
        commandId: command.command_id,
        state: "ATTEMPTED",
        reason: null,
        occurredAt: input.receivedAt,
      });
      const accepted = input.result.result === "COMMAND_ACCEPTED";
      await sql`
        UPDATE eject_commands SET status = ${accepted ? "OUTCOME_UNKNOWN" : "FAILED"}
        WHERE command_id = ${command.command_id}::uuid
      `.execute(transaction);
      await insertEvent(transaction, {
        eventId: input.terminalEventId,
        requestId: command.request_id,
        commandId: command.command_id,
        state: accepted ? "OUTCOME_UNKNOWN" : "FAILED",
        reason: accepted ? "PHYSICAL_OUTCOME_UNVERIFIED" : input.result.result,
        occurredAt: input.receivedAt,
      });
      return { outcome: "STORED" };
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
      } catch (error) {
        if (!isRetryable(error) || attempt === this.maximumAttempts)
          throw error;
      }
    }
    throw new Error("Unreachable agent transport retry state");
  }
}

async function consumeNonce(
  transaction: Transaction<ControlPlaneDatabase>,
  device: AuthenticatedDeviceContext,
  now: Date,
): Promise<"ACCEPTED" | "AUTHENTICATION_FAILED" | "REPLAYED_REQUEST"> {
  await sql`
    DELETE FROM device_request_nonces
    WHERE device_id = ${device.deviceId}::uuid AND expires_at <= ${now}
  `.execute(transaction);
  const inserted = await sql<{ device_id: string }>`
    INSERT INTO device_request_nonces (
      device_id, nonce_digest, accepted_at, expires_at
    )
    SELECT device.device_id, ${Buffer.from(device.nonceDigest)}::bytea,
      ${now}, ${new Date(now.getTime() + 10 * 60_000)}
    FROM registered_devices device
    JOIN device_keys key ON key.device_id = device.device_id
    JOIN people owner ON owner.person_id = device.owner_id
    WHERE device.device_id = ${device.deviceId}::uuid
      AND key.key_id = ${device.keyId}::uuid
      AND device.enrollment_state = 'READY'
      AND key.revoked_at IS NULL
      AND owner.account_status = 'ACTIVE'
      AND owner.participation_state <> 'REVOKED'
    ON CONFLICT DO NOTHING
    RETURNING device_id
  `.execute(transaction);
  if (inserted.rows.length === 1) return "ACCEPTED";

  const replay = await sql<{ replayed: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM device_request_nonces
      WHERE device_id = ${device.deviceId}::uuid
        AND nonce_digest = ${Buffer.from(device.nonceDigest)}::bytea
    ) AS replayed
  `.execute(transaction);
  return replay.rows[0]?.replayed
    ? "REPLAYED_REQUEST"
    : "AUTHENTICATION_FAILED";
}

async function insertEvent(
  transaction: Transaction<ControlPlaneDatabase>,
  event: {
    readonly eventId: string;
    readonly requestId: string;
    readonly commandId: string;
    readonly state: string;
    readonly reason: string | null;
    readonly occurredAt: Date;
  },
): Promise<void> {
  await sql`
    INSERT INTO eject_lifecycle_events (
      event_id, request_id, command_id, state, reason_code, occurred_at
    ) VALUES (
      ${event.eventId}::uuid, ${event.requestId}::uuid, ${event.commandId}::uuid,
      ${event.state}, ${event.reason}, ${event.occurredAt}
    )
  `.execute(transaction);
}

function rejected(
  reason: "AUTHENTICATION_FAILED" | "REPLAYED_REQUEST",
): PollStoreResult & IngestResultOutcome {
  return { outcome: "REJECTED", reason };
}

function isRetryable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "40001" || error.code === "40P01")
  );
}
