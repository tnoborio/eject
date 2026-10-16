import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVerificationPool } from "../scripts/verification-pool";
import { reportUnexpectedProductionMigrationFailure } from "../scripts/run-one-time-production-migration";
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

describe("production migration fatal process errors", () => {
  it.each(["uncaughtException", "unhandledRejection"])(
    "exits with a fixed diagnostic for %s without inspecting the error",
    (event) => {
      const output = captureOutput();
      const exited = new Error("test process exit");
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw exited;
      });
      const emitter = new EventEmitter();
      emitter.on(event, reportUnexpectedProductionMigrationFailure);
      expect(() => emitter.emit(event, failure)).toThrow(exited);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        "Production migration hook failed",
      );
      expectNoConnectionDetails(output.map((spy) => spy.mock.calls));
    },
  );
});
