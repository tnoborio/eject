import {
  getAgentEnrollmentDependencies,
  isDeviceEnrollmentEnabled,
} from "@/composition/device-enrollment";
import { handleAgentEnrollment } from "@/modules/devices/transport/agent-enrollment-http-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isDeviceEnrollmentEnabled()) {
    return Response.json(
      { error: "ENROLLMENT_DISABLED" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return await handleAgentEnrollment(
      request,
      getAgentEnrollmentDependencies(),
    );
  } catch {
    return Response.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
