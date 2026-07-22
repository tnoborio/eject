import { describe, expect, it } from "vitest";
import { readPersonAccessToken } from "../src/modules/identity/transport/person-session-cookie";

const token = "header.payload.signature";

describe("person session cookie", () => {
  it("reads only the fixed host-only access cookie", () => {
    const request = requestWithCookie(
      `unrelated=value; __Host-eject-access=${token}; locale=ja`,
    );
    expect(readPersonAccessToken(request)).toBe(token);
  });

  it("rejects missing, duplicate, encoded, malformed, and oversized tokens", () => {
    const cases = [
      undefined,
      "",
      "other=value",
      "malformed; other=value",
      `__Host-eject-access=${token}; __Host-eject-access=${token}`,
      "__Host-eject-access=",
      "__Host-eject-access=header%2Epayload%2Esignature",
      "__Host-eject-access=not-a-jwt",
      `__Host-eject-access=${"a".repeat(8_193)}.b.c`,
      `other=${"a".repeat(16_385)}`,
    ];
    for (const cookie of cases) {
      expect(readPersonAccessToken(requestWithCookie(cookie))).toBeNull();
    }
  });
});

function requestWithCookie(cookie: string | undefined): Request {
  if (cookie === undefined) {
    return new Request("https://eject.test/account");
  }
  return new Request("https://eject.test/account", {
    headers: { cookie },
  });
}
