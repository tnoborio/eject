import { describe, expect, it } from "vitest";
import { semanticRequestFingerprint } from "../src/modules/eject/application/idempotency";

const request = {
  actorId: "11111111-1111-4111-8111-111111111111",
  recipientId: "22222222-2222-4222-8222-222222222222",
  action: "EJECT" as const,
  replyToCommandId: null,
};

describe("semanticRequestFingerprint", () => {
  it("is stable for identical semantics", () => {
    expect(semanticRequestFingerprint(request)).toBe(
      "876fc8e8d6a9b7c8659df25d83685b07bf36b8a04a161a0e24ac23b1d8722014",
    );
  });

  it("binds actor, recipient, action, and eject-back source", () => {
    const baseline = semanticRequestFingerprint(request);
    expect(
      new Set([
        baseline,
        semanticRequestFingerprint({ ...request, actorId: "different" }),
        semanticRequestFingerprint({ ...request, recipientId: "different" }),
        semanticRequestFingerprint({ ...request, action: "EJECT_BACK" }),
        semanticRequestFingerprint({
          ...request,
          replyToCommandId: "different",
        }),
      ]).size,
    ).toBe(5);
  });
});
