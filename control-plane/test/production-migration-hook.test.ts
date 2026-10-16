import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inspectProductionMigrationRole,
  runOneTimeProductionMigration,
  type ProductionMigrationOperations,
} from "../scripts/run-one-time-production-migration";
import {
  reportVerificationFailure,
  VerificationError,
} from "../scripts/verification-error";
import type { CloudDatabaseVerification } from "../scripts/verify-cloud-database";

const databaseUrl =
  "postgresql://eject:do-not-print@fixture.pooler.supabase.com:6543/postgres";
const verification: CloudDatabaseVerification = {
  postgres_major: 17,
  tls: "CA_AND_HOSTNAME_VERIFIED",
  migrations: 6,
  public_tables: 19,
  tables_without_rls: 0,
  api_roles: 2,
  api_table_privileges: 0,
  connection_bypasses_rls: true,
  delivery_enabled: false,
  physical_hourly_ceiling: null,
  application_rows: 2,
};
const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

function productionEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    EJECT_AGENT_DELIVERY_ENABLED: "false",
    EJECT_DATABASE_SSL_CA_B64: "pinned-ca",
    DATABASE_URL: databaseUrl,
  };
}

function fakeOperations() {
  return {
    preflight: vi.fn(async () => ({
      rolbypassrls: false,
      public_tables_owned_by_other_roles: 0,
    })),
    migrate: vi.fn(async () => undefined),
    verify: vi.fn(async () => verification),
  } satisfies ProductionMigrationOperations;
}

function expectNoOperations(operations: ReturnType<typeof fakeOperations>) {
  for (const operation of Object.values(operations)) {
    expect(operation).not.toHaveBeenCalled();
  }
}

function expectNoSecrets(output: string) {
  for (const secret of [
    databaseUrl,
    "do-not-print",
    "fixture.pooler.supabase.com",
    "pinned-ca",
    "private_table",
    "private row",
    "0006_close_data_api_access.sql",
  ]) {
    expect(output).not.toContain(secret);
  }
}

describe("one-time production migration hook", () => {
  it.each([undefined, "", "preview", "development", "Production"])(
    "skips non-production (%s) without any database operation",
    async (VERCEL_ENV) => {
      const operations = fakeOperations();
      await expect(
        runOneTimeProductionMigration({
          environment: { VERCEL_ENV },
          operations,
        }),
      ).resolves.toEqual({ production_migration: "SKIPPED" });
      expectNoOperations(operations);
    },
  );

  it.each([
    { VERCEL: undefined },
    { VERCEL: "0" },
    { VERCEL_GIT_COMMIT_REF: undefined },
    { VERCEL_GIT_COMMIT_REF: "feature" },
    { EJECT_AGENT_DELIVERY_ENABLED: undefined },
    { EJECT_AGENT_DELIVERY_ENABLED: "" },
    { EJECT_AGENT_DELIVERY_ENABLED: "true" },
    { EJECT_DEVICE_ENROLLMENT_ENABLED: "false" },
    { EJECT_SERVER_SIGNING_KEY_ID: "do-not-print" },
    { EJECT_SERVER_SIGNING_KEY_PKCS8_B64: "do-not-print" },
    { EJECT_DATABASE_SSL_CA_B64: undefined },
    { EJECT_DATABASE_SSL_CA_B64: "" },
    ...[
      undefined,
      "",
      "invalid-do-not-print",
      databaseUrl.replace("postgresql:", "https:"),
      databaseUrl.replace("fixture.pooler.supabase.com", "example.test"),
      databaseUrl.replace("fixture.pooler.supabase.com", "pooler.supabase.com"),
      databaseUrl.replace(
        "fixture.pooler.supabase.com",
        "fixture.pooler.supabase.com.attacker.test",
      ),
      databaseUrl.replace(":6543", ":5432"),
      databaseUrl.replace(":6543", ""),
      databaseUrl.replace("/postgres", "/other"),
      databaseUrl + "?sslmode=require",
      databaseUrl + "#do-not-print",
      databaseUrl + "?",
      databaseUrl + "#",
    ].map((DATABASE_URL) => ({ DATABASE_URL })),
  ])("fails closed before any database operation (%j)", async (override) => {
    const operations = fakeOperations();
    const output = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const result = runOneTimeProductionMigration({
      environment: { ...productionEnvironment(), ...override },
      operations,
    });
    await expect(result).rejects.toBeInstanceOf(VerificationError);
    await result.catch(reportVerificationFailure);
    expect(process.exitCode).toBe(1);
    expectNoOperations(operations);
    expectNoSecrets(JSON.stringify(output.mock.calls));
  });

  it.each([
    { rolbypassrls: false, public_tables_owned_by_other_roles: 0 },
    { rolbypassrls: true, public_tables_owned_by_other_roles: 19 },
  ])(
    "runs preflight, migrate, verify with an immutable session environment (%j)",
    async (preflight) => {
      const environment: Readonly<Record<string, string | undefined>> =
        Object.freeze({
          ...productionEnvironment(),
          EJECT_DEVICE_ENROLLMENT_ENABLED: "",
          EJECT_SERVER_SIGNING_KEY_ID: "",
          EJECT_SERVER_SIGNING_KEY_PKCS8_B64: "",
        });
      const originalProcessUrl = process.env.DATABASE_URL;
      const operations = fakeOperations();
      operations.preflight.mockResolvedValue(preflight);
      const result = await runOneTimeProductionMigration({
        environment,
        operations,
      });
      expect(result).toEqual({
        production_migration: "APPLIED_AND_VERIFIED",
        preflight,
        ...verification,
      });
      for (const operation of Object.values(operations)) {
        expect(operation).toHaveBeenCalledExactlyOnceWith({
          ...environment,
          DATABASE_URL: databaseUrl.replace(":6543", ":5432"),
        });
      }
      expect(operations.preflight.mock.invocationCallOrder[0]).toBeLessThan(
        operations.migrate.mock.invocationCallOrder[0]!,
      );
      expect(operations.migrate.mock.invocationCallOrder[0]).toBeLessThan(
        operations.verify.mock.invocationCallOrder[0]!,
      );
      expect(environment.DATABASE_URL).toBe(databaseUrl);
      expect(process.env.DATABASE_URL).toBe(originalProcessUrl);
      expectNoSecrets(JSON.stringify(result));
    },
  );

  it("also accepts the postgres URL scheme", async () => {
    await expect(
      runOneTimeProductionMigration({
        environment: {
          ...productionEnvironment(),
          DATABASE_URL: databaseUrl.replace("postgresql:", "postgres:"),
        },
        operations: fakeOperations(),
      }),
    ).resolves.toHaveProperty("production_migration", "APPLIED_AND_VERIFIED");
  });

  it("stops before migrate or verify when the role has neither bypass nor ownership", async () => {
    const operations = fakeOperations();
    operations.preflight.mockResolvedValue({
      rolbypassrls: false,
      public_tables_owned_by_other_roles: 1,
    });
    await expect(
      runOneTimeProductionMigration({
        environment: productionEnvironment(),
        operations,
      }),
    ).rejects.toThrow(
      "Production migration role preflight requires bypass or ownership",
    );
    expect(operations.migrate).not.toHaveBeenCalled();
    expect(operations.verify).not.toHaveBeenCalled();
  });

  it.each(["preflight", "migrate", "verify"] as const)(
    "propagates %s failure but reports no upstream details",
    async (step) => {
      const operations = fakeOperations();
      const error = new Error(
        `${databaseUrl} private_table private row 0006_close_data_api_access.sql`,
      );
      operations[step].mockRejectedValue(error);
      const output = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const result = runOneTimeProductionMigration({
        environment: productionEnvironment(),
        operations,
      });
      await expect(result).rejects.toBe(error);
      await result.catch(reportVerificationFailure);
      expect(output).toHaveBeenCalledExactlyOnceWith(
        "Cloud database verification failed",
      );
      expect(process.exitCode).toBe(1);
      expectNoSecrets(JSON.stringify(output.mock.calls));
      if (step === "preflight")
        expect(operations.migrate).not.toHaveBeenCalled();
      if (step !== "verify") expect(operations.verify).not.toHaveBeenCalled();
    },
  );
});

describe("production role preflight SQL", () => {
  it("executes the runbook query in a read-only transaction and returns only facts", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { rolbypassrls: false, public_tables_owned_by_other_roles: "0" },
        ],
      });
    await expect(inspectProductionMigrationRole({ query })).resolves.toEqual({
      rolbypassrls: false,
      public_tables_owned_by_other_roles: 0,
    });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN READ ONLY",
      expect.stringContaining("WHERE r.rolname = current_user"),
      "COMMIT",
    ]);
    expect(query.mock.calls[1]?.[0]).toContain("c.relowner <> r.oid");
    expect(query.mock.calls[1]?.[0]).toContain("c.relkind IN ('r', 'p')");
  });

  it("rolls back a failed query without replacing its error", async () => {
    const error = new Error(databaseUrl);
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(error);
    await expect(inspectProductionMigrationRole({ query })).rejects.toBe(error);
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  it.each([
    { rows: [] },
    {
      rows: [
        { rolbypassrls: false, public_tables_owned_by_other_roles: "invalid" },
      ],
    },
  ])("rejects missing or invalid preflight facts", async ({ rows }) => {
    const query = vi.fn().mockResolvedValue({ rows });
    await expect(inspectProductionMigrationRole({ query })).rejects.toThrow(
      "Production migration role preflight is invalid",
    );
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
