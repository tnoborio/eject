const maximumClockSkewMs = 30_000;

export interface ParsedAgentRequest {
  readonly deviceId: string;
  readonly keyId: string;
  readonly timestampMs: number;
  readonly nonce: string;
  readonly declaredContentHashText: string;
  readonly declaredContentHash: Uint8Array;
  readonly signature: Uint8Array;
  readonly method: "POST";
  readonly path: string;
  readonly body: Uint8Array;
}

export interface DeviceKeyReader {
  loadActivePublicKey(
    deviceId: string,
    keyId: string,
  ): Promise<Uint8Array | null>;
}

export interface AgentRequestCrypto {
  sha256(value: Uint8Array | string): Uint8Array;
  equal(left: Uint8Array, right: Uint8Array): boolean;
  verifyP256(
    publicKeySpki: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array,
  ): boolean;
}

export type AgentAuthenticationResult =
  | {
      readonly authenticated: true;
      readonly context: {
        readonly deviceId: string;
        readonly keyId: string;
        readonly nonce: string;
        readonly nonceDigest: Uint8Array;
      };
    }
  | {
      readonly authenticated: false;
      readonly reason:
        "AUTHENTICATION_FAILED" | "CONTENT_HASH_MISMATCH" | "CLOCK_SKEW";
      readonly signatureVerified: boolean;
    };

export function createAuthenticateAgentRequest(dependencies: {
  readonly keys: DeviceKeyReader;
  readonly crypto: AgentRequestCrypto;
}) {
  return async function authenticateAgentRequest(
    request: ParsedAgentRequest,
    now: Date,
  ): Promise<AgentAuthenticationResult> {
    const actualContentHash = dependencies.crypto.sha256(request.body);
    if (
      !dependencies.crypto.equal(actualContentHash, request.declaredContentHash)
    ) {
      return rejected("CONTENT_HASH_MISMATCH", false);
    }

    const publicKey = await dependencies.keys.loadActivePublicKey(
      request.deviceId,
      request.keyId,
    );
    if (publicKey === null) {
      return rejected("AUTHENTICATION_FAILED", false);
    }

    const canonical = canonicalAgentRequest(request);
    if (
      !dependencies.crypto.verifyP256(
        publicKey,
        new TextEncoder().encode(canonical),
        request.signature,
      )
    ) {
      return rejected("AUTHENTICATION_FAILED", false);
    }

    if (Math.abs(now.getTime() - request.timestampMs) > maximumClockSkewMs) {
      return rejected("CLOCK_SKEW", true);
    }

    return {
      authenticated: true,
      context: {
        deviceId: request.deviceId,
        keyId: request.keyId,
        nonce: request.nonce,
        nonceDigest: dependencies.crypto.sha256(
          `${request.deviceId}\n${request.nonce}`,
        ),
      },
    };
  };
}

export function canonicalAgentRequest(request: ParsedAgentRequest): string {
  return [
    "EJECT-DEVICE-REQUEST-V1",
    request.keyId,
    request.deviceId,
    String(request.timestampMs),
    request.nonce,
    request.method,
    request.path,
    request.declaredContentHashText,
  ].join("\n");
}

function rejected(
  reason: Exclude<
    AgentAuthenticationResult,
    { readonly authenticated: true }
  >["reason"],
  signatureVerified: boolean,
): AgentAuthenticationResult {
  return { authenticated: false, reason, signatureVerified };
}
