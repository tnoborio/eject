import { randomUUID } from "node:crypto";
import { getRuntimeDatabase } from "@/composition/runtime-database";
import { createAuthenticateAgentRequest } from "@/modules/devices/application/authenticate-agent-request";
import {
  NodeAgentRequestCrypto,
  NodeServerResponseSigner,
} from "@/modules/devices/infrastructure/node-agent-crypto";
import type { AgentHttpDependencies } from "@/modules/devices/transport/agent-http-handlers";
import { createPollAgent } from "@/modules/eject/application/agent-polling";
import { createIngestAgentResult } from "@/modules/eject/application/ingest-agent-result";
import { PostgresAgentTransportStore } from "@/modules/eject/infrastructure/postgres-agent-transport-store";

interface AgentTransportGlobal {
  dependencies?: AgentHttpDependencies;
}

const shared = globalThis as typeof globalThis & {
  ejectAgentTransport?: AgentTransportGlobal;
};

export function isAgentDeliveryEnabled(): boolean {
  return process.env.EJECT_AGENT_DELIVERY_ENABLED === "true";
}

export function getAgentTransportDependencies(): AgentHttpDependencies {
  const state = (shared.ejectAgentTransport ??= {});
  if (state.dependencies !== undefined) return state.dependencies;

  const keyId = requiredUuidEnvironment("EJECT_SERVER_SIGNING_KEY_ID");
  const privateKey = decodeBase64Environment(
    "EJECT_SERVER_SIGNING_KEY_PKCS8_B64",
  );
  const database = getRuntimeDatabase();
  const store = new PostgresAgentTransportStore(database);
  const authenticate = createAuthenticateAgentRequest({
    keys: store,
    crypto: new NodeAgentRequestCrypto(),
  });
  state.dependencies = {
    authenticate,
    poll: createPollAgent({ store, newId: randomUUID }),
    ingest: createIngestAgentResult({ store, newId: randomUUID }),
    signer: new NodeServerResponseSigner(keyId, privateKey),
    now: () => new Date(),
  };
  return state.dependencies;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Required agent transport environment is missing: ${name}`);
  }
  return value;
}

function decodeBase64Environment(name: string): Uint8Array {
  const text = requiredEnvironment(name);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw new Error(`Agent transport environment is not base64: ${name}`);
  }
  return Buffer.from(text, "base64");
}

function requiredUuidEnvironment(name: string): string {
  const value = requiredEnvironment(name);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throw new Error(`Agent transport environment is not a UUID: ${name}`);
  }
  return value;
}
