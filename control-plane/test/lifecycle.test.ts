import { describe, expect, it } from "vitest";
import {
  canTransition,
  type LifecycleState,
} from "../src/modules/eject/domain/lifecycle";

const states: readonly LifecycleState[] = [
  "REQUESTED",
  "REJECTED",
  "AUTHORIZED",
  "QUEUED",
  "DISPATCHED",
  "DELIVERED",
  "REJECTED_BY_AGENT",
  "ATTEMPTED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
  "OUTCOME_UNKNOWN",
];

describe("canTransition", () => {
  it("allows only the protocol-v1 lifecycle graph", () => {
    const allowed = new Set([
      "REQUESTED>REJECTED",
      "REQUESTED>AUTHORIZED",
      "AUTHORIZED>QUEUED",
      "AUTHORIZED>CANCELLED",
      "QUEUED>DISPATCHED",
      "QUEUED>EXPIRED",
      "QUEUED>CANCELLED",
      "DISPATCHED>DISPATCHED",
      "DISPATCHED>DELIVERED",
      "DISPATCHED>EXPIRED",
      "DISPATCHED>CANCELLED",
      "DELIVERED>REJECTED_BY_AGENT",
      "DELIVERED>ATTEMPTED",
      "ATTEMPTED>FAILED",
      "ATTEMPTED>OUTCOME_UNKNOWN",
    ]);

    for (const from of states) {
      for (const to of states) {
        expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });
});
