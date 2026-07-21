import type { ParsedAgentRequest } from "../application/authenticate-agent-request";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const noncePattern = /^[A-Za-z0-9_-]{22}$/;
const hashPattern = /^[A-Za-z0-9_-]{43}$/;
const signaturePattern = /^[A-Za-z0-9_-]{86}$/;

export type ParsedHttpRequest =
  | { readonly valid: true; readonly request: ParsedAgentRequest }
  | {
      readonly valid: false;
      readonly reason: "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE";
    };

export async function parseAgentHttpRequest(
  request: Request,
  expectedPath: string,
  maximumBodyBytes: number,
): Promise<ParsedHttpRequest> {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    url.pathname !== expectedPath ||
    url.search !== "" ||
    !request.headers.get("content-type")?.startsWith("application/json")
  ) {
    return invalid("INVALID_REQUEST");
  }

  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBodyBytes)
  ) {
    return invalid("PAYLOAD_TOO_LARGE");
  }

  const body = await readBoundedBody(request, maximumBodyBytes);
  if (body === null) return invalid("PAYLOAD_TOO_LARGE");

  const deviceId = request.headers.get("eject-device-id") ?? "";
  const keyId = request.headers.get("eject-key-id") ?? "";
  const timestampText = request.headers.get("eject-timestamp") ?? "";
  const nonce = request.headers.get("eject-nonce") ?? "";
  const contentHashText = request.headers.get("eject-content-sha256") ?? "";
  const signatureText = request.headers.get("eject-signature") ?? "";
  const timestampMs = Number(timestampText);

  if (
    !uuidPattern.test(deviceId) ||
    !uuidPattern.test(keyId) ||
    !/^\d{13}$/.test(timestampText) ||
    !Number.isSafeInteger(timestampMs) ||
    !noncePattern.test(nonce) ||
    !hashPattern.test(contentHashText) ||
    !signaturePattern.test(signatureText)
  ) {
    return invalid("INVALID_REQUEST");
  }

  const declaredContentHash = Buffer.from(contentHashText, "base64url");
  const signature = Buffer.from(signatureText, "base64url");
  if (declaredContentHash.byteLength !== 32 || signature.byteLength !== 64) {
    return invalid("INVALID_REQUEST");
  }

  return {
    valid: true,
    request: {
      deviceId,
      keyId,
      timestampMs,
      nonce,
      declaredContentHashText: contentHashText,
      declaredContentHash,
      signature,
      method: "POST",
      path: expectedPath,
      body,
    },
  };
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

function invalid(reason: "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE") {
  return { valid: false as const, reason };
}
