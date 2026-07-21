import { describe, expect, it } from "vitest";
import { postgresPoolConfigFromEnvironment } from "../src/infrastructure/postgres/pool-config";

describe("PostgreSQL pool configuration", () => {
  it("keeps local development connections simple", () => {
    expect(
      postgresPoolConfigFromEnvironment(
        { DATABASE_URL: "postgresql://eject:eject@127.0.0.1:5432/eject" },
        3,
      ),
    ).toEqual({
      connectionString: "postgresql://eject:eject@127.0.0.1:5432/eject",
      max: 3,
    });
  });

  it("requires an explicit CA for Supabase", () => {
    expect(() =>
      postgresPoolConfigFromEnvironment(
        {
          DATABASE_URL:
            "postgresql://postgres.example:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
        },
        1,
      ),
    ).toThrow("EJECT_DATABASE_SSL_CA_B64 is required");
  });

  it("rejects invalid URLs and certificates without echoing credentials", () => {
    expect(() =>
      postgresPoolConfigFromEnvironment(
        { DATABASE_URL: "https://user:do-not-print@example.test/database" },
        1,
      ),
    ).toThrow("DATABASE_URL is not a PostgreSQL URL");

    expect(() =>
      postgresPoolConfigFromEnvironment(
        {
          DATABASE_URL: "postgresql://user:do-not-print@example.test/database",
          EJECT_DATABASE_SSL_CA_B64:
            Buffer.from("not a certificate").toString("base64"),
        },
        1,
      ),
    ).toThrow("is not an X.509 certificate");
  });

  it("rejects connection-string TLS options when an explicit CA is supplied", () => {
    expect(() =>
      postgresPoolConfigFromEnvironment(
        {
          DATABASE_URL:
            "postgresql://user:secret@example.test/database?sslmode=no-verify",
          EJECT_DATABASE_SSL_CA_B64: "Y2VydGlmaWNhdGU=",
        },
        1,
      ),
    ).toThrow("must not contain sslmode");
  });
});
