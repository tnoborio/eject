import { sql, type Kysely, type Transaction } from "kysely";
import type { ControlPlaneDatabase } from "@/infrastructure/postgres/database";
import type { DeviceEnrollmentStore } from "../application/device-enrollment";

interface DatabaseError {
  readonly code?: string;
}

export class PostgresDeviceEnrollmentStore implements DeviceEnrollmentStore {
  constructor(
    private readonly database: Kysely<ControlPlaneDatabase>,
    private readonly newId: () => string,
    private readonly maximumAttempts = 3,
  ) {}

  async createEnrollment(
    input: Parameters<DeviceEnrollmentStore["createEnrollment"]>[0],
  ): ReturnType<DeviceEnrollmentStore["createEnrollment"]> {
    return this.withRetry(async (transaction) => {
      const owner = await sql<{ account_status: string }>`
        SELECT account_status FROM people
        WHERE person_id = ${input.ownerId}::uuid
        FOR UPDATE
      `.execute(transaction);
      if (owner.rows[0]?.account_status !== "ACTIVE") {
        return "ACCOUNT_UNAVAILABLE";
      }

      const activeDevice = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM registered_devices
          WHERE owner_id = ${input.ownerId}::uuid
            AND enrollment_state <> 'REVOKED'
        ) AS exists
      `.execute(transaction);
      if (activeDevice.rows[0]?.exists) return "DEVICE_ALREADY_REGISTERED";

      await sql`
        UPDATE device_enrollment_sessions SET used_at = ${input.now}
        WHERE owner_id = ${input.ownerId}::uuid
          AND used_at IS NULL
      `.execute(transaction);
      await sql`
        INSERT INTO device_enrollment_sessions (
          enrollment_id, owner_id, enrollment_digest, expires_at, created_at
        ) VALUES (
          ${input.enrollmentId}::uuid, ${input.ownerId}::uuid,
          ${Buffer.from(input.secretDigest)}::bytea, ${input.expiresAt}, ${input.now}
        )
      `.execute(transaction);
      return "CREATED";
    });
  }

  async consumeEnrollment(
    input: Parameters<DeviceEnrollmentStore["consumeEnrollment"]>[0],
  ): ReturnType<DeviceEnrollmentStore["consumeEnrollment"]> {
    return this.withRetry(async (transaction) => {
      const enrollment = await sql<{
        enrollment_id: string;
        owner_id: string;
        expires_at: Date;
        used_at: Date | null;
        account_status: string;
      }>`
        SELECT session.enrollment_id, session.owner_id, session.expires_at,
          session.used_at, owner.account_status
        FROM device_enrollment_sessions session
        JOIN people owner ON owner.person_id = session.owner_id
        WHERE session.enrollment_digest = ${Buffer.from(input.secretDigest)}::bytea
        FOR UPDATE OF session, owner
      `.execute(transaction);
      const session = enrollment.rows[0];
      if (
        session === undefined ||
        session.used_at !== null ||
        session.expires_at.getTime() <= input.now.getTime() ||
        session.account_status !== "ACTIVE"
      ) {
        return "ENROLLMENT_FAILED";
      }

      const activeDevice = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM registered_devices
          WHERE owner_id = ${session.owner_id}::uuid
            AND enrollment_state <> 'REVOKED'
        ) AS exists
      `.execute(transaction);
      if (activeDevice.rows[0]?.exists) return "DEVICE_ALREADY_REGISTERED";

      const identifiers = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM registered_devices WHERE device_id = ${input.deviceId}::uuid
          UNION ALL
          SELECT 1 FROM device_keys WHERE key_id = ${input.keyId}::uuid
        ) AS exists
      `.execute(transaction);
      if (identifiers.rows[0]?.exists) return "IDENTIFIER_CONFLICT";

      await sql`
        UPDATE device_enrollment_sessions SET used_at = ${input.now}
        WHERE enrollment_id = ${session.enrollment_id}::uuid
      `.execute(transaction);
      await sql`
        INSERT INTO registered_devices (
          device_id, owner_id, enrollment_state, availability,
          has_approved_drive, platform, agent_version, created_at
        ) VALUES (
          ${input.deviceId}::uuid, ${session.owner_id}::uuid,
          'SETUP_IN_PROGRESS', 'OFFLINE', false, ${input.platform},
          ${input.agentVersion}, ${input.now}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO device_keys (
          key_id, device_id, algorithm, public_key_spki, created_at
        ) VALUES (
          ${input.keyId}::uuid, ${input.deviceId}::uuid,
          'ECDSA_P256_SHA256_P1363', ${Buffer.from(input.publicKeySpki)}::bytea,
          ${input.now}
        )
      `.execute(transaction);
      return "ENROLLED";
    });
  }

  async revokeDevice(
    input: Parameters<DeviceEnrollmentStore["revokeDevice"]>[0],
  ): Promise<void> {
    await this.withRetry(async (transaction) => {
      const owner = await sql<{ person_id: string }>`
        SELECT person_id FROM people
        WHERE person_id = ${input.ownerId}::uuid
        FOR UPDATE
      `.execute(transaction);
      if (owner.rows[0] === undefined) return;

      const selected = await sql<{ enrollment_state: string }>`
        SELECT enrollment_state FROM registered_devices
        WHERE device_id = ${input.deviceId}::uuid
          AND owner_id = ${input.ownerId}::uuid
        FOR UPDATE
      `.execute(transaction);
      if (
        selected.rows[0] === undefined ||
        selected.rows[0].enrollment_state === "REVOKED"
      ) {
        return;
      }

      await sql`
        UPDATE registered_devices
        SET enrollment_state = 'REVOKED', availability = 'OFFLINE'
        WHERE device_id = ${input.deviceId}::uuid
      `.execute(transaction);
      await sql`
        UPDATE device_keys SET revoked_at = ${input.now}
        WHERE device_id = ${input.deviceId}::uuid AND revoked_at IS NULL
      `.execute(transaction);
      await sql`
        UPDATE device_enrollment_sessions SET used_at = ${input.now}
        WHERE owner_id = ${input.ownerId}::uuid AND used_at IS NULL
      `.execute(transaction);

      const commands = await sql<{ command_id: string; request_id: string }>`
        SELECT command_id, request_id FROM eject_commands
        WHERE device_id = ${input.deviceId}::uuid
          AND status IN ('QUEUED', 'DISPATCHED')
        ORDER BY command_id
        FOR UPDATE
      `.execute(transaction);
      for (const command of commands.rows) {
        await sql`
          UPDATE eject_commands
          SET status = 'CANCELLED', cancellation_reason = 'DEVICE_REVOKED'
          WHERE command_id = ${command.command_id}::uuid
        `.execute(transaction);
        await sql`
          INSERT INTO eject_lifecycle_events (
            event_id, request_id, command_id, state, reason_code, occurred_at
          ) VALUES (
            ${this.newId()}::uuid, ${command.request_id}::uuid,
            ${command.command_id}::uuid, 'CANCELLED', 'DEVICE_REVOKED', ${input.now}
          )
        `.execute(transaction);
      }
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
    throw new Error("Unreachable device enrollment retry state");
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
