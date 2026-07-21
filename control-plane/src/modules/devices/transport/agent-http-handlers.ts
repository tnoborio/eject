import type {
  AgentAuthenticationResult,
  ParsedAgentRequest,
} from "../application/authenticate-agent-request";
import type { PollStoreResult } from "@/modules/eject/application/agent-polling";
import type {
  AgentResultObservation,
  IngestResultOutcome,
} from "@/modules/eject/application/ingest-agent-result";
import { toProtocolV1Command } from "@/modules/eject/transport/protocol-v1-command";
import { parseProtocolV1AgentResult } from "@/modules/eject/transport/protocol-v1-agent-result";
import { parseAgentHttpRequest } from "./agent-http-auth";

const pollPath = "/api/agent/v1/poll";
const resultPath = "/api/agent/v1/result";

export interface AgentHttpDependencies {
  readonly authenticate: (
    request: ParsedAgentRequest,
    now: Date,
  ) => Promise<AgentAuthenticationResult>;
  readonly poll: (
    device: Extract<
      AgentAuthenticationResult,
      { authenticated: true }
    >["context"],
    now: Date,
  ) => Promise<PollStoreResult>;
  readonly ingest: (
    device: Extract<
      AgentAuthenticationResult,
      { authenticated: true }
    >["context"],
    result: AgentResultObservation,
    now: Date,
  ) => Promise<IngestResultOutcome>;
  readonly signer: ServerResponseSigner;
  readonly now: () => Date;
}

export interface ServerResponseSigner {
  signResponse(input: {
    readonly requestNonce: string;
    readonly status: number;
    readonly body: Uint8Array;
  }): { readonly keyId: string; readonly signature: string };
}

export async function handleAgentPoll(
  request: Request,
  dependencies: AgentHttpDependencies,
): Promise<Response> {
  const parsed = await parseAgentHttpRequest(request, pollPath, 128);
  if (!parsed.valid) return unsignedError(parsed.reason, 400);
  if (!isPollBody(parsed.request.body))
    return unsignedError("INVALID_REQUEST", 400);

  const now = dependencies.now();
  const authentication = await dependencies.authenticate(parsed.request, now);
  if (!authentication.authenticated) {
    return authentication.signatureVerified
      ? signedJson(dependencies.signer, parsed.request.nonce, 401, {
          server_time: now.toISOString(),
          error: authentication.reason,
        })
      : unsignedError(authentication.reason, 401);
  }

  const result = await dependencies.poll(authentication.context, now);
  if (result.outcome === "REJECTED") {
    return signedJson(dependencies.signer, parsed.request.nonce, 409, {
      server_time: now.toISOString(),
      error: result.reason,
    });
  }
  return signedJson(dependencies.signer, parsed.request.nonce, 200, {
    server_time: now.toISOString(),
    command:
      result.outcome === "COMMAND" ? toProtocolV1Command(result.command) : null,
  });
}

export async function handleAgentResult(
  request: Request,
  dependencies: AgentHttpDependencies,
): Promise<Response> {
  const parsed = await parseAgentHttpRequest(request, resultPath, 2_048);
  if (!parsed.valid) return unsignedError(parsed.reason, 400);

  const now = dependencies.now();
  const authentication = await dependencies.authenticate(parsed.request, now);
  if (!authentication.authenticated) {
    return authentication.signatureVerified
      ? signedJson(dependencies.signer, parsed.request.nonce, 401, {
          server_time: now.toISOString(),
          error: authentication.reason,
        })
      : unsignedError(authentication.reason, 401);
  }

  const result = parseProtocolV1AgentResult(parsed.request.body);
  if (result === null) {
    return signedJson(dependencies.signer, parsed.request.nonce, 400, {
      server_time: now.toISOString(),
      error: "INVALID_PROTOCOL_MESSAGE",
    });
  }
  const outcome = await dependencies.ingest(
    authentication.context,
    result,
    now,
  );
  if (outcome.outcome === "REJECTED") {
    return signedJson(dependencies.signer, parsed.request.nonce, 409, {
      server_time: now.toISOString(),
      error: outcome.reason,
    });
  }
  return signedJson(dependencies.signer, parsed.request.nonce, 200, {
    server_time: now.toISOString(),
    outcome: outcome.outcome,
  });
}

export function deliveryDisabledResponse(): Response {
  return unsignedError("DELIVERY_DISABLED", 404);
}

function isPollBody(body: Uint8Array): boolean {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
    return (
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).length === 1 &&
      "protocol_version" in value &&
      value.protocol_version === 1
    );
  } catch {
    return false;
  }
}

function signedJson(
  signer: ServerResponseSigner,
  requestNonce: string,
  status: number,
  value: Readonly<Record<string, unknown>>,
): Response {
  const body = new TextEncoder().encode(JSON.stringify(value));
  const integrity = signer.signResponse({ requestNonce, status, body });
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "eject-server-key-id": integrity.keyId,
      "eject-response-signature": integrity.signature,
    },
  });
}

function unsignedError(code: string, status: number): Response {
  return Response.json(
    { error: code },
    { status, headers: { "cache-control": "no-store" } },
  );
}
