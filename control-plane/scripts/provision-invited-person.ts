import { Pool } from "pg";
import { postgresPoolConfigFromEnvironment } from "../src/infrastructure/postgres/pool-config";

const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maximumResponseBytes = 64 * 1_024;

async function main(): Promise<void> {
  const input = parseInput(process.argv.slice(2));
  const issuer = parseIssuer(requiredEnvironment("EJECT_SUPABASE_AUTH_ISSUER"));
  const secretKey = requiredEnvironment(
    "EJECT_PROVISIONING_SUPABASE_SECRET_KEY",
  );
  const pool = new Pool(postgresPoolConfigFromEnvironment(process.env, 1));
  let authUserId: string | null = null;

  try {
    authUserId = await createAuthUser({
      issuer,
      secretKey,
      email: input.email,
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO people (
           person_id, display_name, account_status, participation_state,
           availability
         ) VALUES ($1, $2, 'ACTIVE', 'ACCOUNT_ONLY', 'OFFLINE')`,
        [authUserId, input.displayName],
      );
      await client.query(
        `INSERT INTO recipient_access_policies (recipient_id)
         VALUES ($1)`,
        [authUserId],
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    process.stdout.write("Provisioned one invite-only EJECT person.\n");
  } catch (error: unknown) {
    if (authUserId !== null) {
      await deleteAuthUser({ issuer, secretKey, userId: authUserId }).catch(
        () => {
          process.stderr.write(
            "Provisioning rollback requires manual Supabase Auth review.\n",
          );
        },
      );
    }
    throw error;
  } finally {
    await pool.end();
  }
}

function parseInput(args: readonly string[]): {
  readonly email: string;
  readonly displayName: string;
} {
  if (args.length !== 2) {
    throw new Error(
      "Usage: npm run person:provision -- <email> <display-name>",
    );
  }
  const [email, displayName] = args;
  if (email === undefined || email.length > 254 || !emailPattern.test(email)) {
    throw new Error("Provisioning email is invalid");
  }
  if (
    displayName === undefined ||
    displayName.length === 0 ||
    displayName.length > 80 ||
    displayName.trim() !== displayName ||
    /[\u0000-\u001f\u007f]/u.test(displayName)
  ) {
    throw new Error("Provisioning display name is invalid");
  }
  return { email, displayName };
}

async function createAuthUser(input: {
  readonly issuer: string;
  readonly secretKey: string;
  readonly email: string;
}): Promise<string> {
  const response = await fetch(`${input.issuer}/admin/users`, {
    method: "POST",
    headers: adminHeaders(input.secretKey),
    body: JSON.stringify({
      email: input.email,
      email_confirm: true,
      user_metadata: {},
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await readBoundedJson(response);
  if (
    !response.ok ||
    typeof body !== "object" ||
    body === null ||
    !("id" in body) ||
    typeof body.id !== "string" ||
    !uuidPattern.test(body.id)
  ) {
    throw new Error(`Supabase Auth provisioning failed (${response.status})`);
  }
  return body.id;
}

async function deleteAuthUser(input: {
  readonly issuer: string;
  readonly secretKey: string;
  readonly userId: string;
}): Promise<void> {
  const response = await fetch(
    `${input.issuer}/admin/users/${input.userId}?should_soft_delete=false`,
    {
      method: "DELETE",
      headers: adminHeaders(input.secretKey),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error("Supabase Auth provisioning rollback failed");
  }
}

function adminHeaders(secretKey: string): Readonly<Record<string, string>> {
  if (
    secretKey.length < 20 ||
    secretKey.length > 2_048 ||
    !/^[A-Za-z0-9._-]+$/.test(secretKey) ||
    secretKey.startsWith("sb_publishable_")
  ) {
    throw new Error("Supabase provisioning secret key is invalid");
  }
  const headers: Record<string, string> = {
    apikey: secretKey,
    "content-type": "application/json;charset=UTF-8",
  };
  if (!secretKey.startsWith("sb_secret_")) {
    headers.authorization = `Bearer ${secretKey}`;
  }
  return headers;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > maximumResponseBytes)
  ) {
    throw new Error("Supabase Auth provisioning response is invalid");
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > maximumResponseBytes) {
    throw new Error("Supabase Auth provisioning response is invalid");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new Error("Supabase Auth provisioning response is invalid");
  }
}

function parseIssuer(value: string): string {
  const issuer = new URL(value);
  if (
    issuer.protocol !== "https:" ||
    issuer.username !== "" ||
    issuer.password !== "" ||
    issuer.search !== "" ||
    issuer.hash !== "" ||
    issuer.pathname !== "/auth/v1"
  ) {
    throw new Error("EJECT_SUPABASE_AUTH_ISSUER is invalid");
  }
  return issuer.toString().replace(/\/$/, "");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Required provisioning environment is missing: ${name}`);
  }
  return value;
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown provisioning failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
