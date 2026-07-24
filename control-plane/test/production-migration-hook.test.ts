import { describe, expect, it, vi } from "vitest";
import {
  prepareProductionMigrationEnvironment,
  runOneTimeProductionMigration,
  type ProductionMigrationOperations,
} from "../scripts/run-one-time-production-migration";
import type { CloudDatabaseVerification } from "../scripts/verify-cloud-database";

const now = new Date("2026-07-24T04:00:00.000Z");
const verification: CloudDatabaseVerification = {
  database: "postgres",
  postgres_major: 17,
  tls: "CA_AND_HOSTNAME_VERIFIED",
  migrations: [
    "0001_initial_control_plane.sql",
    "0002_agent_transport_security.sql",
    "0003_device_enrollment_and_revocation.sql",
    "0004_invite_only_relationships.sql",
    "0005_relationship_lifecycle.sql",
  ],
  delivery_enabled: false,
  physical_hourly_ceiling: null,
  application_rows: 1,
};

describe("one-time production migration hook", () => {
  it("skips every non-Production build without touching an operation", async () => {
    const operations = fakeOperations();
    await expect(
      runOneTimeProductionMigration({
        environment: { VERCEL_ENV: "preview" },
        now,
        operations,
      }),
    ).resolves.toEqual({ production_migration: "SKIPPED" });
    expect(operations.migrate).not.toHaveBeenCalled();
    expect(operations.cleanup).not.toHaveBeenCalled();
    expect(operations.verify).not.toHaveBeenCalled();
  });

  it("changes only the expected Supabase pooler port in memory", () => {
    const environment = productionEnvironment();
    const prepared = prepareProductionMigrationEnvironment(environment);
    expect(prepared).not.toBeNull();
    const original = new URL(environment.DATABASE_URL ?? "");
    const session = new URL(prepared?.DATABASE_URL ?? "");
    expect(original.port).toBe("6543");
    expect(session.port).toBe("5432");
    expect(session.hostname).toBe(original.hostname);
    expect(session.username).toBe(original.username);
    expect(session.password).toBe(original.password);
    expect(session.pathname).toBe("/postgres");
  });

  it.each([
    ["non-Vercel runtime", { VERCEL: "0" }],
    ["non-main ref", { VERCEL_GIT_COMMIT_REF: "feature" }],
    ["enabled delivery", { EJECT_AGENT_DELIVERY_ENABLED: "true" }],
    ["configured enrollment", { EJECT_DEVICE_ENROLLMENT_ENABLED: "false" }],
    ["configured signing key", { EJECT_SERVER_SIGNING_KEY_ID: "key-id" }],
    ["missing CA", { EJECT_DATABASE_SSL_CA_B64: "" }],
    [
      "unexpected database",
      { DATABASE_URL: "postgresql://user:secret@example.test:6543/postgres" },
    ],
  ])("fails closed for %s", (_label, override) => {
    expect(() =>
      prepareProductionMigrationEnvironment({
        ...productionEnvironment(),
        ...override,
      }),
    ).toThrow();
  });

  it("migrates, drains cleanup, then verifies without returning secrets", async () => {
    const operations = fakeOperations();
    operations.cleanup
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(0);
    const result = await runOneTimeProductionMigration({
      environment: productionEnvironment(),
      now,
      operations,
    });

    expect(operations.migrate).toHaveBeenCalledOnce();
    expect(operations.cleanup).toHaveBeenCalledTimes(3);
    expect(operations.verify).toHaveBeenCalledOnce();
    expect(operations.migrate.mock.invocationCallOrder[0]).toBeLessThan(
      operations.cleanup.mock.invocationCallOrder[0] ?? 0,
    );
    expect(operations.cleanup.mock.invocationCallOrder[2]).toBeLessThan(
      operations.verify.mock.invocationCallOrder[0] ?? 0,
    );
    expect(result).toEqual({
      production_migration: "APPLIED_AND_VERIFIED",
      ...verification,
      deleted_invitations: 512,
    });
    expect(JSON.stringify(result)).not.toContain("do-not-print");
    expect(JSON.stringify(result)).not.toContain("pinned-ca");
  });
});

function productionEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    EJECT_AGENT_DELIVERY_ENABLED: "false",
    EJECT_DATABASE_SSL_CA_B64: "pinned-ca",
    DATABASE_URL:
      "postgresql://eject:do-not-print@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
  };
}

function fakeOperations(): ProductionMigrationOperations & {
  migrate: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
} {
  return {
    migrate: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => 0),
    verify: vi.fn(async () => verification),
  };
}
