import { getPersonDeviceDependencies } from "@/composition/device-enrollment";
import { handleRevokeDevice } from "@/modules/devices/transport/person-device-http-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleRevokeDevice(request, getPersonDeviceDependencies());
  } catch {
    return Response.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
