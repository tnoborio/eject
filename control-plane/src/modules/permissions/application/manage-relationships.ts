export interface RelationshipInvitationSecret {
  readonly value: string;
  readonly digest: Uint8Array;
}

export interface RelationshipInvitationCrypto {
  generateSecret(): RelationshipInvitationSecret;
  digestSecret(value: string): Uint8Array;
}

export type CreateRelationshipInvitationResult =
  | {
      readonly outcome: "CREATED";
      readonly invitationCode: string;
      readonly expiresAt: Date;
    }
  | {
      readonly outcome: "REJECTED";
      readonly reason: "ACCOUNT_UNAVAILABLE";
    };

export type AcceptRelationshipInvitationResult =
  | { readonly outcome: "CONNECTED" | "ALREADY_CONNECTED" }
  | {
      readonly outcome: "REJECTED";
      readonly reason: "INVITATION_UNAVAILABLE";
    };

export interface RelationshipStore {
  createInvitation(input: {
    readonly invitationId: string;
    readonly inviterId: string;
    readonly invitationDigest: Uint8Array;
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<"CREATED" | "ACCOUNT_UNAVAILABLE">;

  acceptInvitation(input: {
    readonly accepterId: string;
    readonly invitationDigest: Uint8Array;
    readonly now: Date;
  }): Promise<"CONNECTED" | "ALREADY_CONNECTED" | "INVITATION_UNAVAILABLE">;
}

export function createRelationshipInvitation(dependencies: {
  readonly store: RelationshipStore;
  readonly crypto: RelationshipInvitationCrypto;
  readonly newId: () => string;
}) {
  return async function create(
    inviterId: string,
    now: Date,
  ): Promise<CreateRelationshipInvitationResult> {
    const invitation = dependencies.crypto.generateSecret();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const result = await dependencies.store.createInvitation({
      invitationId: dependencies.newId(),
      inviterId,
      invitationDigest: invitation.digest,
      now,
      expiresAt,
    });
    return result === "CREATED"
      ? {
          outcome: "CREATED",
          invitationCode: invitation.value,
          expiresAt,
        }
      : { outcome: "REJECTED", reason: result };
  };
}

export function createAcceptRelationshipInvitation(dependencies: {
  readonly store: RelationshipStore;
  readonly crypto: RelationshipInvitationCrypto;
}) {
  return async function accept(
    accepterId: string,
    invitationCode: string,
    now: Date,
  ): Promise<AcceptRelationshipInvitationResult> {
    const result = await dependencies.store.acceptInvitation({
      accepterId,
      invitationDigest: dependencies.crypto.digestSecret(invitationCode),
      now,
    });
    return result === "INVITATION_UNAVAILABLE"
      ? { outcome: "REJECTED", reason: result }
      : { outcome: result };
  };
}
