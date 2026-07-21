import { X509Certificate } from "node:crypto";
import type { PoolConfig } from "pg";

const SUPABASE_ROOT_2021_SHA256 =
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";

type Environment = Readonly<Record<string, string | undefined>>;

export function postgresPoolConfigFromEnvironment(
  environment: Environment,
  max: number,
): PoolConfig {
  const connectionString = requiredEnvironment(environment, "DATABASE_URL");
  const databaseUrl = parseDatabaseUrl(connectionString);
  const isSupabase =
    databaseUrl.hostname.endsWith(".supabase.co") ||
    databaseUrl.hostname.endsWith(".pooler.supabase.com");

  const encodedCa = environment.EJECT_DATABASE_SSL_CA_B64;
  if (encodedCa === undefined || encodedCa === "") {
    if (isSupabase) {
      throw new Error(
        "EJECT_DATABASE_SSL_CA_B64 is required for a Supabase database",
      );
    }
    return { connectionString, max };
  }

  rejectConnectionStringSslOptions(databaseUrl);
  const ca = decodeCertificate(encodedCa);
  const certificate = parseCertificate(ca);
  if (isSupabase && certificate.fingerprint256 !== SUPABASE_ROOT_2021_SHA256) {
    throw new Error("The Supabase database CA fingerprint is not trusted");
  }

  return {
    connectionString,
    max,
    ssl: { ca, rejectUnauthorized: true },
  };
}

function requiredEnvironment(environment: Environment, name: string): string {
  const value = environment[name];
  if (value === undefined || value === "") {
    throw new Error(`Required database environment is missing: ${name}`);
  }
  return value;
}

function parseDatabaseUrl(connectionString: string): URL {
  try {
    const url = new URL(connectionString);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
    return url;
  } catch {
    throw new Error("DATABASE_URL is not a PostgreSQL URL");
  }
}

function rejectConnectionStringSslOptions(databaseUrl: URL): void {
  const conflicting = ["sslmode", "sslcert", "sslkey", "sslrootcert"].find(
    (name) => databaseUrl.searchParams.has(name),
  );
  if (conflicting !== undefined) {
    throw new Error(
      `DATABASE_URL must not contain ${conflicting} when EJECT_DATABASE_SSL_CA_B64 is set`,
    );
  }
}

function decodeCertificate(encoded: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("EJECT_DATABASE_SSL_CA_B64 is not canonical base64");
  }
  const certificate = Buffer.from(encoded, "base64");
  const canonicalInput = encoded.replace(/=+$/, "");
  const canonicalDecoded = certificate.toString("base64").replace(/=+$/, "");
  if (canonicalInput !== canonicalDecoded) {
    throw new Error("EJECT_DATABASE_SSL_CA_B64 is not canonical base64");
  }
  return certificate.toString("utf8");
}

function parseCertificate(pem: string): X509Certificate {
  try {
    return new X509Certificate(pem);
  } catch {
    throw new Error("EJECT_DATABASE_SSL_CA_B64 is not an X.509 certificate");
  }
}
