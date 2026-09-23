import { describe, expect, it, vi } from "vitest";
import { PersonSessionRecovery } from "../src/app/person-session-recovery";

describe("person session recovery", () => {
  it("calls an injected fetch without giving it the recovery instance as receiver", async () => {
    const receiverSensitive = vi.fn(function (this: unknown) {
      if (this !== undefined) throw new TypeError("illegal receiver");
      return Promise.resolve(response(200));
    });
    const recovery = new PersonSessionRecovery(receiverSensitive, vi.fn());

    await expect(recovery.fetch("/devices")).resolves.toMatchObject({
      status: 200,
    });
    expect(receiverSensitive).toHaveBeenCalledWith("/devices", undefined);
  });

  it("coordinates concurrent expired requests through one refresh and retries each once", async () => {
    const fetcher = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200));
    const recovery = new PersonSessionRecovery(fetcher, vi.fn());

    await expect(
      Promise.all([recovery.fetch("/devices"), recovery.fetch("/consent")]),
    ).resolves.toEqual([
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ status: 200 }),
    ]);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/devices",
      "/consent",
      "/api/person/v1/auth/refresh",
      "/devices",
      "/consent",
    ]);
  });

  it("retries a staggered stale 401 after another request rotated the session", async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetcher = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200));
    const recovery = new PersonSessionRecovery(fetcher, vi.fn());
    const stale = recovery.fetch("/devices");
    await expect(recovery.fetch("/consent")).resolves.toMatchObject({
      status: 200,
    });
    resolveFirst?.(response(401));
    await expect(stale).resolves.toMatchObject({ status: 200 });
    expect(
      fetcher.mock.calls.filter(
        ([path]) => path === "/api/person/v1/auth/refresh",
      ),
    ).toHaveLength(1);
  });

  it("does not retry after temporary refresh failure or terminally rejected refresh", async () => {
    const unavailable = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(503));
    const unavailableUnauthorized = vi.fn();
    const unavailableRecovery = new PersonSessionRecovery(
      unavailable,
      unavailableUnauthorized,
    );
    await expect(
      unavailableRecovery.fetch("/pause", { method: "POST" }),
    ).resolves.toMatchObject({ status: 401 });
    expect(unavailable).toHaveBeenCalledTimes(2);
    expect(unavailableUnauthorized).not.toHaveBeenCalled();

    const offline = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response(401))
      .mockRejectedValueOnce(new TypeError("network unavailable"));
    const offlineRecovery = new PersonSessionRecovery(offline, vi.fn());
    await expect(
      offlineRecovery.fetch("/revoke", { method: "POST" }),
    ).resolves.toMatchObject({ status: 401 });
    expect(offline).toHaveBeenCalledTimes(2);

    const rejected = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401));
    const rejectedUnauthorized = vi.fn();
    const rejectedRecovery = new PersonSessionRecovery(
      rejected,
      rejectedUnauthorized,
    );
    await expect(
      rejectedRecovery.fetch("/pause", { method: "POST" }),
    ).resolves.toMatchObject({ status: 401 });
    expect(rejected).toHaveBeenCalledTimes(2);
    expect(rejectedUnauthorized).toHaveBeenCalledTimes(1);
    expect(rejectedRecovery.isActive()).toBe(false);
  });

  it("does not let an old retried 401 invalidate a newer login", async () => {
    let resolveRetry: ((value: Response) => void) | undefined;
    const retry = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
    const fetcher = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(204))
      .mockImplementationOnce(() => retry);
    const unauthorized = vi.fn();
    const recovery = new PersonSessionRecovery(fetcher, unauthorized);

    const stale = recovery.fetch("/devices");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await recovery.endSession();
    recovery.startSession();
    const currentIdentity = recovery.identity();
    resolveRetry?.(response(401));

    await expect(stale).resolves.toMatchObject({ status: 401 });
    expect(unauthorized).not.toHaveBeenCalled();
    expect(recovery.isCurrent(currentIdentity)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("settles an in-flight refresh before the caller can send logout", async () => {
    let resolveRefresh: ((value: Response) => void) | undefined;
    const refresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetcher = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response(401))
      .mockImplementationOnce(() => refresh)
      .mockResolvedValueOnce(response(204));
    const unauthorized = vi.fn();
    const recovery = new PersonSessionRecovery(fetcher, unauthorized);
    const controller = new AbortController();
    const pending = recovery.fetch("/devices", { signal: controller.signal });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    controller.abort();
    const logout = recovery
      .endSession()
      .then(() => fetcher("/api/person/v1/auth/logout"));
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolveRefresh?.(response(204));
    await expect(pending).resolves.toMatchObject({ status: 401 });
    await expect(logout).resolves.toMatchObject({ status: 204 });
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/devices",
      "/api/person/v1/auth/refresh",
      "/api/person/v1/auth/logout",
    ]);
    expect(unauthorized).not.toHaveBeenCalled();
    expect(recovery.isActive()).toBe(false);
  });
});

function response(status: number): Response {
  return new Response(null, { status });
}
