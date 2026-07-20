export type LifecycleState =
  | "REQUESTED"
  | "REJECTED"
  | "AUTHORIZED"
  | "QUEUED"
  | "DISPATCHED"
  | "DELIVERED"
  | "REJECTED_BY_AGENT"
  | "ATTEMPTED"
  | "EXPIRED"
  | "CANCELLED"
  | "FAILED"
  | "OUTCOME_UNKNOWN";

const transitions: Readonly<Record<LifecycleState, readonly LifecycleState[]>> =
  {
    REQUESTED: ["REJECTED", "AUTHORIZED"],
    REJECTED: [],
    AUTHORIZED: ["QUEUED", "CANCELLED"],
    QUEUED: ["DISPATCHED", "EXPIRED", "CANCELLED"],
    DISPATCHED: ["DISPATCHED", "DELIVERED", "EXPIRED", "CANCELLED"],
    DELIVERED: ["REJECTED_BY_AGENT", "ATTEMPTED"],
    REJECTED_BY_AGENT: [],
    ATTEMPTED: ["FAILED", "OUTCOME_UNKNOWN"],
    EXPIRED: [],
    CANCELLED: [],
    FAILED: [],
    OUTCOME_UNKNOWN: [],
  };

export function canTransition(
  from: LifecycleState,
  to: LifecycleState,
): boolean {
  return transitions[from].includes(to);
}
