import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { authorizeEject } from "../src/modules/eject/domain/authorization";
import { effectiveExposureLimit } from "../src/modules/eject/domain/exposure";
import { allowedFacts, now } from "./fixtures/authorization";

describe("authorization properties", () => {
  it("never lets a broader entitlement grant access", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (planEntitlement) => {
        const decision = authorizeEject(
          allowedFacts({
            directionalGrantActive: false,
            exposureCeilings: {
              recipientSelected: 1,
              planEntitlement,
              physicalSafety: 1,
            },
          }),
          now,
        );
        expect(decision).toEqual({
          authorized: false,
          reason: "PERMISSION_REQUIRED",
        });
      }),
    );
  });

  it("always lets block and pause defeat an otherwise valid request", () => {
    fc.assert(
      fc.property(fc.boolean(), (blocked) => {
        const decision = authorizeEject(
          allowedFacts({ blocked, recipientPaused: !blocked }),
          now,
        );
        expect(decision.authorized).toBe(false);
      }),
    );
  });

  it("never computes an exposure limit above any ceiling", () => {
    fc.assert(
      fc.property(
        fc.record({
          recipientSelected: fc.integer({ min: 0, max: 1_000_000 }),
          planEntitlement: fc.integer({ min: 0, max: 1_000_000 }),
          physicalSafety: fc.integer({ min: 0, max: 1_000_000 }),
        }),
        (ceilings) => {
          const result = effectiveExposureLimit(ceilings);
          expect(result).toBeLessThanOrEqual(ceilings.recipientSelected);
          expect(result).toBeLessThanOrEqual(ceilings.planEntitlement);
          expect(result).toBeLessThanOrEqual(ceilings.physicalSafety);
        },
      ),
    );
  });
});
