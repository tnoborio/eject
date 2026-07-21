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
    // Stryker disable next-line ArrayDeclaration: terminal state has no valid outgoing state to assert.
    REJECTED: [],
    AUTHORIZED: ["QUEUED", "CANCELLED"],
    QUEUED: ["DISPATCHED", "EXPIRED", "CANCELLED"],
    DISPATCHED: ["DISPATCHED", "DELIVERED", "EXPIRED", "CANCELLED"],
    DELIVERED: ["REJECTED_BY_AGENT", "ATTEMPTED"],
    // Stryker disable next-line ArrayDeclaration: terminal state has no valid outgoing state to assert.
    REJECTED_BY_AGENT: [],
    ATTEMPTED: ["FAILED", "OUTCOME_UNKNOWN"],
    // Stryker disable next-line ArrayDeclaration: terminal state has no valid outgoing state to assert.
    EXPIRED: [],
    // Stryker disable next-line ArrayDeclaration: terminal state has no valid outgoing state to assert.
    CANCELLED: [],
    // Stryker disable next-line ArrayDeclaration: terminal state has no valid outgoing state to assert.
    FAILED: [],
    // Stryker disable next-line ArrayDeclaration: terminal state has no valid outgoing state to assert.
    OUTCOME_UNKNOWN: [],
  };

export function canTransition(
  from: LifecycleState,
  to: LifecycleState,
): boolean {
  return transitions[from].includes(to);
}
