import { randomUUID } from "node:crypto";
import { getRuntimeDatabase } from "@/composition/runtime-database";
import { createAuthenticatePersonSession } from "@/modules/identity/application/authenticate-person-session";
import { PostgresPersonAccountReader } from "@/modules/identity/infrastructure/postgres-person-account-reader";
import { SupabasePersonTokenVerifier } from "@/modules/identity/infrastructure/supabase-person-token-verifier";
import { parseExpectedOrigin } from "@/modules/identity/transport/person-http-auth";
import {
  createConsumeDeviceEnrollment,
  createDeviceEnrollment,
  createListOwnedDevices,
  createRevokeDevice,
} from "@/modules/devices/application/device-enrollment";
import { NodeDeviceEnrollmentCrypto } from "@/modules/devices/infrastructure/node-device-enrollment-crypto";
import { PostgresDeviceEnrollmentStore } from "@/modules/devices/infrastructure/postgres-device-enrollment-store";
import type { AgentEnrollmentHttpDependencies } from "@/modules/devices/transport/agent-enrollment-http-handler";
import type { PersonDeviceHttpDependencies } from "@/modules/devices/transport/person-device-http-handlers";

interface DeviceEnrollmentGlobal {
  store?: PostgresDeviceEnrollmentStore;
  agent?: AgentEnrollmentHttpDependencies;
  person?: PersonDeviceHttpDependencies;
}

const shared = globalThis as typeof globalThis & {
  ejectDeviceEnrollment?: DeviceEnrollmentGlobal;
};

export function isDeviceEnrollmentEnabled(): boolean {
  return process.env.EJECT_DEVICE_ENROLLMENT_ENABLED === "true";
}

export function getAgentEnrollmentDependencies(): AgentEnrollmentHttpDependencies {
  const state = (shared.ejectDeviceEnrollment ??= {});
  if (state.agent !== undefined) return state.agent;
  const crypto = new NodeDeviceEnrollmentCrypto();
  state.agent = {
    consumeEnrollment: createConsumeDeviceEnrollment({
      store: getStore(state),
      crypto,
    }),
    now: () => new Date(),
  };
  return state.agent;
}

export function getPersonDeviceDependencies(): PersonDeviceHttpDependencies {
  const state = (shared.ejectDeviceEnrollment ??= {});
  if (state.person !== undefined) return state.person;
  const crypto = new NodeDeviceEnrollmentCrypto();
  const store = getStore(state);
  const authenticate = createAuthenticatePersonSession({
    tokens: new SupabasePersonTokenVerifier({
      issuer: requiredEnvironment("EJECT_SUPABASE_AUTH_ISSUER"),
      audience: requiredEnvironment("EJECT_SUPABASE_AUTH_AUDIENCE"),
    }),
    accounts: new PostgresPersonAccountReader(getRuntimeDatabase()),
  });
  state.person = {
    expectedOrigin: parseExpectedOrigin(
      requiredEnvironment("EJECT_PUBLIC_ORIGIN"),
    ),
    authenticate,
    createEnrollment: createDeviceEnrollment({
      store,
      crypto,
      newId: randomUUID,
    }),
    listDevices: createListOwnedDevices({ store }),
    revokeDevice: createRevokeDevice({ store }),
    now: () => new Date(),
  };
  return state.person;
}

function getStore(
  state: DeviceEnrollmentGlobal,
): PostgresDeviceEnrollmentStore {
  return (state.store ??= new PostgresDeviceEnrollmentStore(
    getRuntimeDatabase(),
    randomUUID,
  ));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Required person auth environment is missing: ${name}`);
  }
  return value;
}
