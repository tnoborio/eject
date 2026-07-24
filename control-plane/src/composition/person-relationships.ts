import { randomUUID } from "node:crypto";
import { getRuntimeDatabase } from "@/composition/runtime-database";
import { createAuthenticatePersonSession } from "@/modules/identity/application/authenticate-person-session";
import { PostgresPersonAccountReader } from "@/modules/identity/infrastructure/postgres-person-account-reader";
import { SupabasePersonTokenVerifier } from "@/modules/identity/infrastructure/supabase-person-token-verifier";
import { parseExpectedOrigin } from "@/modules/identity/transport/person-http-auth";
import {
  createAcceptRelationshipInvitation,
  createRelationshipInvitation,
} from "@/modules/permissions/application/manage-relationships";
import { NodeRelationshipInvitationCrypto } from "@/modules/permissions/infrastructure/node-relationship-invitation-crypto";
import { PostgresRelationshipStore } from "@/modules/permissions/infrastructure/postgres-relationship-store";
import type { PersonRelationshipHttpDependencies } from "@/modules/permissions/transport/person-relationship-http-handlers";

interface PersonRelationshipGlobal {
  dependencies?: PersonRelationshipHttpDependencies;
}

const shared = globalThis as typeof globalThis & {
  ejectPersonRelationships?: PersonRelationshipGlobal;
};

export function getPersonRelationshipDependencies(): PersonRelationshipHttpDependencies {
  const state = (shared.ejectPersonRelationships ??= {});
  if (state.dependencies !== undefined) return state.dependencies;
  const database = getRuntimeDatabase();
  const store = new PostgresRelationshipStore(database);
  const crypto = new NodeRelationshipInvitationCrypto();
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
    createInvitation: createRelationshipInvitation({
      store,
      crypto,
      newId: randomUUID,
    }),
    acceptInvitation: createAcceptRelationshipInvitation({ store, crypto }),
    now: () => new Date(),
  };
  return state.dependencies;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Required person relationship environment is missing: ${name}`,
    );
  }
  return value;
}
