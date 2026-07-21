export interface QueuedCommandProjection {
  readonly commandId: string;
  readonly deviceId: string;
  readonly actorId: string;
  readonly actorDisplayName: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface AuthenticatedDeviceContext {
  readonly deviceId: string;
  readonly keyId: string;
  readonly nonceDigest: Uint8Array;
}

export type PollStoreResult =
  | { readonly outcome: "NO_COMMAND" }
  | {
      readonly outcome: "COMMAND";
      readonly command: QueuedCommandProjection;
    }
  | {
      readonly outcome: "REJECTED";
      readonly reason: "AUTHENTICATION_FAILED" | "REPLAYED_REQUEST";
    };

export interface AgentPollStore {
  poll(input: {
    readonly device: AuthenticatedDeviceContext;
    readonly now: Date;
    readonly dispatchedEventId: string;
    readonly expiredEventId: string;
    readonly cancelledEventId: string;
  }): Promise<PollStoreResult>;
}

export function createPollAgent(dependencies: {
  readonly store: AgentPollStore;
  readonly newId: () => string;
}) {
  return async function pollAgent(
    device: AuthenticatedDeviceContext,
    now: Date,
  ): Promise<PollStoreResult> {
    return dependencies.store.poll({
      device,
      now,
      dispatchedEventId: dependencies.newId(),
      expiredEventId: dependencies.newId(),
      cancelledEventId: dependencies.newId(),
    });
  };
}
