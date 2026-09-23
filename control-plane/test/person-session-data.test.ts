import { describe, expect, it, vi } from "vitest";
import { readCurrentPersonJson } from "../src/app/person-session-data";
import { PersonSessionRecovery } from "../src/app/person-session-recovery";

describe("current person response data", () => {
  it("does not release delayed protected JSON after logout", async () => {
    let resolveBody: ((value: unknown) => void) | undefined;
    const body = new Promise<unknown>((resolve) => {
      resolveBody = resolve;
    });
    const recovery = new PersonSessionRecovery(vi.fn(), vi.fn());
    const identity = recovery.identity();
    const pending = readCurrentPersonJson<{ devices: string[] }>(
      { json: vi.fn().mockReturnValue(body) },
      recovery,
      identity,
    );
    await recovery.endSession();
    resolveBody?.({ devices: ["private-device"] });
    await expect(pending).resolves.toBeNull();
  });
});
