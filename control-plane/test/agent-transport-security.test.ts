import {
  createHash,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalAgentRequest,
  createAuthenticateAgentRequest,
  type ParsedAgentRequest,
} from "../src/modules/devices/application/authenticate-agent-request";
import {
  NodeAgentRequestCrypto,
  NodeServerResponseSigner,
} from "../src/modules/devices/infrastructure/node-agent-crypto";
import { parseProtocolV1AgentResult } from "../src/modules/eject/transport/protocol-v1-agent-result";

const deviceId = "11111111-1111-4111-8111-111111111111";
const keyId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-07-21T00:00:00.000Z");

describe("agent transport security", () => {
  it("authenticates an exact P-256 request and derives a bounded nonce digest", async () => {
    const keys = generateP256();
    const request = signedRequest(keys.privateKey);
    const authenticate = createAuthenticateAgentRequest({
      keys: { loadActivePublicKey: async () => keys.publicSpki },
      crypto: new NodeAgentRequestCrypto(),
    });

    const result = await authenticate(request, now);
    expect(result).toEqual({
      authenticated: true,
      context: {
        deviceId,
        keyId,
        nonce: request.nonce,
        nonceDigest: createHash("sha256")
          .update(`${deviceId}\n${request.nonce}`)
          .digest(),
      },
    });
  });

  it("rejects body changes, unknown keys, bad signatures, and clock skew", async () => {
    const keys = generateP256();
    const request = signedRequest(keys.privateKey);
    const crypto = new NodeAgentRequestCrypto();
    const withKey = createAuthenticateAgentRequest({
      keys: { loadActivePublicKey: async () => keys.publicSpki },
      crypto,
    });
    const withoutKey = createAuthenticateAgentRequest({
      keys: { loadActivePublicKey: async () => null },
      crypto,
    });

    await expect(
      withKey({ ...request, body: new TextEncoder().encode("{}") }, now),
    ).resolves.toMatchObject({
      authenticated: false,
      reason: "CONTENT_HASH_MISMATCH",
      signatureVerified: false,
    });
    await expect(withoutKey(request, now)).resolves.toMatchObject({
      authenticated: false,
      reason: "AUTHENTICATION_FAILED",
    });
    const badSignature = Uint8Array.from(request.signature);
    badSignature[0] = (badSignature[0] ?? 0) ^ 1;
    await expect(
      withKey({ ...request, signature: badSignature }, now),
    ).resolves.toMatchObject({
      authenticated: false,
      reason: "AUTHENTICATION_FAILED",
    });
    await expect(
      withKey(request, new Date(now.getTime() + 30_001)),
    ).resolves.toEqual({
      authenticated: false,
      reason: "CLOCK_SKEW",
      signatureVerified: true,
    });
  });

  it("signs a response over the request nonce, status, and exact body", () => {
    const keys = generateP256();
    const signer = new NodeServerResponseSigner(keyId, keys.privatePkcs8);
    const body = new TextEncoder().encode('{"command":null}');
    const signed = signer.signResponse({
      requestNonce: "AAAAAAAAAAAAAAAAAAAAAA",
      status: 200,
      body,
    });
    const bodyHash = createHash("sha256").update(body).digest("base64url");
    const canonical = [
      "EJECT-SERVER-RESPONSE-V1",
      "AAAAAAAAAAAAAAAAAAAAAA",
      "200",
      bodyHash,
    ].join("\n");

    expect(signed.keyId).toBe(keyId);
    expect(Buffer.from(signed.signature, "base64url")).toHaveLength(64);
    expect(
      verify(
        "sha256",
        Buffer.from(canonical),
        { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signed.signature, "base64url"),
      ),
    ).toBe(true);
    expect(
      verify(
        "sha256",
        Buffer.from(canonical.replace("200", "201")),
        { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signed.signature, "base64url"),
      ),
    ).toBe(false);
  });

  it("maps only closed protocol-v1 agent results", () => {
    const attempted = new TextEncoder().encode(
      JSON.stringify({
        protocol_version: 1,
        kind: "AGENT_RESULT",
        command_id: "33333333-3333-4333-8333-333333333333",
        device_id: deviceId,
        recorded_at: "2026-07-21T00:00:01.000Z",
        disposition: "ATTEMPTED",
        attempt_count: 1,
        result: "COMMAND_ACCEPTED",
        physical_outcome: "UNKNOWN",
      }),
    );
    expect(parseProtocolV1AgentResult(attempted)).toMatchObject({
      disposition: "ATTEMPTED",
      attemptCount: 1,
      result: "COMMAND_ACCEPTED",
      physicalOutcome: "UNKNOWN",
    });
    expect(
      parseProtocolV1AgentResult(
        new TextEncoder().encode(
          new TextDecoder().decode(attempted).replace("UNKNOWN", "OPENED"),
        ),
      ),
    ).toBeNull();
    expect(parseProtocolV1AgentResult(new Uint8Array([0xff]))).toBeNull();
  });
});

function signedRequest(privateKey: KeyObject): ParsedAgentRequest {
  const body = new TextEncoder().encode('{"protocol_version":1}');
  const hash = createHash("sha256").update(body).digest();
  const unsigned: ParsedAgentRequest = {
    deviceId,
    keyId,
    timestampMs: now.getTime(),
    nonce: "AAAAAAAAAAAAAAAAAAAAAA",
    declaredContentHashText: hash.toString("base64url"),
    declaredContentHash: hash,
    signature: new Uint8Array(64),
    method: "POST",
    path: "/api/agent/v1/poll",
    body,
  };
  return {
    ...unsigned,
    signature: sign(
      "sha256",
      new TextEncoder().encode(canonicalAgentRequest(unsigned)),
      { key: privateKey, dsaEncoding: "ieee-p1363" },
    ),
  };
}

function generateP256(): {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicSpki: Uint8Array;
  privatePkcs8: Uint8Array;
} {
  const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    ...keys,
    publicSpki: keys.publicKey.export({ format: "der", type: "spki" }),
    privatePkcs8: keys.privateKey.export({ format: "der", type: "pkcs8" }),
  };
}
