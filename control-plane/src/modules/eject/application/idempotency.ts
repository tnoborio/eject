import { createHash } from "node:crypto";

export interface SemanticRequest {
  readonly actorId: string;
  readonly recipientId: string;
  readonly action: "EJECT" | "EJECT_BACK";
  readonly replyToCommandId: string | null;
}

export function semanticRequestFingerprint(request: SemanticRequest): string {
  const canonical = [
    "eject-request-v1",
    request.actorId,
    request.recipientId,
    request.action,
    request.replyToCommandId ?? "",
  ].join("\n");

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
