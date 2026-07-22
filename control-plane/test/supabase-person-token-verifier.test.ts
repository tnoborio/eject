import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { SupabasePersonTokenVerifier } from "../src/modules/identity/infrastructure/supabase-person-token-verifier";

const issuer = "https://eject-test.supabase.co/auth/v1";
const audience = "authenticated";
const personId = "11111111-1111-4111-8111-111111111111";
let privateKey: CryptoKey;
let keyResolver: JWTVerifyGetKey;

beforeAll(async () => {
  const keys = await generateKeyPair("ES256", { extractable: true });
  privateKey = keys.privateKey;
  const publicJwk = await exportJWK(keys.publicKey);
  keyResolver = createLocalJWKSet({
    keys: [{ ...publicJwk, alg: "ES256", kid: "test-key", use: "sig" }],
  });
});

describe("SupabasePersonTokenVerifier", () => {
  it("accepts a signed token with exact claims and exposes only its UUID subject", async () => {
    const verifier = createVerifier();
    const token = await tokenFor({ email: "not-copied@example.test" });

    await expect(verifier.verify(token)).resolves.toEqual({ personId });
  });

  it("rejects wrong issuer, audience, expiry, subject, and signature", async () => {
    const verifier = createVerifier();
    const otherKeys = await generateKeyPair("ES256");
    const cases = [
      tokenFor({}, { issuer: "https://other.supabase.co/auth/v1" }),
      tokenFor({}, { audience: "service_role" }),
      tokenFor({}, { audience: [audience, "other"] }),
      tokenFor({}, { expiresAt: Math.floor(Date.now() / 1000) - 1 }),
      tokenFor({}, { subject: "browser-supplied-person" }),
      tokenFor({}, { signingKey: otherKeys.privateKey }),
      tokenWithNonStringSubject(),
    ];

    for (const token of await Promise.all(cases)) {
      await expect(verifier.verify(token)).resolves.toBeNull();
    }
  });

  it("rejects malformed and oversized values before key resolution", async () => {
    let calls = 0;
    const verifier = new SupabasePersonTokenVerifier({
      issuer,
      audience,
      keyResolver: async (...parameters) => {
        calls += 1;
        return keyResolver(...parameters);
      },
    });

    await expect(verifier.verify("")).resolves.toBeNull();
    await expect(verifier.verify("not-a-jwt")).resolves.toBeNull();
    await expect(
      verifier.verify(`${"a".repeat(8_193)}.b.c`),
    ).resolves.toBeNull();
    expect(calls).toBe(0);
  });

  it("fails closed for JOSE validation errors but preserves dependency failures", async () => {
    const token = await tokenFor({});
    const invalidTokenErrors = [
      errors.JWTClaimValidationFailed.prototype,
      errors.JWTExpired.prototype,
      errors.JWTInvalid.prototype,
      errors.JWSInvalid.prototype,
      errors.JWSSignatureVerificationFailed.prototype,
      errors.JOSEAlgNotAllowed.prototype,
      errors.JOSENotSupported.prototype,
      errors.JWKSNoMatchingKey.prototype,
      errors.JWKSMultipleMatchingKeys.prototype,
    ];
    for (const prototype of invalidTokenErrors) {
      const verifier = new SupabasePersonTokenVerifier({
        issuer,
        audience,
        keyResolver: async () => {
          throw Object.create(prototype) as unknown;
        },
      });
      await expect(verifier.verify(token)).resolves.toBeNull();
    }

    const unavailable = new Error("JWKS unavailable");
    const verifier = new SupabasePersonTokenVerifier({
      issuer,
      audience,
      keyResolver: async () => {
        throw unavailable;
      },
    });
    await expect(verifier.verify(token)).rejects.toBe(unavailable);
  });

  it("requires a fixed HTTPS Supabase issuer and bounded audience", () => {
    const invalidIssuers = [
      "not a URL",
      "http://eject-test.supabase.co/auth/v1",
      "https://user@eject-test.supabase.co/auth/v1",
      "https://user:password@eject-test.supabase.co/auth/v1",
      `${issuer}?unexpected=true`,
      `${issuer}#unexpected`,
      `${issuer}/`,
    ];
    for (const invalidIssuer of invalidIssuers) {
      expect(
        () =>
          new SupabasePersonTokenVerifier({
            issuer: invalidIssuer,
            audience,
            keyResolver,
          }),
      ).toThrow("Supabase Auth issuer");
    }
    expect(
      () =>
        new SupabasePersonTokenVerifier({
          issuer,
          audience: "",
          keyResolver,
        }),
    ).toThrow("Supabase Auth audience");

    expect(
      new SupabasePersonTokenVerifier({ issuer, audience }),
    ).toBeInstanceOf(SupabasePersonTokenVerifier);
  });
});

function createVerifier(): SupabasePersonTokenVerifier {
  return new SupabasePersonTokenVerifier({ issuer, audience, keyResolver });
}

async function tokenFor(
  payload: Readonly<Record<string, unknown>>,
  options: {
    readonly issuer?: string;
    readonly audience?: string | string[];
    readonly subject?: string;
    readonly expiresAt?: number;
    readonly signingKey?: CryptoKey;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", kid: "test-key", typ: "JWT" })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setSubject(options.subject ?? personId)
    .setIssuedAt(now)
    .setExpirationTime(options.expiresAt ?? now + 60)
    .sign(options.signingKey ?? privateKey);
}

async function tokenWithNonStringSubject(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: 123 } as unknown as JWTPayload)
    .setProtectedHeader({ alg: "ES256", kid: "test-key", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(privateKey);
}
