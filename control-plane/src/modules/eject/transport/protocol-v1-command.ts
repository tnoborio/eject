import {
  MAX_COMMAND_TTL_MS,
  validateMessage,
} from "@eject/protocol-contract/v1/validator";

export interface QueuedCommandProjection {
  readonly commandId: string;
  readonly deviceId: string;
  readonly actorId: string;
  readonly actorDisplayName: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface ProtocolV1Command {
  readonly protocol_version: 1;
  readonly kind: "COMMAND";
  readonly command_id: string;
  readonly type: "OPTICAL_DRIVE_EJECT";
  readonly device_id: string;
  readonly actor: {
    readonly person_id: string;
    readonly display_name: string;
  };
  readonly issued_at: string;
  readonly expires_at: string;
}

export function toProtocolV1Command(
  projection: QueuedCommandProjection,
): ProtocolV1Command {
  const lifetime =
    projection.expiresAt.getTime() - projection.issuedAt.getTime();
  if (lifetime <= 0 || lifetime > MAX_COMMAND_TTL_MS) {
    throw new RangeError(
      "Protocol v1 command lifetime must be between 1 and 60000 milliseconds",
    );
  }

  const command: ProtocolV1Command = {
    protocol_version: 1,
    kind: "COMMAND",
    command_id: projection.commandId,
    type: "OPTICAL_DRIVE_EJECT",
    device_id: projection.deviceId,
    actor: {
      person_id: projection.actorId,
      display_name: projection.actorDisplayName,
    },
    issued_at: projection.issuedAt.toISOString(),
    expires_at: projection.expiresAt.toISOString(),
  };

  const validation = validateMessage(command);
  if (!validation.valid) {
    throw new TypeError("Command projection does not satisfy protocol v1");
  }

  return command;
}
