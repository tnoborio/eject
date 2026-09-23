export type PersonFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class PersonSessionRecovery {
  private epoch = 0;
  private signedOut = false;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(
    private readonly fetcher: PersonFetch,
    private readonly onUnauthorized: () => void,
  ) {}

  startSession(): void {
    this.signedOut = false;
    this.epoch += 1;
  }

  endSession(): void {
    this.signedOut = true;
    this.epoch += 1;
  }

  isActive(): boolean {
    return !this.signedOut;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const requestEpoch = this.epoch;
    const response = await this.fetcher(input, init);
    if (response.status !== 401 || this.signedOut || init?.signal?.aborted) {
      return response;
    }

    const refreshed = await this.refresh(requestEpoch);
    if (!refreshed || this.signedOut || init?.signal?.aborted) return response;

    const retried = await this.fetcher(input, init);
    if (retried.status === 401 && !this.signedOut) this.rejectSession();
    return retried;
  }

  private refresh(requestEpoch: number): Promise<boolean> {
    if (requestEpoch !== this.epoch) return Promise.resolve(!this.signedOut);
    if (this.refreshInFlight !== null) return this.refreshInFlight;

    const refreshEpoch = this.epoch;
    this.refreshInFlight = this.fetcher("/api/person/v1/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
      .then((response) => {
        if (this.signedOut || refreshEpoch !== this.epoch) return false;
        if (response.status === 204) {
          this.epoch += 1;
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
    this.endSession();
    this.onUnauthorized();
  }
}
