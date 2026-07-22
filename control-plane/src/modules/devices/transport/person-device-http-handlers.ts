import type { PersonSessionAuthentication } from "@/modules/identity/application/authenticate-person-session";
import { parsePersonPostRequest } from "@/modules/identity/transport/person-http-auth";
import type { CreateDeviceEnrollmentResult } from "../application/device-enrollment";

const createPath = "/api/person/v1/device-enrollments";
const revokePath = "/api/person/v1/device-revocations";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PersonDeviceHttpDependencies {
  readonly expectedOrigin: string;
  readonly authenticate: (
    accessToken: string | null,
  ) => Promise<PersonSessionAuthentication>;
  readonly createEnrollment: (
    ownerId: string,
    now: Date,
  ) => Promise<CreateDeviceEnrollmentResult>;
  readonly revokeDevice: (
    ownerId: string,
    deviceId: string,
    now: Date,
  ) => Promise<void>;
  readonly now: () => Date;
}

export async function handleCreateDeviceEnrollment(
  request: Request,
  dependencies: PersonDeviceHttpDependencies,
): Promise<Response> {
  const parsed = await parsePersonPostRequest(
    request,
    createPath,
    dependencies.expectedOrigin,
    16,
  );
  if (!parsed.valid)
    return personError(parsed.reason, requestErrorStatus(parsed.reason));
  if (!isEmptyObject(parsed.body)) return personError("INVALID_REQUEST", 400);

  const authentication = await dependencies.authenticate(parsed.accessToken);
  if (!authentication.authenticated) {
    return personError(
      authentication.reason,
      authentication.reason === "AUTHENTICATION_REQUIRED" ? 401 : 403,
    );
  }
  const result = await dependencies.createEnrollment(
    authentication.context.personId,
    dependencies.now(),
  );
  if (result.outcome === "REJECTED") {
    return personError(
      result.reason,
      result.reason === "ACCOUNT_UNAVAILABLE" ? 403 : 409,
    );
  }
  return noStoreJson(
    {
      enrollment_secret: result.enrollmentSecret,
      expires_at: result.expiresAt.toISOString(),
    },
    201,
  );
}

export async function handleRevokeDevice(
  request: Request,
  dependencies: PersonDeviceHttpDependencies,
): Promise<Response> {
  const parsed = await parsePersonPostRequest(
    request,
    revokePath,
    dependencies.expectedOrigin,
    128,
  );
  if (!parsed.valid)
    return personError(parsed.reason, requestErrorStatus(parsed.reason));
  const deviceId = parseRevocationBody(parsed.body);
  if (deviceId === null) return personError("INVALID_REQUEST", 400);

  const authentication = await dependencies.authenticate(parsed.accessToken);
  if (!authentication.authenticated) {
    return personError(
      authentication.reason,
      authentication.reason === "AUTHENTICATION_REQUIRED" ? 401 : 403,
    );
  }
  await dependencies.revokeDevice(
    authentication.context.personId,
    deviceId,
    dependencies.now(),
  );
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

function isEmptyObject(body: Uint8Array): boolean {
  const value = parseJson(body);
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function parseRevocationBody(body: Uint8Array): string | null {
  const value = parseJson(body);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("device_id" in value) ||
    typeof value.device_id !== "string" ||
    !uuidPattern.test(value.device_id)
  ) {
    return null;
  }
  return value.device_id;
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
}

function requestErrorStatus(reason: string): number {
  if (reason === "AUTHENTICATION_REQUIRED") return 401;
  if (reason === "ORIGIN_NOT_ALLOWED") return 403;
  return 400;
}

function personError(code: string, status: number): Response {
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
