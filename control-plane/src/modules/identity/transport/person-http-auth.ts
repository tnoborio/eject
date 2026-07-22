import { readPersonAccessToken } from "./person-session-cookie";

export type ParsedPersonPostRequest =
  | {
      readonly valid: true;
      readonly accessToken: string;
      readonly body: Uint8Array;
    }
  | {
      readonly valid: false;
      readonly reason:
        | "INVALID_REQUEST"
        | "ORIGIN_NOT_ALLOWED"
        | "AUTHENTICATION_REQUIRED"
        | "PAYLOAD_TOO_LARGE";
    };

export async function parsePersonPostRequest(
  request: Request,
  expectedPath: string,
  expectedOrigin: string,
  maximumBodyBytes: number,
): Promise<ParsedPersonPostRequest> {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    url.pathname !== expectedPath ||
    url.search !== "" ||
    !request.headers.get("content-type")?.startsWith("application/json")
  ) {
    return invalid("INVALID_REQUEST");
  }
  if (request.headers.get("origin") !== expectedOrigin) {
    return invalid("ORIGIN_NOT_ALLOWED");
  }
  const accessToken = readPersonAccessToken(request);
  if (accessToken === null) return invalid("AUTHENTICATION_REQUIRED");

  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBodyBytes)
  ) {
    return invalid("PAYLOAD_TOO_LARGE");
  }
  const body = await readBoundedBody(request, maximumBodyBytes);
  return body === null
    ? invalid("PAYLOAD_TOO_LARGE")
    : { valid: true, accessToken, body };
}

export function parseExpectedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("EJECT_PUBLIC_ORIGIN is not a URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.origin !== value
  ) {
    throw new Error("EJECT_PUBLIC_ORIGIN must be an exact HTTPS origin");
  }
  return url.origin;
}

async function readBoundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function invalid(
  reason: Exclude<ParsedPersonPostRequest, { readonly valid: true }>["reason"],
): ParsedPersonPostRequest {
  return { valid: false, reason };
}
