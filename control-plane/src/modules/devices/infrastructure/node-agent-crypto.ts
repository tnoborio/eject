import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";
import type { AgentRequestCrypto } from "../application/authenticate-agent-request";

export class NodeAgentRequestCrypto implements AgentRequestCrypto {
  public sha256(value: Uint8Array | string): Uint8Array {
    return createHash("sha256").update(value).digest();
  }

  public equal(left: Uint8Array, right: Uint8Array): boolean {
    return left.byteLength === right.byteLength && timingSafeEqual(left, right);
  }

  public verifyP256(
    publicKeySpki: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array,
  ): boolean {
    if (signature.byteLength !== 64) return false;
    try {
      const key = createPublicKey({
        key: Buffer.from(publicKeySpki),
        format: "der",
        type: "spki",
      });
      return (
        isP256(key) &&
        verify("sha256", message, { key, dsaEncoding: "ieee-p1363" }, signature)
      );
    } catch {
      return false;
    }
  }
}

export class NodeServerResponseSigner {
  private readonly key: KeyObject;

  public constructor(
    private readonly keyId: string,
    privateKeyPkcs8: Uint8Array,
  ) {
    this.key = createPrivateKey({
      key: Buffer.from(privateKeyPkcs8),
      format: "der",
      type: "pkcs8",
    });
    if (!isP256(this.key)) {
      throw new Error("Server response signing key must be ECDSA P-256");
    }
  }

  public signResponse(input: {
    readonly requestNonce: string;
    readonly status: number;
    readonly body: Uint8Array;
  }): { readonly keyId: string; readonly signature: string } {
    const bodyHash = createHash("sha256")
      .update(input.body)
      .digest("base64url");
    const canonical = [
      "EJECT-SERVER-RESPONSE-V1",
      input.requestNonce,
      String(input.status),
      bodyHash,
    ].join("\n");
    const signature = sign("sha256", Buffer.from(canonical, "utf8"), {
      key: this.key,
      dsaEncoding: "ieee-p1363",
    });
    return { keyId: this.keyId, signature: signature.toString("base64url") };
  }
}

function isP256(key: KeyObject): boolean {
  return (
    key.asymmetricKeyType === "ec" &&
    key.asymmetricKeyDetails?.namedCurve === "prime256v1"
  );
}
