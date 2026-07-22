import { describe, expect, it, vi } from "vitest";
import { createAuthenticatePersonSession } from "../src/modules/identity/application/authenticate-person-session";

const personId = "11111111-1111-4111-8111-111111111111";

describe("person session authentication", () => {
  it("derives identity only from the verified token and rechecks account status", async () => {
    const verify = vi.fn(async () => ({ personId }));
    const loadAccountStatus = vi
      .fn()
      .mockResolvedValueOnce("ACTIVE")
      .mockResolvedValueOnce("RESTRICTED");
    const authenticate = createAuthenticatePersonSession({
      tokens: { verify },
      accounts: { loadAccountStatus },
    });

    await expect(authenticate("signed.jwt.value")).resolves.toEqual({
      authenticated: true,
      context: { personId },
    });
    await expect(authenticate("signed.jwt.value")).resolves.toEqual({
      authenticated: false,
      reason: "ACCOUNT_UNAVAILABLE",
    });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(loadAccountStatus).toHaveBeenNthCalledWith(1, personId);
    expect(loadAccountStatus).toHaveBeenNthCalledWith(2, personId);
  });

  it("fails closed for missing, invalid, unknown, and restricted accounts", async () => {
    const invalid = createAuthenticatePersonSession({
      tokens: { verify: async () => null },
      accounts: {
        loadAccountStatus: vi.fn(async () => {
          throw new Error("must not read an unverified subject");
        }),
      },
    });
    await expect(invalid(null)).resolves.toEqual({
      authenticated: false,
      reason: "AUTHENTICATION_REQUIRED",
    });
    await expect(invalid("not.a.token")).resolves.toEqual({
      authenticated: false,
      reason: "AUTHENTICATION_REQUIRED",
    });

    for (const status of [null, "RESTRICTED"] as const) {
      const authenticate = createAuthenticatePersonSession({
        tokens: { verify: async () => ({ personId }) },
        accounts: { loadAccountStatus: async () => status },
      });
      await expect(authenticate("signed.jwt.value")).resolves.toEqual({
        authenticated: false,
        reason: "ACCOUNT_UNAVAILABLE",
      });
    }
  });
});
