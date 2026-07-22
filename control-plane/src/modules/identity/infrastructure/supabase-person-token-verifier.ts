import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type {
  PersonAccessTokenVerifier,
  VerifiedPersonToken,
} from "../application/authenticate-person-session";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const compactJwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const maximumAccessTokenLength = 8_192;

export interface SupabasePersonTokenVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly keyResolver?: JWTVerifyGetKey;
}

export class SupabasePersonTokenVerifier implements PersonAccessTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly keyResolver: JWTVerifyGetKey;

  constructor(config: SupabasePersonTokenVerifierConfig) {
    const issuer = parseIssuer(config.issuer);
    this.issuer = issuer.toString();
    this.audience = parseAudience(config.audience);
    this.keyResolver =
      config.keyResolver ??
      createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
        cacheMaxAge: 600_000,
        cooldownDuration: 30_000,
      });
  }

  async verify(accessToken: string): Promise<VerifiedPersonToken | null> {
    if (
      accessToken.length === 0 ||
      accessToken.length > maximumAccessTokenLength ||
      !compactJwtPattern.test(accessToken)
    ) {
      return null;
    }

    try {
      const { payload } = await jwtVerify(accessToken, this.keyResolver, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["ES256", "RS256"],
        requiredClaims: ["iss", "aud", "exp", "sub"],
      });
      if (
        payload.aud !== this.audience ||
        typeof payload.sub !== "string" ||
        !uuidPattern.test(payload.sub)
      ) {
        return null;
      }
      return { personId: payload.sub };
    } catch (error: unknown) {
      if (isInvalidTokenError(error)) return null;
      throw error;
    }
  }
}

function parseIssuer(value: string): URL {
  let issuer: URL;
  try {
    issuer = new URL(value);
  } catch {
    throw new Error("Supabase Auth issuer is not a URL");
  }
  if (
    issuer.protocol !== "https:" ||
    issuer.username !== "" ||
    issuer.password !== "" ||
    issuer.search !== "" ||
    issuer.hash !== "" ||
    issuer.pathname !== "/auth/v1"
  ) {
    throw new Error("Supabase Auth issuer must be an HTTPS /auth/v1 URL");
  }
  return issuer;
}

function parseAudience(value: string): string {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(value)) {
    throw new Error("Supabase Auth audience is invalid");
  }
  return value;
}

function isInvalidTokenError(error: unknown): boolean {
  return (
    error instanceof errors.JWTClaimValidationFailed ||
    error instanceof errors.JWTExpired ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JOSEAlgNotAllowed ||
    error instanceof errors.JOSENotSupported ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys
  );
}
