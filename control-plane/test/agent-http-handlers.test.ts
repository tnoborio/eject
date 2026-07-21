import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as pollRoute } from "../src/app/api/agent/v1/poll/route";
import { createAuthenticateAgentRequest } from "../src/modules/devices/application/authenticate-agent-request";
import {
  NodeAgentRequestCrypto,
  NodeServerResponseSigner,
} from "../src/modules/devices/infrastructure/node-agent-crypto";
import {
  handleAgentPoll,
  handleAgentResult,
  type AgentHttpDependencies,
} from "../src/modules/devices/transport/agent-http-handlers";

const deviceId = "11111111-1111-4111-8111-111111111111";
const keyId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-07-21T00:00:00.000Z");
const originalDelivery = process.env.EJECT_AGENT_DELIVERY_ENABLED;

afterEach(() => {
  if (originalDelivery === undefined) {
    delete process.env.EJECT_AGENT_DELIVERY_ENABLED;
  } else {
    process.env.EJECT_AGENT_DELIVERY_ENABLED = originalDelivery;
  }
});

describe("agent HTTP handlers", () => {
  it("returns a signed, closed protocol command for an authenticated poll", async () => {
    const harness = createHarness();
    const response = await handleAgentPoll(
      signedHttpRequest(
        "/api/agent/v1/poll",
        { protocol_version: 1 },
        harness.devicePrivateKey,
      ),
      harness.dependencies,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("eject-server-key-id")).toBe(keyId);
    expect(response.headers.get("eject-response-signature")).toMatch(
      /^[A-Za-z0-9_-]{86}$/,
    );
    await expect(response.json()).resolves.toEqual({
      server_time: now.toISOString(),
      command: {
        protocol_version: 1,
        kind: "COMMAND",
        command_id: commandId,
        type: "OPTICAL_DRIVE_EJECT",
        device_id: deviceId,
        actor: { person_id: actorId, display_name: "Kaz" },
        issued_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 30_000).toISOString(),
      },
    });
    expect(harness.poll).toHaveBeenCalledOnce();
  });

  it("validates a signed protocol result before ingestion", async () => {
    const harness = createHarness();
    const response = await handleAgentResult(
      signedHttpRequest(
        "/api/agent/v1/result",
        {
          protocol_version: 1,
          kind: "AGENT_RESULT",
          command_id: commandId,
          device_id: deviceId,
          recorded_at: new Date(now.getTime() + 1_000).toISOString(),
          disposition: "ATTEMPTED",
          attempt_count: 1,
          result: "COMMAND_ACCEPTED",
          physical_outcome: "UNKNOWN",
        },
        harness.devicePrivateKey,
      ),
      harness.dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      server_time: now.toISOString(),
      outcome: "STORED",
    });
    expect(harness.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId, keyId }),
      expect.objectContaining({
        commandId,
        disposition: "ATTEMPTED",
        result: "COMMAND_ACCEPTED",
      }),
      now,
    );
  });

  it("rejects malformed, oversized, queried, and tampered requests", async () => {
    const harness = createHarness();
    const tampered = signedHttpRequest(
      "/api/agent/v1/poll",
      { protocol_version: 1 },
      harness.devicePrivateKey,
    );
    tampered.headers.set("eject-content-sha256", "A".repeat(43));

    await expect(
      handleAgentPoll(tampered, harness.dependencies),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      handleAgentPoll(
        new Request("https://eject.test/api/agent/v1/poll?x=1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      handleAgentPoll(
        new Request("https://eject.test/api/agent/v1/poll", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": "129",
          },
          body: "{}",
        }),
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("keeps the deployed route unavailable unless explicitly enabled", async () => {
    process.env.EJECT_AGENT_DELIVERY_ENABLED = "false";
    const response = await pollRoute(
      new Request("https://eject.test/api/agent/v1/poll", { method: "POST" }),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "DELIVERY_DISABLED",
    });
  });
});

function createHarness() {
  const deviceKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const serverKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicSpki = deviceKeys.publicKey.export({
    format: "der",
    type: "spki",
  });
  const authenticate = createAuthenticateAgentRequest({
    keys: { loadActivePublicKey: async () => publicSpki },
    crypto: new NodeAgentRequestCrypto(),
  });
  const poll = vi.fn(async () => ({
    outcome: "COMMAND" as const,
    command: {
      commandId,
      deviceId,
      actorId,
      actorDisplayName: "Kaz",
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 30_000),
    },
  }));
  const ingest = vi.fn(async () => ({ outcome: "STORED" as const }));
  const dependencies: AgentHttpDependencies = {
    authenticate,
    poll,
    ingest,
    signer: new NodeServerResponseSigner(
      keyId,
      serverKeys.privateKey.export({ format: "der", type: "pkcs8" }),
    ),
    now: () => now,
  };
  return {
    dependencies,
    devicePrivateKey: deviceKeys.privateKey,
    poll,
    ingest,
  };
}

function signedHttpRequest(
  path: string,
  value: Readonly<Record<string, unknown>>,
  privateKey: KeyObject,
): Request {
  const body = JSON.stringify(value);
  const bodyHash = createHash("sha256").update(body).digest("base64url");
  const nonce = "AAAAAAAAAAAAAAAAAAAAAA";
  const canonical = [
    "EJECT-DEVICE-REQUEST-V1",
    keyId,
    deviceId,
    String(now.getTime()),
    nonce,
    "POST",
    path,
    bodyHash,
  ].join("\n");
  const signature = sign("sha256", Buffer.from(canonical), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return new Request(`https://eject.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "eject-device-id": deviceId,
      "eject-key-id": keyId,
      "eject-timestamp": String(now.getTime()),
      "eject-nonce": nonce,
      "eject-content-sha256": bodyHash,
      "eject-signature": signature,
    },
    body,
  });
}
