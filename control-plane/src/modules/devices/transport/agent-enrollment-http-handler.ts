import type { ConsumeDeviceEnrollmentResult } from "../application/device-enrollment";

const enrollmentPath = "/api/agent/v1/enroll";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const keyPattern = /^[A-Za-z0-9_-]{107,160}$/;
const versionPattern = /^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/;

export interface AgentEnrollmentHttpDependencies {
  readonly consumeEnrollment: (input: {
    readonly enrollmentSecret: string;
    readonly deviceId: string;
    readonly keyId: string;
    readonly publicKeySpki: Uint8Array;
    readonly platform: "WINDOWS";
    readonly agentVersion: string;
    readonly now: Date;
  }) => Promise<ConsumeDeviceEnrollmentResult>;
  readonly now: () => Date;
}

export async function handleAgentEnrollment(
  request: Request,
  dependencies: AgentEnrollmentHttpDependencies,
): Promise<Response> {
  const body = await readEnrollmentBody(request);
  if (body === null) return error("INVALID_REQUEST", 400);
  const parsed = parseEnrollmentBody(body);
  if (parsed === null) return error("INVALID_REQUEST", 400);

  const result = await dependencies.consumeEnrollment({
    ...parsed,
    now: dependencies.now(),
  });
  if (result.outcome === "REJECTED") {
    const status =
      result.reason === "ENROLLMENT_FAILED"
        ? 401
        : result.reason === "INVALID_PUBLIC_KEY"
          ? 400
          : 409;
    return error(result.reason, status);
  }
  return noStoreJson(
    {
      device_id: parsed.deviceId,
      key_id: parsed.keyId,
      enrollment_state: "SETUP_IN_PROGRESS",
    },
    201,
  );
}

async function readEnrollmentBody(
  request: Request,
): Promise<Uint8Array | null> {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    url.pathname !== enrollmentPath ||
    url.search !== "" ||
    !request.headers.get("content-type")?.startsWith("application/json")
  ) {
    return null;
  }
  const maximum = 1_024;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    return null;
  }
  const reader = request.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maximum) {
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

function parseEnrollmentBody(body: Uint8Array): {
  readonly enrollmentSecret: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly publicKeySpki: Uint8Array;
  readonly platform: "WINDOWS";
  readonly agentVersion: string;
} | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !==
      "agent_version\ndevice_id\nenrollment_secret\nkey_id\nplatform\npublic_key_spki" ||
    !("enrollment_secret" in value) ||
    !("device_id" in value) ||
    !("key_id" in value) ||
    !("public_key_spki" in value) ||
    !("platform" in value) ||
    !("agent_version" in value) ||
    typeof value.enrollment_secret !== "string" ||
    typeof value.device_id !== "string" ||
    typeof value.key_id !== "string" ||
    typeof value.public_key_spki !== "string" ||
    value.platform !== "WINDOWS" ||
    typeof value.agent_version !== "string" ||
    !secretPattern.test(value.enrollment_secret) ||
    !uuidPattern.test(value.device_id) ||
    !uuidPattern.test(value.key_id) ||
    !keyPattern.test(value.public_key_spki) ||
    !versionPattern.test(value.agent_version)
  ) {
    return null;
  }
  const publicKeySpki = Buffer.from(value.public_key_spki, "base64url");
  if (
    publicKeySpki.byteLength < 80 ||
    publicKeySpki.byteLength > 120 ||
    publicKeySpki.toString("base64url") !== value.public_key_spki
  ) {
    return null;
  }
  return {
    enrollmentSecret: value.enrollment_secret,
    deviceId: value.device_id,
    keyId: value.key_id,
    publicKeySpki,
    platform: "WINDOWS",
    agentVersion: value.agent_version,
  };
}

function error(code: string, status: number): Response {
  return noStoreJson({ error: code }, status);
}

function noStoreJson(
  value: Readonly<Record<string, unknown>>,
  status: number,
): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
