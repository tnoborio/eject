import { getPersonConsentDependencies } from "@/composition/person-consent";
import { isPersonAuthEnabled } from "@/composition/person-auth";
import {
  handleReadConsent,
  handleSetPaused,
} from "@/modules/permissions/transport/person-consent-http-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!isPersonAuthEnabled()) return disabled();
  try {
    return await handleReadConsent(request, getPersonConsentDependencies());
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isPersonAuthEnabled()) return disabled();
  try {
    return await handleSetPaused(request, getPersonConsentDependencies());
  } catch {
    return unavailable();
  }
}

function disabled(): Response {
  return Response.json(
    { error: "PERSON_AUTH_DISABLED" },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

function unavailable(): Response {
  return Response.json(
    { error: "SERVICE_UNAVAILABLE" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
