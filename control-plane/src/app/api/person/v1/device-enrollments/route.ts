import {
  getPersonDeviceDependencies,
  isDeviceEnrollmentEnabled,
} from "@/composition/device-enrollment";
import { handleCreateDeviceEnrollment } from "@/modules/devices/transport/person-device-http-handlers";

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
    return await handleCreateDeviceEnrollment(
      request,
      getPersonDeviceDependencies(),
    );
  } catch {
    return Response.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
