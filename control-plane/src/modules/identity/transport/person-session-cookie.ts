import type {
  PersonPkceChallenge,
  PersonSessionTokens,
} from "../application/manage-person-session";

const accessCookieName = "__Host-eject-access";
const refreshCookieName = "__Host-eject-refresh";
const verifierCookieName = "__Host-eject-pkce-verifier";
const stateCookieName = "__Host-eject-pkce-state";
const maximumCookieHeaderLength = 16_384;
const maximumAccessTokenLength = 8_192;
const compactJwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const refreshTokenPattern = /^[A-Za-z0-9._~-]{20,4096}$/;
const challengeValuePattern = /^[A-Za-z0-9_-]{43}$/;

export function readPersonAccessToken(request: Request): string | null {
  const accessToken = readCookie(request, accessCookieName);

  if (
    accessToken === null ||
    accessToken.length === 0 ||
    accessToken.length > maximumAccessTokenLength ||
    !compactJwtPattern.test(accessToken)
  ) {
    return null;
  }
  return accessToken;
}

export function readPersonRefreshToken(request: Request): string | null {
  const value = readCookie(request, refreshCookieName);
  return value !== null && refreshTokenPattern.test(value) ? value : null;
}

export function readPersonPkceChallenge(
  request: Request,
): Pick<PersonPkceChallenge, "verifier" | "state"> | null {
  const verifier = readCookie(request, verifierCookieName);
  const state = readCookie(request, stateCookieName);
  return verifier !== null &&
    state !== null &&
    challengeValuePattern.test(verifier) &&
    challengeValuePattern.test(state)
    ? { verifier, state }
    : null;
}

export function appendPersonPkceCookies(
  headers: Headers,
  challenge: PersonPkceChallenge,
): void {
  headers.append(
    "set-cookie",
    serialize(verifierCookieName, challenge.verifier, "Lax", 600),
  );
  headers.append(
    "set-cookie",
    serialize(stateCookieName, challenge.state, "Lax", 600),
  );
}

export function appendPersonSessionCookies(
  headers: Headers,
  tokens: PersonSessionTokens,
): void {
  headers.append(
    "set-cookie",
    serialize(accessCookieName, tokens.accessToken, "Strict"),
  );
  headers.append(
    "set-cookie",
    serialize(refreshCookieName, tokens.refreshToken, "Strict"),
  );
}

export function appendClearPersonPkceCookies(headers: Headers): void {
  appendClearCookie(headers, verifierCookieName, "Lax");
  appendClearCookie(headers, stateCookieName, "Lax");
}

export function appendClearPersonSessionCookies(headers: Headers): void {
  appendClearCookie(headers, accessCookieName, "Strict");
  appendClearCookie(headers, refreshCookieName, "Strict");
}

function readCookie(request: Request, expectedName: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (
    cookieHeader === null ||
    cookieHeader.length === 0 ||
    cookieHeader.length > maximumCookieHeaderLength
  ) {
    return null;
  }
  let value: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== expectedName)
      continue;
    if (value !== null) return null;
    value = part.slice(separator + 1).trim();
  }
  return value;
}

function serialize(
  name: string,
  value: string,
  sameSite: "Lax" | "Strict",
  maximumAge?: number,
): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${sameSite}${
    maximumAge === undefined ? "" : `; Max-Age=${maximumAge}`
  }`;
}

function appendClearCookie(
  headers: Headers,
  name: string,
  sameSite: "Lax" | "Strict",
): void {
  headers.append(
    "set-cookie",
    `${serialize(name, "", sameSite, 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
}
