import { getPersonConsentDependencies } from "@/composition/person-consent";
import { isPersonAuthEnabled } from "@/composition/person-auth";
import { handleSetGrant } from "@/modules/permissions/transport/person-consent-http-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isPersonAuthEnabled()) {
    return Response.json(
      { error: "PERSON_AUTH_DISABLED" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return await handleSetGrant(request, getPersonConsentDependencies());
  } catch {
    return Response.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
