import type { PersonSessionLifecycle } from "../application/manage-person-session";
import { parsePersonOriginPostRequest } from "./person-http-auth";
import {
  appendClearPersonPkceCookies,
  appendClearPersonSessionCookies,
  appendPersonPkceCookies,
  appendPersonSessionCookies,
  readPersonAccessToken,
  readPersonPkceChallenge,
  readPersonRefreshToken,
} from "./person-session-cookie";

const beginPath = "/api/person/v1/auth/magic-link";
const callbackPath = "/api/person/v1/auth/callback";
const otpPath = "/api/person/v1/auth/verify-otp";
const refreshPath = "/api/person/v1/auth/refresh";
const logoutPath = "/api/person/v1/auth/logout";
const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/;
const otpPattern = /^[0-9]{6,10}$/;
const codePattern = /^[A-Za-z0-9._~-]{20,512}$/;
const statePattern = /^[A-Za-z0-9_-]{43}$/;

export interface PersonAuthHttpDependencies {
  readonly expectedOrigin: string;
  readonly lifecycle: PersonSessionLifecycle;
}

export async function handleBeginPersonAuth(
  request: Request,
  dependencies: PersonAuthHttpDependencies,
): Promise<Response> {
  const parsed = await parsePersonOriginPostRequest(
    request,
    beginPath,
    dependencies.expectedOrigin,
    320,
  );
  if (!parsed.valid) return requestError(parsed.reason);
  const email = parseEmailBody(parsed.body);
  if (email === null) return error("INVALID_REQUEST", 400);

  const result = await dependencies.lifecycle.begin(email, (state) => {
    const callback = new URL(callbackPath, dependencies.expectedOrigin);
    callback.searchParams.set("state", state);
    return callback.toString();
  });
  const headers = noStoreHeaders();
  appendPersonPkceCookies(headers, result.challenge);
  return result.outcome === "ACCEPTED"
    ? new Response(null, { status: 202, headers })
    : error("SERVICE_UNAVAILABLE", 503, headers);
}

export async function handlePersonAuthCallback(
  request: Request,
  dependencies: PersonAuthHttpDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const code = singleQueryValue(url, "code");
  const state = singleQueryValue(url, "state");
  const challenge = readPersonPkceChallenge(request);
  if (
    request.method !== "GET" ||
    url.pathname !== callbackPath ||
    url.searchParams.size !== 2 ||
    code === null ||
    state === null ||
    !codePattern.test(code) ||
    !statePattern.test(state) ||
    challenge === null ||
    challenge.state !== state
  ) {
    const headers = noStoreHeaders();
    appendClearPersonPkceCookies(headers);
    return error("AUTHENTICATION_FAILED", 400, headers);
  }

  const result = await dependencies.lifecycle.exchangeCode(
    code,
    challenge.verifier,
  );
  const headers = noStoreHeaders();
  appendClearPersonPkceCookies(headers);
  if (result.outcome === "AUTHENTICATED") {
    appendPersonSessionCookies(headers, result.tokens);
    headers.set("location", "/");
    return new Response(null, { status: 303, headers });
  }
  return error(
    result.outcome === "REJECTED"
      ? "AUTHENTICATION_FAILED"
      : "SERVICE_UNAVAILABLE",
    result.outcome === "REJECTED" ? 401 : 503,
    headers,
  );
}

export async function handleVerifyPersonOtp(
  request: Request,
  dependencies: PersonAuthHttpDependencies,
): Promise<Response> {
  const parsed = await parsePersonOriginPostRequest(
    request,
    otpPath,
    dependencies.expectedOrigin,
    400,
  );
  if (!parsed.valid) return requestError(parsed.reason);
  const input = parseOtpBody(parsed.body);
  const challenge = readPersonPkceChallenge(request);
  if (input === null || challenge === null)
    return error("AUTHENTICATION_FAILED", 400);

  const result = await dependencies.lifecycle.verifyEmailOtp(
    input.email,
    input.token,
  );
  const headers = noStoreHeaders();
  appendClearPersonPkceCookies(headers);
  if (result.outcome === "AUTHENTICATED") {
    appendPersonSessionCookies(headers, result.tokens);
    return new Response(null, { status: 204, headers });
  }
  return error(
    result.outcome === "REJECTED"
      ? "AUTHENTICATION_FAILED"
      : "SERVICE_UNAVAILABLE",
    result.outcome === "REJECTED" ? 401 : 503,
    headers,
  );
}

export async function handleRefreshPersonSession(
  request: Request,
  dependencies: PersonAuthHttpDependencies,
): Promise<Response> {
  const parsed = await parsePersonOriginPostRequest(
    request,
    refreshPath,
    dependencies.expectedOrigin,
    16,
  );
  if (!parsed.valid) return requestError(parsed.reason);
  if (!isEmptyObject(parsed.body)) return error("INVALID_REQUEST", 400);

  const refreshToken = readPersonRefreshToken(request);
  if (refreshToken === null) {
    const headers = noStoreHeaders();
    appendClearPersonSessionCookies(headers);
    return error("AUTHENTICATION_REQUIRED", 401, headers);
  }
  const result = await dependencies.lifecycle.refresh(refreshToken);
  const headers = noStoreHeaders();
  if (result.outcome === "AUTHENTICATED") {
    appendPersonSessionCookies(headers, result.tokens);
    return new Response(null, { status: 204, headers });
  }
  if (result.outcome === "REJECTED") {
    appendClearPersonSessionCookies(headers);
  }
  return error(
    result.outcome === "REJECTED"
      ? "AUTHENTICATION_REQUIRED"
      : "SERVICE_UNAVAILABLE",
    result.outcome === "REJECTED" ? 401 : 503,
    headers,
  );
}

export async function handleLogoutPersonSession(
  request: Request,
  dependencies: PersonAuthHttpDependencies,
): Promise<Response> {
  const parsed = await parsePersonOriginPostRequest(
    request,
    logoutPath,
    dependencies.expectedOrigin,
    16,
  );
  if (!parsed.valid) return requestError(parsed.reason);
  if (!isEmptyObject(parsed.body)) return error("INVALID_REQUEST", 400);

  const outcome = await dependencies.lifecycle.signOut(
    readPersonAccessToken(request),
  );
  const headers = noStoreHeaders();
  appendClearPersonSessionCookies(headers);
  appendClearPersonPkceCookies(headers);
  return outcome === "SIGNED_OUT"
    ? new Response(null, { status: 204, headers })
    : error("SERVICE_UNAVAILABLE", 503, headers);
}

function parseEmailBody(body: Uint8Array): string | null {
  const value = parseJson(body);
  if (
    !isExactObject(value, ["email"]) ||
    typeof value.email !== "string" ||
    value.email.length > 254 ||
    !emailPattern.test(value.email)
  ) {
    return null;
  }
  return value.email;
}

function parseOtpBody(
  body: Uint8Array,
): { readonly email: string; readonly token: string } | null {
  const value = parseJson(body);
  if (
    !isExactObject(value, ["email", "token"]) ||
    typeof value.email !== "string" ||
    typeof value.token !== "string" ||
    value.email.length > 254 ||
    !emailPattern.test(value.email) ||
    !otpPattern.test(value.token)
  ) {
    return null;
  }
  return { email: value.email, token: value.token };
}

function isEmptyObject(body: Uint8Array): boolean {
  return isExactObject(parseJson(body), []);
}

function isExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === [...keys].sort().join("\n")
  );
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
}

function singleQueryValue(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 ? (values[0] ?? null) : null;
}

function requestError(reason: string): Response {
  return error(
    reason,
    reason === "ORIGIN_NOT_ALLOWED"
      ? 403
      : reason === "PAYLOAD_TOO_LARGE"
        ? 413
        : 400,
  );
}

function error(
  code: string,
  status: number,
  headers = noStoreHeaders(),
): Response {
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ error: code }), { status, headers });
}

function noStoreHeaders(): Headers {
  return new Headers({
    "cache-control": "private, no-store",
    expires: "0",
    pragma: "no-cache",
    "referrer-policy": "no-referrer",
  });
}
