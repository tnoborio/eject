import {
  getPersonDeviceDependencies,
  isDeviceEnrollmentEnabled,
} from "@/composition/device-enrollment";
import { isPersonAuthEnabled } from "@/composition/person-auth";
import {
  handleCreateDeviceEnrollment,
  handleListDevices,
} from "@/modules/devices/transport/person-device-http-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!isPersonAuthEnabled()) {
    return Response.json(
      { error: "PERSON_AUTH_DISABLED" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return await handleListDevices(request, getPersonDeviceDependencies());
  } catch {
    return Response.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

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
