import { describe, expect, it, vi } from "vitest";
import {
  createAcceptRelationshipInvitation,
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
} {
  return {
    createInvitation: vi.fn(async () => "CREATED" as const),
    acceptInvitation: vi.fn(async () => "CONNECTED" as const),
  };
}
