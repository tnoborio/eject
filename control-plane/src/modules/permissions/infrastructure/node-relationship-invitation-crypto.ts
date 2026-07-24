import { createHash, randomBytes } from "node:crypto";
import type {
  RelationshipInvitationCrypto,
  RelationshipInvitationSecret,
} from "../application/manage-relationships";

export class NodeRelationshipInvitationCrypto implements RelationshipInvitationCrypto {
  public generateSecret(): RelationshipInvitationSecret {
    const secret = randomBytes(32);
    return {
      value: secret.toString("base64url"),
      digest: createHash("sha256").update(secret).digest(),
    };
  }

  public digestSecret(value: string): Uint8Array {
    return createHash("sha256")
      .update(Buffer.from(value, "base64url"))
      .digest();
  }
}
