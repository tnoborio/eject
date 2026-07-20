import { describe, expect, it } from "vitest";
import {
  authorizeEject,
  type AuthorizationFacts,
} from "../src/modules/eject/domain/authorization";
import { allowedFacts, now } from "./fixtures/authorization";

describe("authorizeEject", () => {
  it("authorizes the narrow default and returns the minimum exposure ceiling", () => {
    expect(authorizeEject(allowedFacts(), now)).toEqual({
      authorized: true,
      effectiveExposureLimit: 3,
    });
  });

  it.each([
    [{ actorAuthenticated: false }, "ACTOR_RESTRICTED"],
    [{ actorRestricted: true }, "ACTOR_RESTRICTED"],
    [{ blocked: true }, "PERMISSION_REQUIRED"],
    [{ directionalGrantActive: false }, "PERMISSION_REQUIRED"],
    [{ actorParticipation: "ACCOUNT_ONLY" }, "PERMISSION_REQUIRED"],
    [{ actorAvailability: "OFFLINE" }, "PERMISSION_REQUIRED"],
    [{ recipientPaused: true }, "RECIPIENT_PAUSED"],
    [{ quietHoursActive: true }, "QUIET_HOURS_ACTIVE"],
    [
      { cooldownUntil: new Date("2026-07-20T00:00:00.001Z") },
      "COOLDOWN_ACTIVE",
    ],
    [{ recipientAcceptedInWindow: 3 }, "RATE_LIMITED"],
    [{ senderAcceptedInWindow: 5 }, "RATE_LIMITED"],
    [{ deviceEligible: false }, "DEVICE_UNAVAILABLE"],
    [{ deliveryEnabled: false }, "DEVICE_UNAVAILABLE"],
  ] satisfies readonly [Partial<AuthorizationFacts>, string][])(
    "rejects %o with %s",
    (overrides, reason) => {
      expect(authorizeEject(allowedFacts(overrides), now)).toEqual({
        authorized: false,
        reason,
      });
    },
  );

  it("does not treat an elapsed cooldown as active", () => {
    expect(
      authorizeEject(
        allowedFacts({ cooldownUntil: new Date(now.getTime()) }),
        now,
      ),
    ).toMatchObject({ authorized: true });
  });

  it("allows connected scope without a directional grant", () => {
    expect(
      authorizeEject(
        allowedFacts({
          audienceScope: "CONNECTED",
          directionalGrantActive: false,
        }),
        now,
      ),
    ).toMatchObject({ authorized: true });
  });

  it("requires a relationship for connected scope", () => {
    expect(
      authorizeEject(
        allowedFacts({ audienceScope: "CONNECTED", relationshipActive: false }),
        now,
      ),
    ).toEqual({ authorized: false, reason: "PERMISSION_REQUIRED" });
  });

  it("allows authenticated scope without a relationship", () => {
    expect(
      authorizeEject(
        allowedFacts({
          audienceScope: "ALL_AUTHENTICATED",
          relationshipActive: false,
          directionalGrantActive: false,
        }),
        now,
      ),
    ).toMatchObject({ authorized: true });
  });

  it("allows account-only senders only under explicit authenticated-account eligibility", () => {
    expect(
      authorizeEject(
        allowedFacts({
          senderEligibility: "AUTHENTICATED_ACCOUNTS",
          actorParticipation: "ACCOUNT_ONLY",
          actorAvailability: "OFFLINE",
        }),
        now,
      ),
    ).toMatchObject({ authorized: true });
  });

  it("uses a valid eject-back authorization instead of general audience access", () => {
    expect(
      authorizeEject(
        allowedFacts({
          requestKind: "EJECT_BACK",
          ejectBackValid: true,
          relationshipActive: false,
          directionalGrantActive: false,
        }),
        now,
      ),
    ).toMatchObject({ authorized: true });
  });

  it("rejects an invalid eject-back authorization", () => {
    expect(
      authorizeEject(
        allowedFacts({ requestKind: "EJECT_BACK", ejectBackValid: false }),
        now,
      ),
    ).toEqual({ authorized: false, reason: "PERMISSION_REQUIRED" });
  });
});
