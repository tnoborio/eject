import { describe, expect, it, vi } from "vitest";
import {
  agentResultFingerprint,
  createIngestAgentResult,
  type AgentResultObservation,
} from "../src/modules/eject/application/ingest-agent-result";

const device = {
  deviceId: "11111111-1111-4111-8111-111111111111",
  keyId: "22222222-2222-4222-8222-222222222222",
  nonceDigest: new Uint8Array(32),
};
const now = new Date("2026-07-21T00:00:00.000Z");
const result: AgentResultObservation = {
  commandId: "33333333-3333-4333-8333-333333333333",
  deviceId: device.deviceId,
  recordedAt: now,
  disposition: "REJECTED",
  attemptCount: 0,
  result: "AGENT_PAUSED",
  physicalOutcome: "NOT_ATTEMPTED",
};

describe("ingestAgentResult", () => {
  it("binds a validated observation to a stable fingerprint and event IDs", async () => {
    const store = {
      ingest: vi.fn(async () => ({ outcome: "STORED" as const })),
    };
    const ids = ["event-1", "event-2", "event-3"];
    const ingest = createIngestAgentResult({
      store,
      newId: () => ids.shift() ?? "unexpected",
    });

    await expect(ingest(device, result, now)).resolves.toEqual({
      outcome: "STORED",
    });
    expect(store.ingest).toHaveBeenCalledWith({
      device,
      result,
      fingerprint: agentResultFingerprint(result),
      receivedAt: now,
      deliveredEventId: "event-1",
      dispositionEventId: "event-2",
      terminalEventId: "event-3",
    });
    expect(agentResultFingerprint(result)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects audience mismatch and future device timestamps before storage", async () => {
    const store = { ingest: vi.fn() };
    const ingest = createIngestAgentResult({ store, newId: () => "unused" });

    await expect(
      ingest(device, { ...result, deviceId: "different" }, now),
    ).resolves.toEqual({
      outcome: "REJECTED",
      reason: "COMMAND_MISMATCH",
    });
    await expect(
      ingest(
        device,
        { ...result, recordedAt: new Date(now.getTime() + 30_001) },
        now,
      ),
    ).resolves.toEqual({ outcome: "REJECTED", reason: "CLOCK_SKEW" });
    expect(store.ingest).not.toHaveBeenCalled();
  });
});
