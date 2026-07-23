import { describe, expect, it, vi } from "vitest";
import {
  createReadRecipientConsent,
  createSetRecipientGrant,
  createSetRecipientPaused,
  type RecipientConsentStore,
} from "../src/modules/permissions/application/manage-recipient-consent";

const recipientId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-07-23T00:00:00.000Z");

describe("recipient consent application", () => {
  it("binds reads, pause, grants, and revocations to the recipient-owned port", async () => {
    const store = fakeStore();
    const read = createReadRecipientConsent({ store });
    const setPaused = createSetRecipientPaused({ store });
    const setGrant = createSetRecipientGrant({ store });

    await expect(read(recipientId)).resolves.toEqual({
      paused: false,
      connectedPeople: [],
    });
    await setPaused(recipientId, true, now);
    await expect(setGrant(recipientId, actorId, true, now)).resolves.toBe(
      "UPDATED",
    );
    await expect(setGrant(recipientId, actorId, false, now)).resolves.toBe(
      "UPDATED",
    );

    expect(store.read).toHaveBeenCalledWith(recipientId);
    expect(store.setPaused).toHaveBeenCalledWith({
      recipientId,
      paused: true,
      now,
    });
    expect(store.setGrant).toHaveBeenNthCalledWith(1, {
      recipientId,
      actorId,
      granted: true,
      now,
    });
    expect(store.setGrant).toHaveBeenNthCalledWith(2, {
      recipientId,
      actorId,
      granted: false,
      now,
    });
  });
});

function fakeStore(): RecipientConsentStore & {
  read: ReturnType<typeof vi.fn>;
  setPaused: ReturnType<typeof vi.fn>;
  setGrant: ReturnType<typeof vi.fn>;
} {
  return {
    read: vi.fn(async () => ({ paused: false, connectedPeople: [] })),
    setPaused: vi.fn(async () => {}),
    setGrant: vi.fn(async () => "UPDATED" as const),
  };
}
