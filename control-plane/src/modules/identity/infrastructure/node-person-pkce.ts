import { createHash, randomBytes } from "node:crypto";
import type {
  PersonPkceChallenge,
  PersonPkceGenerator,
} from "../application/manage-person-session";

export class NodePersonPkceGenerator implements PersonPkceGenerator {
  createChallenge(): PersonPkceChallenge {
    const verifier = randomBytes(32).toString("base64url");
    return {
      verifier,
      challenge: createHash("sha256")
        .update(verifier, "ascii")
        .digest("base64url"),
      state: randomBytes(32).toString("base64url"),
    };
  }
}
