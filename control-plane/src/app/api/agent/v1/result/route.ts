import {
  getAgentTransportDependencies,
  isAgentDeliveryEnabled,
} from "@/composition/agent-transport";
import {
  deliveryDisabledResponse,
  handleAgentResult,
} from "@/modules/devices/transport/agent-http-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isAgentDeliveryEnabled()) return deliveryDisabledResponse();
  try {
    return await handleAgentResult(request, getAgentTransportDependencies());
  } catch {
    return Response.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
