export interface ConnectedPersonConsent {
  readonly personId: string;
  readonly displayName: string;
  readonly grantActive: boolean;
  readonly accountAvailable: boolean;
}

export interface RecipientConsentSnapshot {
  readonly paused: boolean;
  readonly connectedPeople: readonly ConnectedPersonConsent[];
}

export type SetRecipientGrantResult = "UPDATED" | "CONNECTION_REQUIRED";

export interface RecipientConsentStore {
  read(recipientId: string): Promise<RecipientConsentSnapshot>;

  setPaused(input: {
    readonly recipientId: string;
    readonly paused: boolean;
    readonly now: Date;
  }): Promise<void>;

  setGrant(input: {
    readonly recipientId: string;
    readonly actorId: string;
    readonly granted: boolean;
    readonly now: Date;
  }): Promise<SetRecipientGrantResult>;
}

export function createReadRecipientConsent(dependencies: {
  readonly store: RecipientConsentStore;
}) {
  return async function read(
    recipientId: string,
  ): Promise<RecipientConsentSnapshot> {
    return dependencies.store.read(recipientId);
  };
}

export function createSetRecipientPaused(dependencies: {
  readonly store: RecipientConsentStore;
}) {
  return async function setPaused(
    recipientId: string,
    paused: boolean,
    now: Date,
  ): Promise<void> {
    await dependencies.store.setPaused({ recipientId, paused, now });
  };
}

export function createSetRecipientGrant(dependencies: {
  readonly store: RecipientConsentStore;
}) {
  return async function setGrant(
    recipientId: string,
    actorId: string,
    granted: boolean,
    now: Date,
  ): Promise<SetRecipientGrantResult> {
    return dependencies.store.setGrant({
      recipientId,
      actorId,
      granted,
      now,
    });
  };
}
