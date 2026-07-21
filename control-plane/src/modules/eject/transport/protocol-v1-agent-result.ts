import { validateMessage } from "@eject/protocol-contract/v1/validator";
import type {
  AgentResultObservation,
  AttemptedAgentResultCode,
  RejectedAgentResultCode,
} from "../application/ingest-agent-result";

export function parseProtocolV1AgentResult(
  body: Uint8Array,
): AgentResultObservation | null {
  let message: unknown;
  try {
    message = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
  } catch {
    return null;
  }
  const validation = validateMessage(message);
  if (!validation.valid || !isAgentResult(message)) return null;

  const recordedAt = new Date(message.recorded_at);
  if (Number.isNaN(recordedAt.getTime())) return null;
  if (message.disposition === "REJECTED") {
    return {
      commandId: message.command_id,
      deviceId: message.device_id,
      recordedAt,
      disposition: "REJECTED",
      attemptCount: 0,
      result: message.result,
      physicalOutcome: "NOT_ATTEMPTED",
    };
  }
  return {
    commandId: message.command_id,
    deviceId: message.device_id,
    recordedAt,
    disposition: "ATTEMPTED",
    attemptCount: 1,
    result: message.result,
    physicalOutcome: "UNKNOWN",
  };
}

type RejectedWire = {
  readonly kind: "AGENT_RESULT";
  readonly command_id: string;
  readonly device_id: string;
  readonly recorded_at: string;
  readonly disposition: "REJECTED";
  readonly result: RejectedAgentResultCode;
};

type AttemptedWire = {
  readonly kind: "AGENT_RESULT";
  readonly command_id: string;
  readonly device_id: string;
  readonly recorded_at: string;
  readonly disposition: "ATTEMPTED";
  readonly result: AttemptedAgentResultCode;
};

function isAgentResult(value: unknown): value is RejectedWire | AttemptedWire {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "AGENT_RESULT" &&
    "disposition" in value &&
    (value.disposition === "REJECTED" || value.disposition === "ATTEMPTED")
  );
}
