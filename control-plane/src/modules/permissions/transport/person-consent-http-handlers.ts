import type { PersonSessionAuthentication } from "@/modules/identity/application/authenticate-person-session";
import { parsePersonPostRequest } from "@/modules/identity/transport/person-http-auth";
import { readPersonAccessToken } from "@/modules/identity/transport/person-session-cookie";
import type {
  RecipientConsentSnapshot,
  SetRecipientGrantResult,
} from "../application/manage-recipient-consent";

const consentPath = "/api/person/v1/consent";
const grantPath = "/api/person/v1/consent-grants";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PersonConsentHttpDependencies {
  readonly expectedOrigin: string;
  readonly authenticate: (
    accessToken: string | null,
  ) => Promise<PersonSessionAuthentication>;
  readonly readConsent: (
    recipientId: string,
  ) => Promise<RecipientConsentSnapshot>;
  readonly setPaused: (
    recipientId: string,
    paused: boolean,
    now: Date,
  ) => Promise<void>;
  readonly setGrant: (
    recipientId: string,
    actorId: string,
    granted: boolean,
    now: Date,
  ) => Promise<SetRecipientGrantResult>;
  readonly now: () => Date;
}

export async function handleReadConsent(
  request: Request,
  dependencies: PersonConsentHttpDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.pathname !== consentPath ||
    url.search !== ""
  ) {
    return personError("INVALID_REQUEST", 400);
  }
  const authentication = await authenticate(
    readPersonAccessToken(request),
    dependencies,
  );
  if (authentication instanceof Response) return authentication;
  const consent = await dependencies.readConsent(authentication.personId);
  return noStoreJson(
    {
      paused: consent.paused,
      connected_people: consent.connectedPeople.map((person) => ({
        person_id: person.personId,
        display_name: person.displayName,
        grant_active: person.grantActive,
        account_available: person.accountAvailable,
      })),
    },
    200,
  );
}

export async function handleSetPaused(
  request: Request,
  dependencies: PersonConsentHttpDependencies,
): Promise<Response> {
  const parsed = await parsePersonPostRequest(
    request,
    consentPath,
    dependencies.expectedOrigin,
    32,
  );
  if (!parsed.valid)
    return personError(parsed.reason, requestErrorStatus(parsed.reason));
  const paused = parsePauseBody(parsed.body);
  if (paused === null) return personError("INVALID_REQUEST", 400);
  const authentication = await authenticate(parsed.accessToken, dependencies);
  if (authentication instanceof Response) return authentication;
  await dependencies.setPaused(
    authentication.personId,
    paused,
    dependencies.now(),
  );
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleSetGrant(
  request: Request,
  dependencies: PersonConsentHttpDependencies,
): Promise<Response> {
  const parsed = await parsePersonPostRequest(
    request,
    grantPath,
    dependencies.expectedOrigin,
    128,
  );
  if (!parsed.valid)
    return personError(parsed.reason, requestErrorStatus(parsed.reason));
  const input = parseGrantBody(parsed.body);
  if (input === null) return personError("INVALID_REQUEST", 400);
  const authentication = await authenticate(parsed.accessToken, dependencies);
  if (authentication instanceof Response) return authentication;
  if (authentication.personId === input.personId) {
    return personError("INVALID_REQUEST", 400);
  }
  const result = await dependencies.setGrant(
    authentication.personId,
    input.personId,
    input.granted,
    dependencies.now(),
  );
  if (result === "CONNECTION_REQUIRED") {
    return personError(result, 409);
  }
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

async function authenticate(
  accessToken: string | null,
  dependencies: PersonConsentHttpDependencies,
): Promise<{ readonly personId: string } | Response> {
  const authentication = await dependencies.authenticate(accessToken);
  if (!authentication.authenticated) {
    return personError(
      authentication.reason,
      authentication.reason === "AUTHENTICATION_REQUIRED" ? 401 : 403,
    );
  }
  return { personId: authentication.context.personId };
}

function parsePauseBody(body: Uint8Array): boolean | null {
  const value = parseJson(body);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("paused" in value) ||
    typeof value.paused !== "boolean"
  ) {
    return null;
  }
  return value.paused;
}

function parseGrantBody(
  body: Uint8Array,
): { readonly personId: string; readonly granted: boolean } | null {
  const value = parseJson(body);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("person_id" in value) ||
    typeof value.person_id !== "string" ||
    !uuidPattern.test(value.person_id) ||
    !("granted" in value) ||
    typeof value.granted !== "boolean"
  ) {
    return null;
  }
  return { personId: value.person_id, granted: value.granted };
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
