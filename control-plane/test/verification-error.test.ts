import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDatabaseSecurity } from "../scripts/database-security";
import {
  reportVerificationFailure,
  VerificationError,
} from "../scripts/verification-error";
import { postgresPoolConfigFromEnvironment } from "../src/infrastructure/postgres/pool-config";

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("cloud verification failure reporting", () => {
  it("prints a dedicated verification message and fails the process", () => {
    const output = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    reportVerificationFailure(
      new VerificationError("Cloud database is not PostgreSQL 17"),
    );
    expect(output).toHaveBeenCalledExactlyOnceWith(
      "Cloud database is not PostgreSQL 17",
    );
    expect(process.exitCode).toBe(1);
  });

  it.each([
    [
      { tables_without_rls: 1 },
      "Public tables must all have row-level security enabled",
    ],
    [
      { api_table_privileges: 1 },
      "Data API roles must have no public table privileges",
    ],
    [
      { connection_bypasses_rls: false },
      "Database connection role must own all public tables without FORCE RLS or have BYPASSRLS",
    ],
  ])(
    "preserves the specific database security diagnosis (%j)",
    (override, message) => {
      const output = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      try {
        assertDatabaseSecurity({
          public_tables: 19,
          tables_without_rls: 0,
          api_roles: 2,
          api_table_privileges: 0,
          connection_bypasses_rls: true,
          ...override,
        });
        expect.fail("Expected verification to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(VerificationError);
        reportVerificationFailure(error);
      }
      expect(output).toHaveBeenCalledExactlyOnceWith(message);
    },
  );

  it.each([
    [{}, "Required database environment is missing: DATABASE_URL"],
    [
      { DATABASE_URL: "https://user:do-not-print@example.test/database" },
      "DATABASE_URL is not a PostgreSQL URL",
    ],
    [
      {
        DATABASE_URL: "postgresql://user:do-not-print@example.test/database",
        EJECT_DATABASE_SSL_CA_B64: "not-base64!",
      },
      "EJECT_DATABASE_SSL_CA_B64 is not canonical base64",
    ],
  ])(
    "prints only the bounded pool configuration diagnosis (%j)",
    (environment, message) => {
      const output = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      try {
        postgresPoolConfigFromEnvironment(environment, 1);
        expect.fail("Expected configuration to fail");
      } catch (error) {
        reportVerificationFailure(error);
      }
      expect(output).toHaveBeenCalledExactlyOnceWith(message);
    },
  );

  it.each([
    Object.assign(new Error("password=do-not-print relation=private_table"), {
      code: "42501",
      detail: "private row",
    }),
    Object.assign(new Error("do-not-print"), { name: "VerificationError" }),
    { message: "do-not-print" },
  ])(
    "redacts untrusted errors even if their name mimics a safe type",
    (error) => {
      const output = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      reportVerificationFailure(error);
      expect(output).toHaveBeenCalledExactlyOnceWith(
        "Cloud database verification failed",
      );
      expect(process.exitCode).toBe(1);
    },
  );
});
