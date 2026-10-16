import { afterEach, describe, expect, it, vi } from "vitest";
import { createVerificationPool } from "../scripts/verification-pool";
import { reportVerificationFailure } from "../scripts/verification-error";

const connection = {
  host: "private-host.example.test",
  user: "private-user",
  database: "private-database",
};
const failure = Object.assign(new Error(JSON.stringify(connection)), {
  client: { connectionParameters: connection },
});
const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

function captureOutput() {
  return ["error", "log", "warn"].map((method) =>
    vi
      .spyOn(console, method as "error" | "log" | "warn")
      .mockImplementation(() => undefined),
  );
}

function expectNoConnectionDetails(output: unknown) {
  const text = JSON.stringify(output);
  for (const value of Object.values(connection)) {
    expect(text).not.toContain(value);
  }
}

describe("verification pool idle errors", () => {
  it("consumes errors carrying client details without logging or throwing", async () => {
    const output = captureOutput();
    const pool = createVerificationPool(connection);
    try {
      expect(() => pool.emit("error", failure, failure.client)).not.toThrow();
      for (const spy of output) expect(spy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(originalExitCode);

      // A subsequent rejected operation still uses the existing CLI reporter.
      await Promise.reject(failure).catch(reportVerificationFailure);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        "Cloud database verification failed",
      );
      expect(process.exitCode).toBe(1);
      expectNoConnectionDetails(output.map((spy) => spy.mock.calls));
    } finally {
      await pool.end();
    }
  });
});
