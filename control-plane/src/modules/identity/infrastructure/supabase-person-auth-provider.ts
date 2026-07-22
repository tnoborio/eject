import type {
  PersonAuthProvider,
  PersonAuthTokenResult,
  PersonSessionTokens,
} from "../application/manage-person-session";

const maximumResponseBytes = 64 * 1_024;
const compactJwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const refreshTokenPattern = /^[A-Za-z0-9._~-]{20,4096}$/;

export class SupabasePersonAuthProvider implements PersonAuthProvider {
  private readonly issuer: string;
  private readonly publishableKey: string;

  constructor(config: {
    readonly issuer: string;
    readonly publishableKey: string;
    readonly fetch?: typeof fetch;
  }) {
    this.issuer = parseIssuer(config.issuer);
    this.publishableKey = parsePublishableKey(config.publishableKey);
    this.fetcher = config.fetch ?? fetch;
  }

  private readonly fetcher: typeof fetch;

  async requestEmailSignIn(input: {
    readonly email: string;
    readonly redirectTo: string;
    readonly codeChallenge: string;
  }): Promise<"ACCEPTED" | "UNAVAILABLE"> {
    const result = await this.request(
      `/otp?redirect_to=${encodeURIComponent(input.redirectTo)}`,
      {
        email: input.email,
        data: {},
        create_user: false,
        code_challenge: input.codeChallenge,
        code_challenge_method: "s256",
      },
    );
    if (result.response === null) return "UNAVAILABLE";
    return result.response.ok ||
      result.response.status === 400 ||
      result.response.status === 422 ||
      result.response.status === 429
      ? "ACCEPTED"
      : "UNAVAILABLE";
  }

  async exchangeCode(input: {
    readonly code: string;
    readonly codeVerifier: string;
  }): Promise<PersonAuthTokenResult> {
    return this.requestTokens("/token?grant_type=pkce", {
      auth_code: input.code,
      code_verifier: input.codeVerifier,
    });
  }

  async verifyEmailOtp(input: {
    readonly email: string;
    readonly token: string;
  }): Promise<PersonAuthTokenResult> {
    return this.requestTokens("/verify", {
      email: input.email,
      token: input.token,
      type: "email",
    });
  }

  async refresh(refreshToken: string): Promise<PersonAuthTokenResult> {
    return this.requestTokens("/token?grant_type=refresh_token", {
      refresh_token: refreshToken,
    });
  }

  async signOut(accessToken: string): Promise<"SIGNED_OUT" | "UNAVAILABLE"> {
    const result = await this.request("/logout?scope=local", {}, accessToken);
    if (
      result.response !== null &&
      (result.response.ok ||
        result.response.status === 401 ||
        result.response.status === 403 ||
        result.response.status === 404)
    ) {
      return "SIGNED_OUT";
    }
    return "UNAVAILABLE";
  }

  private async requestTokens(
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<PersonAuthTokenResult> {
    const result = await this.request(path, body);
    if (result.response === null) return { outcome: "UNAVAILABLE" };
    if (!result.response.ok) {
      return result.response.status >= 500 || result.response.status === 429
        ? { outcome: "UNAVAILABLE" }
        : { outcome: "REJECTED" };
    }
    const tokens = parseTokens(result.body);
    return tokens === null
      ? { outcome: "UNAVAILABLE" }
      : { outcome: "TOKENS", tokens };
  }

  private async request(
    path: string,
    body: Readonly<Record<string, unknown>>,
    accessToken?: string,
  ): Promise<{
    readonly response: Response | null;
    readonly body: Uint8Array;
  }> {
    try {
      const response = await this.fetcher(`${this.issuer}${path}`, {
        method: "POST",
        headers: {
          apikey: this.publishableKey,
          authorization: `Bearer ${accessToken ?? this.publishableKey}`,
          "content-type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
      const responseBody = await readBoundedResponse(response);
      return responseBody === null
        ? { response: null, body: new Uint8Array() }
        : { response, body: responseBody };
    } catch {
      return { response: null, body: new Uint8Array() };
    }
  }
}

function parseIssuer(value: string): string {
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
  return issuer.toString().replace(/\/$/, "");
}

function parsePublishableKey(value: string): string {
  if (
    value.length < 20 ||
    value.length > 2_048 ||
    !/^[A-Za-z0-9._-]+$/.test(value)
  ) {
    throw new Error("Supabase publishable key is invalid");
  }
  return value;
}

async function readBoundedResponse(
  response: Response,
): Promise<Uint8Array | null> {
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > maximumResponseBytes)
  ) {
    return null;
  }
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maximumResponseBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseTokens(body: Uint8Array): PersonSessionTokens | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("access_token" in value) ||
    !("refresh_token" in value) ||
    !("expires_in" in value) ||
    !("token_type" in value) ||
    typeof value.access_token !== "string" ||
    typeof value.refresh_token !== "string" ||
    typeof value.expires_in !== "number" ||
    value.token_type !== "bearer" ||
    !Number.isInteger(value.expires_in) ||
    value.expires_in < 60 ||
    value.expires_in > 604_800 ||
    value.access_token.length > 8_192 ||
    !compactJwtPattern.test(value.access_token) ||
    !refreshTokenPattern.test(value.refresh_token)
  ) {
    return null;
  }
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresInSeconds: value.expires_in,
  };
}
