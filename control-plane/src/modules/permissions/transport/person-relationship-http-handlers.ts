import type { PersonSessionAuthentication } from "@/modules/identity/application/authenticate-person-session";
import { parsePersonPostRequest } from "@/modules/identity/transport/person-http-auth";
import type {
  AcceptRelationshipInvitationResult,
  CreateRelationshipInvitationResult,
} from "../application/manage-relationships";

const invitationPath = "/api/person/v1/relationship-invitations";
const relationshipPath = "/api/person/v1/relationships";
const invitationCodePattern = /^[A-Za-z0-9_-]{43}$/;

export interface PersonRelationshipHttpDependencies {
  readonly expectedOrigin: string;
  readonly authenticate: (
    accessToken: string | null,
  ) => Promise<PersonSessionAuthentication>;
  readonly createInvitation: (
    inviterId: string,
    now: Date,
  ) => Promise<CreateRelationshipInvitationResult>;
  readonly acceptInvitation: (
    accepterId: string,
    invitationCode: string,
    now: Date,
  ) => Promise<AcceptRelationshipInvitationResult>;
  readonly now: () => Date;
}

export async function handleCreateRelationshipInvitation(
  request: Request,
  dependencies: PersonRelationshipHttpDependencies,
): Promise<Response> {
  const parsed = await parsePersonPostRequest(
    request,
    invitationPath,
    dependencies.expectedOrigin,
    16,
  );
  if (!parsed.valid) {
    return personError(parsed.reason, requestErrorStatus(parsed.reason));
  }
  if (!isEmptyObject(parsed.body)) return personError("INVALID_REQUEST", 400);
  const authentication = await dependencies.authenticate(parsed.accessToken);
  if (!authentication.authenticated) {
    return authenticationError(authentication.reason);
  }
  const result = await dependencies.createInvitation(
    authentication.context.personId,
    dependencies.now(),
  );
  if (result.outcome === "REJECTED") {
    return personError(result.reason, 403);
  }
  return noStoreJson(
    {
      invitation_code: result.invitationCode,
      expires_at: result.expiresAt.toISOString(),
    },
    201,
  );
}

export async function handleAcceptRelationshipInvitation(
  request: Request,
  dependencies: PersonRelationshipHttpDependencies,
): Promise<Response> {
  const parsed = await parsePersonPostRequest(
    request,
    relationshipPath,
    dependencies.expectedOrigin,
    128,
  );
  if (!parsed.valid) {
    return personError(parsed.reason, requestErrorStatus(parsed.reason));
  }
  const invitationCode = parseAcceptanceBody(parsed.body);
  if (invitationCode === null) return personError("INVALID_REQUEST", 400);
  const authentication = await dependencies.authenticate(parsed.accessToken);
  if (!authentication.authenticated) {
    return authenticationError(authentication.reason);
  }
  const result = await dependencies.acceptInvitation(
    authentication.context.personId,
    invitationCode,
    dependencies.now(),
  );
  if (result.outcome === "REJECTED") {
    return personError(result.reason, 404);
  }
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

function parseAcceptanceBody(body: Uint8Array): string | null {
  const value = parseJson(body);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("invitation_code" in value) ||
    typeof value.invitation_code !== "string" ||
    !invitationCodePattern.test(value.invitation_code)
  ) {
    return null;
  }
  return value.invitation_code;
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
}

function authenticationError(
  reason: "AUTHENTICATION_REQUIRED" | "ACCOUNT_UNAVAILABLE",
): Response {
  return personError(reason, reason === "AUTHENTICATION_REQUIRED" ? 401 : 403);
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
