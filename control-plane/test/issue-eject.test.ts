import { describe, expect, it } from "vitest";
import {
  createIssueEject,
  type IssuanceStore,
  type IssuanceTransaction,
} from "../src/modules/eject/application/issue-eject";
import { semanticRequestFingerprint } from "../src/modules/eject/application/idempotency";
import { allowedFacts } from "./fixtures/authorization";

function createHarness(overrides: Partial<IssuanceTransaction> = {}) {
  let id = 0;
  let recorded = 0;
  const transaction: IssuanceTransaction = {
    findIdempotentResult: async () => null,
    loadAuthorizationFacts: async () => allowedFacts(),
    recordRejection: async ({ requestId, reason }) => {
      recorded += 1;
      return { outcome: "REJECTED", requestId, reason };
    },
    recordQueued: async ({ requestId, commandId }) => {
      recorded += 1;
      return { outcome: "QUEUED", requestId, commandId };
    },
    ...overrides,
  };
  const store: IssuanceStore = {
    withSerializableRecipientLock: async (_recipientId, operation) =>
      operation(transaction),
  };
  const issue = createIssueEject({
    store,
    ids: { newId: () => `id-${++id}` },
  });

  return { issue, recorded: () => recorded };
}

const input = {
  actorId: "actor",
  recipientId: "recipient",
  idempotencyKey: "key",
  action: "EJECT" as const,
  replyToCommandId: null,
  now: new Date("2026-07-20T00:00:00.000Z"),
};

describe("issueEject", () => {
  it("records one queued command for an authorized request", async () => {
    const harness = createHarness();
    await expect(harness.issue(input)).resolves.toEqual({
      outcome: "QUEUED",
      requestId: "id-1",
      commandId: "id-2",
    });
    expect(harness.recorded()).toBe(1);
  });

  it("records rejection without creating a command", async () => {
    let queueCalls = 0;
    const harness = createHarness({
      loadAuthorizationFacts: async () => allowedFacts({ blocked: true }),
      recordQueued: async () => {
        queueCalls += 1;
        throw new Error("must not queue");
      },
    });
    await expect(harness.issue(input)).resolves.toMatchObject({
      outcome: "REJECTED",
      reason: "PERMISSION_REQUIRED",
    });
    expect(queueCalls).toBe(0);
  });

  it("returns an identical stored result without reevaluating", async () => {
    const result = {
      outcome: "REJECTED" as const,
      requestId: "old",
      reason: "RATE_LIMITED" as const,
    };
    const harness = createHarness({
      findIdempotentResult: async () => ({
        fingerprint: semanticRequestFingerprint(input),
        result,
      }),
      loadAuthorizationFacts: async () => {
        throw new Error("must not reauthorize");
      },
    });
    await expect(harness.issue(input)).resolves.toEqual(result);
  });

  it("rejects reuse of a key for different semantics", async () => {
    const harness = createHarness({
      findIdempotentResult: async () => ({
        fingerprint: "different",
        result: {
          outcome: "REJECTED",
          requestId: "old",
          reason: "RATE_LIMITED",
        },
      }),
    });
    await expect(harness.issue(input)).resolves.toEqual({
      outcome: "IDEMPOTENCY_CONFLICT",
    });
    expect(harness.recorded()).toBe(0);
  });
});
