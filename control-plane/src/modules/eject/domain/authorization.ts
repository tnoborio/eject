import { effectiveExposureLimit, type ExposureCeilings } from "./exposure";

export type AudienceScope = "NAMED" | "CONNECTED" | "ALL_AUTHENTICATED";
export type SenderEligibility =
  "READY_PARTICIPANTS_ONLY" | "AUTHENTICATED_ACCOUNTS";
export type ParticipationState =
  "ACCOUNT_ONLY" | "SETUP_IN_PROGRESS" | "PARTICIPATION_READY" | "REVOKED";
export type Availability = "AVAILABLE" | "PAUSED" | "OFFLINE";
export type RejectionReason =
  | "PERMISSION_REQUIRED"
  | "RECIPIENT_PAUSED"
  | "QUIET_HOURS_ACTIVE"
  | "COOLDOWN_ACTIVE"
  | "RATE_LIMITED"
  | "DEVICE_UNAVAILABLE"
  | "ACTOR_RESTRICTED";

export interface AuthorizationFacts {
  readonly actorAuthenticated: boolean;
  readonly actorRestricted: boolean;
  readonly actorParticipation: ParticipationState;
  readonly actorAvailability: Availability;
  readonly audienceScope: AudienceScope;
  readonly senderEligibility: SenderEligibility;
  readonly relationshipActive: boolean;
  readonly directionalGrantActive: boolean;
  readonly blocked: boolean;
  readonly recipientPaused: boolean;
  readonly quietHoursActive: boolean;
  readonly cooldownUntil: Date | null;
  readonly recipientAcceptedInWindow: number;
  readonly senderAcceptedInWindow: number;
  readonly senderLimit: number;
  readonly exposureCeilings: ExposureCeilings;
  readonly deviceEligible: boolean;
  readonly deliveryEnabled: boolean;
  readonly requestKind: "STANDARD" | "EJECT_BACK";
  readonly ejectBackValid: boolean;
}

export type AuthorizationDecision =
  | { readonly authorized: true; readonly effectiveExposureLimit: number }
  | { readonly authorized: false; readonly reason: RejectionReason };

export function authorizeEject(
  facts: AuthorizationFacts,
  now: Date,
): AuthorizationDecision {
  if (!facts.actorAuthenticated || facts.actorRestricted) {
    return rejected("ACTOR_RESTRICTED");
  }

  if (facts.blocked || !hasAccess(facts) || !senderIsEligible(facts)) {
    return rejected("PERMISSION_REQUIRED");
  }

  if (facts.recipientPaused) {
    return rejected("RECIPIENT_PAUSED");
  }

  if (facts.quietHoursActive) {
    return rejected("QUIET_HOURS_ACTIVE");
  }

  if (
    facts.cooldownUntil !== null &&
    now.getTime() < facts.cooldownUntil.getTime()
  ) {
    return rejected("COOLDOWN_ACTIVE");
  }

  const exposureLimit = effectiveExposureLimit(facts.exposureCeilings);
  if (
    facts.recipientAcceptedInWindow >= exposureLimit ||
    facts.senderAcceptedInWindow >= facts.senderLimit
  ) {
    return rejected("RATE_LIMITED");
  }

  if (!facts.deliveryEnabled || !facts.deviceEligible) {
    return rejected("DEVICE_UNAVAILABLE");
  }

  return { authorized: true, effectiveExposureLimit: exposureLimit };
}

function hasAccess(facts: AuthorizationFacts): boolean {
  if (facts.requestKind === "EJECT_BACK") {
    return facts.ejectBackValid;
  }

  switch (facts.audienceScope) {
    case "NAMED":
      return facts.relationshipActive && facts.directionalGrantActive;
    case "CONNECTED":
      return facts.relationshipActive;
    case "ALL_AUTHENTICATED":
      return true;
  }
}

function senderIsEligible(facts: AuthorizationFacts): boolean {
  if (facts.senderEligibility === "AUTHENTICATED_ACCOUNTS") {
    return true;
  }

  return (
    facts.actorParticipation === "PARTICIPATION_READY" &&
    facts.actorAvailability === "AVAILABLE"
  );
}

function rejected(reason: RejectionReason): AuthorizationDecision {
  return { authorized: false, reason };
}
