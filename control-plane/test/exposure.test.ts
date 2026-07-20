import { describe, expect, it } from "vitest";
import { effectiveExposureLimit } from "../src/modules/eject/domain/exposure";

describe("effectiveExposureLimit", () => {
  it("rejects unsafe, fractional, and negative ceilings", () => {
    expect(() =>
      effectiveExposureLimit({
        recipientSelected: Number.NaN,
        planEntitlement: 1,
        physicalSafety: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      effectiveExposureLimit({
        recipientSelected: 1.5,
        planEntitlement: 1,
        physicalSafety: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      effectiveExposureLimit({
        recipientSelected: -1,
        planEntitlement: 1,
        physicalSafety: 1,
      }),
    ).toThrow(RangeError);
  });
});
