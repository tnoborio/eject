import { describe, expect, it } from "vitest";
import { toProtocolV1Command } from "../src/modules/eject/transport/protocol-v1-command";

const projection = {
  commandId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  actorId: "33333333-3333-4333-8333-333333333333",
  actorDisplayName: "Kaz",
  issuedAt: new Date("2026-07-20T00:00:00.000Z"),
  expiresAt: new Date("2026-07-20T00:00:30.000Z"),
};

describe("toProtocolV1Command", () => {
  it("maps a domain projection to the canonical closed command", () => {
    expect(toProtocolV1Command(projection)).toEqual({
      protocol_version: 1,
      kind: "COMMAND",
      command_id: projection.commandId,
      type: "OPTICAL_DRIVE_EJECT",
      device_id: projection.deviceId,
      actor: {
        person_id: projection.actorId,
        display_name: projection.actorDisplayName,
      },
      issued_at: "2026-07-20T00:00:00.000Z",
      expires_at: "2026-07-20T00:00:30.000Z",
    });
  });

  it("rejects non-positive and excessive command lifetimes", () => {
    expect(() =>
      toProtocolV1Command({ ...projection, expiresAt: projection.issuedAt }),
    ).toThrow(RangeError);
    expect(() =>
      toProtocolV1Command({
        ...projection,
        expiresAt: new Date(projection.issuedAt.getTime() + 60_001),
      }),
    ).toThrow(RangeError);
  });

  it("rejects a projection that violates the canonical schema", () => {
    expect(() =>
      toProtocolV1Command({ ...projection, actorDisplayName: "" }),
    ).toThrow(TypeError);
  });
});
