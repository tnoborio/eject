import { createHash, createPublicKey, randomBytes } from "node:crypto";
import type {
  DeviceEnrollmentCrypto,
  EnrollmentSecret,
} from "../application/device-enrollment";

export class NodeDeviceEnrollmentCrypto implements DeviceEnrollmentCrypto {
  generateSecret(): EnrollmentSecret {
    const secret = randomBytes(32);
    return {
      value: secret.toString("base64url"),
      digest: createHash("sha256").update(secret).digest(),
    };
  }

  digestSecret(value: string): Uint8Array {
    return createHash("sha256")
      .update(Buffer.from(value, "base64url"))
      .digest();
  }

  isP256SubjectPublicKeyInfo(value: Uint8Array): boolean {
    try {
      const key = createPublicKey({
        key: Buffer.from(value),
        format: "der",
        type: "spki",
      });
      const canonical = key.export({ format: "der", type: "spki" });
      return (
        key.asymmetricKeyType === "ec" &&
        key.asymmetricKeyDetails?.namedCurve === "prime256v1" &&
        canonical.equals(Buffer.from(value))
      );
    } catch {
      return false;
    }
  }
}
