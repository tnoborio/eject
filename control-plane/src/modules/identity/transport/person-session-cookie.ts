const accessCookieName = "__Host-eject-access";
const maximumCookieHeaderLength = 16_384;
const maximumAccessTokenLength = 8_192;
const compactJwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function readPersonAccessToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (
    cookieHeader === null ||
    cookieHeader.length === 0 ||
    cookieHeader.length > maximumCookieHeaderLength
  ) {
    return null;
  }

  let accessToken: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== accessCookieName) continue;
    if (accessToken !== null) return null;
    accessToken = part.slice(separator + 1).trim();
  }

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
