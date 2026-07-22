export interface VerifiedPersonToken {
  readonly personId: string;
}

export interface PersonAccessTokenVerifier {
  verify(accessToken: string): Promise<VerifiedPersonToken | null>;
}

export type PersonAccountStatus = "ACTIVE" | "RESTRICTED";

export interface PersonAccountReader {
  loadAccountStatus(personId: string): Promise<PersonAccountStatus | null>;
}

export type PersonSessionAuthentication =
  | {
      readonly authenticated: true;
      readonly context: { readonly personId: string };
    }
  | {
      readonly authenticated: false;
      readonly reason: "AUTHENTICATION_REQUIRED" | "ACCOUNT_UNAVAILABLE";
    };

export function createAuthenticatePersonSession(dependencies: {
  readonly tokens: PersonAccessTokenVerifier;
  readonly accounts: PersonAccountReader;
}) {
  return async function authenticatePersonSession(
    accessToken: string | null,
  ): Promise<PersonSessionAuthentication> {
    if (accessToken === null) {
      return rejected("AUTHENTICATION_REQUIRED");
    }

    const verified = await dependencies.tokens.verify(accessToken);
    if (verified === null) {
      return rejected("AUTHENTICATION_REQUIRED");
    }

    const status = await dependencies.accounts.loadAccountStatus(
      verified.personId,
    );
    if (status !== "ACTIVE") {
      return rejected("ACCOUNT_UNAVAILABLE");
    }

    return {
      authenticated: true,
      context: { personId: verified.personId },
    };
  };
}

function rejected(
  reason: Exclude<
    PersonSessionAuthentication,
    { readonly authenticated: true }
  >["reason"],
): PersonSessionAuthentication {
  return { authenticated: false, reason };
}
