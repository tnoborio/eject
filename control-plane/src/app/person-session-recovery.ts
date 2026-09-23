export type PersonFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class PersonSessionRecovery {
  private sessionGeneration = 0;
  private refreshGeneration = 0;
  private signedOut = false;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(
    private readonly fetcher: PersonFetch,
    private readonly onUnauthorized: () => void,
  ) {}

  startSession(): void {
    this.signedOut = false;
    this.sessionGeneration += 1;
  }

  endSession(): Promise<void> {
    this.signedOut = true;
    this.sessionGeneration += 1;
    return this.refreshInFlight?.then(() => undefined) ?? Promise.resolve();
  }

  isActive(): boolean {
    return !this.signedOut;
  }

  identity(): number {
    return this.sessionGeneration;
  }

  isCurrent(identity: number): boolean {
    return !this.signedOut && identity === this.sessionGeneration;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const requestSession = this.sessionGeneration;
    const requestRefresh = this.refreshGeneration;
    const response = await this.fetcher(input, init);
    if (response.status !== 401 || this.signedOut || init?.signal?.aborted) {
      return response;
    }

    const refreshed = await this.refresh(requestSession, requestRefresh);
    if (
      !refreshed ||
      !this.isCurrent(requestSession) ||
      init?.signal?.aborted
    ) {
      return response;
    }

    const retried = await this.fetcher(input, init);
    if (
      retried.status === 401 &&
      this.isCurrent(requestSession) &&
      !init?.signal?.aborted
    ) {
      this.rejectSession();
    }
    return retried;
  }

  private refresh(
    requestSession: number,
    requestRefresh: number,
  ): Promise<boolean> {
    if (requestSession !== this.sessionGeneration || this.signedOut) {
      return Promise.resolve(false);
    }
    if (requestRefresh !== this.refreshGeneration) return Promise.resolve(true);
    if (this.refreshInFlight !== null) return this.refreshInFlight;

    const refreshSession = this.sessionGeneration;
    this.refreshInFlight = this.fetcher("/api/person/v1/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
      .then((response) => {
        if (this.signedOut || refreshSession !== this.sessionGeneration) {
          return false;
        }
        if (response.status === 204) {
          this.refreshGeneration += 1;
          return true;
        }
        if (response.status === 401) this.rejectSession();
        return false;
      })
      .catch(() => false)
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  private rejectSession(): void {
    if (this.signedOut) return;
    void this.endSession();
    this.onUnauthorized();
  }
}
