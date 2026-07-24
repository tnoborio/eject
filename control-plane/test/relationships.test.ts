import { describe, expect, it, vi } from "vitest";
import {
  createAcceptRelationshipInvitation,
  createCleanupRelationshipInvitations,
  createDisconnectRelationship,
  createRelationshipInvitation,
  type RelationshipInvitationCrypto,
  type RelationshipStore,
} from "../src/modules/permissions/application/manage-relationships";
import { NodeRelationshipInvitationCrypto } from "../src/modules/permissions/infrastructure/node-relationship-invitation-crypto";

const inviterId = "11111111-1111-4111-8111-111111111111";
const accepterId = "22222222-2222-4222-8222-222222222222";
const invitationId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-07-24T00:00:00.000Z");
const invitationCode = "A".repeat(43);
const invitationDigest = new Uint8Array(32).fill(7);

describe("relationship invitation application", () => {
  it("creates a digest-only ten-minute invitation", async () => {
    const store = fakeStore();
    const create = createRelationshipInvitation({
      store,
      crypto: fakeCrypto(),
      newId: () => invitationId,
    });
    await expect(create(inviterId, now)).resolves.toEqual({
      outcome: "CREATED",
      invitationCode,
      expiresAt: new Date(now.getTime() + 600_000),
    });
    expect(store.createInvitation).toHaveBeenCalledWith({
      invitationId,
      inviterId,
      invitationDigest,
      now,
      expiresAt: new Date(now.getTime() + 600_000),
    });

    store.createInvitation.mockResolvedValueOnce("ACCOUNT_UNAVAILABLE");
    await expect(create(inviterId, now)).resolves.toEqual({
      outcome: "REJECTED",
      reason: "ACCOUNT_UNAVAILABLE",
    });
  });

  it("maps one-use acceptance without granting any permission", async () => {
    const store = fakeStore();
    const accept = createAcceptRelationshipInvitation({
      store,
      crypto: fakeCrypto(),
    });
    await expect(accept(accepterId, invitationCode, now)).resolves.toEqual({
      outcome: "CONNECTED",
    });
    store.acceptInvitation.mockResolvedValueOnce("ALREADY_CONNECTED");
    await expect(accept(accepterId, invitationCode, now)).resolves.toEqual({
      outcome: "ALREADY_CONNECTED",
    });
    store.acceptInvitation.mockResolvedValueOnce("INVITATION_UNAVAILABLE");
    await expect(accept(accepterId, invitationCode, now)).resolves.toEqual({
      outcome: "REJECTED",
      reason: "INVITATION_UNAVAILABLE",
    });
    expect(store.acceptInvitation).toHaveBeenCalledWith({
      accepterId,
      invitationDigest,
      now,
    });
  });

  it("generates 256-bit base64url secrets and stable SHA-256 digests", () => {
    const crypto = new NodeRelationshipInvitationCrypto();
    const secret = crypto.generateSecret();
    expect(secret.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secret.digest).toHaveLength(32);
    expect(crypto.digestSecret(secret.value)).toEqual(secret.digest);
  });

  it("disconnects a selected relationship without broadening the request", async () => {
    const store = fakeStore();
    const disconnect = createDisconnectRelationship({ store });
    await expect(disconnect(inviterId, accepterId, now)).resolves.toBe(
      "DISCONNECTED",
    );
    expect(store.disconnectRelationship).toHaveBeenCalledWith({
      personId: inviterId,
      otherPersonId: accepterId,
      now,
    });
  });

  it("deletes invitation metadata only after the 24-hour boundary", async () => {
    const store = fakeStore();
    store.cleanupInvitations.mockResolvedValueOnce(12);
    const cleanup = createCleanupRelationshipInvitations({ store });
    await expect(cleanup(now)).resolves.toBe(12);
    expect(store.cleanupInvitations).toHaveBeenCalledWith({
      before: new Date(now.getTime() - 24 * 60 * 60_000),
      limit: 500,
    });
  });
});

function fakeCrypto(): RelationshipInvitationCrypto {
  return {
    generateSecret: () => ({
      value: invitationCode,
      digest: invitationDigest,
    }),
    digestSecret: vi.fn(() => invitationDigest),
  };
}

function fakeStore(): RelationshipStore & {
  createInvitation: ReturnType<typeof vi.fn>;
  acceptInvitation: ReturnType<typeof vi.fn>;
  disconnectRelationship: ReturnType<typeof vi.fn>;
  cleanupInvitations: ReturnType<typeof vi.fn>;
} {
  return {
    createInvitation: vi.fn(async () => "CREATED" as const),
    acceptInvitation: vi.fn(async () => "CONNECTED" as const),
    disconnectRelationship: vi.fn(async () => "DISCONNECTED" as const),
    cleanupInvitations: vi.fn(async () => 0),
  };
}
