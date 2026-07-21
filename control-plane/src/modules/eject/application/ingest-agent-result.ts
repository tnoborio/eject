import { createHash } from "node:crypto";
import type { AuthenticatedDeviceContext } from "./agent-polling";

export type RejectedAgentResultCode =
  | "INVALID_COMMAND"
  | "AUDIENCE_MISMATCH"
  | "COMMAND_EXPIRED"
  | "COMMAND_ISSUED_IN_FUTURE"
  | "COMMAND_REPLAYED"
  | "AGENT_PAUSED"
  | "NO_APPROVED_DRIVE"
  | "COMMAND_UNSUPPORTED";

export type AttemptedAgentResultCode =
  | "COMMAND_ACCEPTED"
  | "DRIVE_NOT_FOUND"
  | "DRIVE_BUSY"
  | "DRIVE_NOT_READY"
  | "DRIVE_UNSUPPORTED"
  | "DRIVE_DISCONNECTED"
  | "ACCESS_DENIED"
  | "FAILED";

export type AgentResultObservation =
  | {
      readonly commandId: string;
      readonly deviceId: string;
      readonly recordedAt: Date;
      readonly disposition: "REJECTED";
      readonly attemptCount: 0;
      readonly result: RejectedAgentResultCode;
      readonly physicalOutcome: "NOT_ATTEMPTED";
    }
  | {
      readonly commandId: string;
      readonly deviceId: string;
      readonly recordedAt: Date;
      readonly disposition: "ATTEMPTED";
      readonly attemptCount: 1;
      readonly result: AttemptedAgentResultCode;
      readonly physicalOutcome: "UNKNOWN";
    };

export type IngestResultOutcome =
  | { readonly outcome: "STORED" | "ALREADY_STORED" }
  | {
      readonly outcome: "REJECTED";
      readonly reason:
        | "AUTHENTICATION_FAILED"
        | "REPLAYED_REQUEST"
        | "COMMAND_MISMATCH"
        | "RESULT_CONFLICT"
        | "CLOCK_SKEW";
    };

export interface AgentResultStore {
  ingest(input: {
    readonly device: AuthenticatedDeviceContext;
    readonly result: AgentResultObservation;
    readonly fingerprint: string;
    readonly receivedAt: Date;
    readonly deliveredEventId: string;
    readonly dispositionEventId: string;
    readonly terminalEventId: string;
  }): Promise<IngestResultOutcome>;
}

export function createIngestAgentResult(dependencies: {
  readonly store: AgentResultStore;
  readonly newId: () => string;
}) {
  return async function ingestAgentResult(
    device: AuthenticatedDeviceContext,
    result: AgentResultObservation,
    receivedAt: Date,
  ): Promise<IngestResultOutcome> {
    if (
      result.deviceId !== device.deviceId ||
      result.recordedAt.getTime() > receivedAt.getTime() + 30_000
    ) {
      return {
        outcome: "REJECTED",
        reason:
          result.deviceId !== device.deviceId
            ? "COMMAND_MISMATCH"
            : "CLOCK_SKEW",
      };
    }

    return dependencies.store.ingest({
      device,
      result,
      fingerprint: agentResultFingerprint(result),
      receivedAt,
      deliveredEventId: dependencies.newId(),
      dispositionEventId: dependencies.newId(),
      terminalEventId: dependencies.newId(),
    });
  };
}

export function agentResultFingerprint(result: AgentResultObservation): string {
  const canonical = [
    "eject-agent-result-v1",
    result.commandId,
    result.deviceId,
    result.recordedAt.toISOString(),
    result.disposition,
    String(result.attemptCount),
    result.result,
    result.physicalOutcome,
  ].join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}
