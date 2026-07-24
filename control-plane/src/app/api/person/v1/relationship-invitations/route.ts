import { getPersonRelationshipDependencies } from "@/composition/person-relationships";
import { isPersonAuthEnabled } from "@/composition/person-auth";
import { handleCreateRelationshipInvitation } from "@/modules/permissions/transport/person-relationship-http-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isPersonAuthEnabled()) return disabled();
  try {
    return await handleCreateRelationshipInvitation(
      request,
      getPersonRelationshipDependencies(),
    );
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
