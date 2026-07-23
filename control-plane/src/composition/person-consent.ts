import { randomUUID } from "node:crypto";
import { getRuntimeDatabase } from "@/composition/runtime-database";
import { createAuthenticatePersonSession } from "@/modules/identity/application/authenticate-person-session";
import { PostgresPersonAccountReader } from "@/modules/identity/infrastructure/postgres-person-account-reader";
import { SupabasePersonTokenVerifier } from "@/modules/identity/infrastructure/supabase-person-token-verifier";
import { parseExpectedOrigin } from "@/modules/identity/transport/person-http-auth";
import {
  createReadRecipientConsent,
  createSetRecipientGrant,
  createSetRecipientPaused,
} from "@/modules/permissions/application/manage-recipient-consent";
import { PostgresRecipientConsentStore } from "@/modules/permissions/infrastructure/postgres-recipient-consent-store";
import type { PersonConsentHttpDependencies } from "@/modules/permissions/transport/person-consent-http-handlers";

interface PersonConsentGlobal {
  dependencies?: PersonConsentHttpDependencies;
}

const shared = globalThis as typeof globalThis & {
  ejectPersonConsent?: PersonConsentGlobal;
};

export function getPersonConsentDependencies(): PersonConsentHttpDependencies {
  const state = (shared.ejectPersonConsent ??= {});
  if (state.dependencies !== undefined) return state.dependencies;
  const database = getRuntimeDatabase();
  const store = new PostgresRecipientConsentStore(database, randomUUID);
  state.dependencies = {
    expectedOrigin: parseExpectedOrigin(
      requiredEnvironment("EJECT_PUBLIC_ORIGIN"),
    ),
    authenticate: createAuthenticatePersonSession({
      tokens: new SupabasePersonTokenVerifier({
        issuer: requiredEnvironment("EJECT_SUPABASE_AUTH_ISSUER"),
        audience: requiredEnvironment("EJECT_SUPABASE_AUTH_AUDIENCE"),
      }),
      accounts: new PostgresPersonAccountReader(database),
    }),
    readConsent: createReadRecipientConsent({ store }),
    setPaused: createSetRecipientPaused({ store }),
    setGrant: createSetRecipientGrant({ store }),
    now: () => new Date(),
  };
  return state.dependencies;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Required person consent environment is missing: ${name}`);
  }
  return value;
}
