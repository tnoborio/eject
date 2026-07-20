import type { AuthorizationFacts } from "../../src/modules/eject/domain/authorization";

export const now = new Date("2026-07-20T00:00:00.000Z");

export function allowedFacts(
  overrides: Partial<AuthorizationFacts> = {},
): AuthorizationFacts {
  return {
    actorAuthenticated: true,
    actorRestricted: false,
    actorParticipation: "PARTICIPATION_READY",
    actorAvailability: "AVAILABLE",
    audienceScope: "NAMED",
    senderEligibility: "READY_PARTICIPANTS_ONLY",
    relationshipActive: true,
    directionalGrantActive: true,
    blocked: false,
    recipientPaused: false,
    quietHoursActive: false,
    cooldownUntil: null,
    recipientAcceptedInWindow: 0,
    senderAcceptedInWindow: 0,
    senderLimit: 5,
    exposureCeilings: {
      recipientSelected: 3,
      planEntitlement: 4,
      physicalSafety: 5,
    },
    deviceEligible: true,
    deliveryEnabled: true,
    requestKind: "STANDARD",
    ejectBackValid: false,
    ...overrides,
  };
}
