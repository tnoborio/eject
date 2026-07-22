import type { PersonAccessTokenVerifier } from "./authenticate-person-session";

export interface PersonPkceChallenge {
  readonly verifier: string;
  readonly challenge: string;
  readonly state: string;
}

export interface PersonPkceGenerator {
  createChallenge(): PersonPkceChallenge;
}

export interface PersonSessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

export type PersonAuthTokenResult =
  | { readonly outcome: "TOKENS"; readonly tokens: PersonSessionTokens }
  | { readonly outcome: "REJECTED" }
  | { readonly outcome: "UNAVAILABLE" };

export interface PersonAuthProvider {
  requestEmailSignIn(input: {
    readonly email: string;
    readonly redirectTo: string;
    readonly codeChallenge: string;
  }): Promise<"ACCEPTED" | "UNAVAILABLE">;
  exchangeCode(input: {
    readonly code: string;
    readonly codeVerifier: string;
  }): Promise<PersonAuthTokenResult>;
  verifyEmailOtp(input: {
    readonly email: string;
    readonly token: string;
  }): Promise<PersonAuthTokenResult>;
  refresh(refreshToken: string): Promise<PersonAuthTokenResult>;
  signOut(accessToken: string): Promise<"SIGNED_OUT" | "UNAVAILABLE">;
}

export type CompletePersonSessionResult =
  | { readonly outcome: "AUTHENTICATED"; readonly tokens: PersonSessionTokens }
  | { readonly outcome: "REJECTED" }
  | { readonly outcome: "UNAVAILABLE" };

export function createPersonSessionLifecycle(dependencies: {
  readonly provider: PersonAuthProvider;
  readonly verifier: PersonAccessTokenVerifier;
  readonly pkce: PersonPkceGenerator;
}) {
  async function acceptTokens(
    result: PersonAuthTokenResult,
  ): Promise<CompletePersonSessionResult> {
    if (result.outcome !== "TOKENS") return result;
    const verified = await dependencies.verifier.verify(
      result.tokens.accessToken,
    );
    return verified === null
      ? { outcome: "UNAVAILABLE" }
      : { outcome: "AUTHENTICATED", tokens: result.tokens };
  }

  return {
    async begin(
      email: string,
      redirectToForState: (state: string) => string,
    ): Promise<{
      readonly outcome: "ACCEPTED" | "UNAVAILABLE";
      readonly challenge: PersonPkceChallenge;
    }> {
      const challenge = dependencies.pkce.createChallenge();
      const outcome = await dependencies.provider.requestEmailSignIn({
        email,
        redirectTo: redirectToForState(challenge.state),
        codeChallenge: challenge.challenge,
      });
      return { outcome, challenge };
    },

    async exchangeCode(
      code: string,
      codeVerifier: string,
    ): Promise<CompletePersonSessionResult> {
      return acceptTokens(
        await dependencies.provider.exchangeCode({ code, codeVerifier }),
      );
    },

    async verifyEmailOtp(
      email: string,
      token: string,
    ): Promise<CompletePersonSessionResult> {
      return acceptTokens(
        await dependencies.provider.verifyEmailOtp({ email, token }),
      );
    },

    async refresh(refreshToken: string): Promise<CompletePersonSessionResult> {
      return acceptTokens(await dependencies.provider.refresh(refreshToken));
    },

    async signOut(
      accessToken: string | null,
    ): Promise<"SIGNED_OUT" | "UNAVAILABLE"> {
      return accessToken === null
        ? "SIGNED_OUT"
        : dependencies.provider.signOut(accessToken);
    },
  };
}

export type PersonSessionLifecycle = ReturnType<
  typeof createPersonSessionLifecycle
>;
