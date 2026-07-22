import { createPersonSessionLifecycle } from "@/modules/identity/application/manage-person-session";
import { NodePersonPkceGenerator } from "@/modules/identity/infrastructure/node-person-pkce";
import { SupabasePersonAuthProvider } from "@/modules/identity/infrastructure/supabase-person-auth-provider";
import { SupabasePersonTokenVerifier } from "@/modules/identity/infrastructure/supabase-person-token-verifier";
import { parseExpectedOrigin } from "@/modules/identity/transport/person-http-auth";
import type { PersonAuthHttpDependencies } from "@/modules/identity/transport/person-auth-http-handlers";

const shared = globalThis as typeof globalThis & {
  ejectPersonAuth?: PersonAuthHttpDependencies;
};

export function isPersonAuthEnabled(): boolean {
  return process.env.EJECT_PERSON_AUTH_ENABLED === "true";
}

export function getPersonAuthDependencies(): PersonAuthHttpDependencies {
  if (shared.ejectPersonAuth !== undefined) return shared.ejectPersonAuth;
  const issuer = requiredEnvironment("EJECT_SUPABASE_AUTH_ISSUER");
  const audience = requiredEnvironment("EJECT_SUPABASE_AUTH_AUDIENCE");
  shared.ejectPersonAuth = {
    expectedOrigin: parseExpectedOrigin(
      requiredEnvironment("EJECT_PUBLIC_ORIGIN"),
    ),
    lifecycle: createPersonSessionLifecycle({
      provider: new SupabasePersonAuthProvider({
        issuer,
        publishableKey: requiredEnvironment("EJECT_SUPABASE_PUBLISHABLE_KEY"),
      }),
      verifier: new SupabasePersonTokenVerifier({ issuer, audience }),
      pkce: new NodePersonPkceGenerator(),
    }),
  };
  return shared.ejectPersonAuth;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Required person auth environment is missing: ${name}`);
  }
  return value;
}
