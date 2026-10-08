# Cloud Database Operations

[日本語](CLOUD-DATABASE.ja.md)

This runbook records the EJECT-specific managed database and deployment
boundary. It contains provider identifiers and reproducible checks, but no
credential, signing material, device token, or user data.

## Provisioned environment

As of 2026-07-24, the following environment exists under Sasara operational
ownership:

| Component               | Configuration                        |
| ----------------------- | ------------------------------------ |
| Supabase project        | `EJECT` (`twmmpmwmlegqlaoalolv`)     |
| Database region         | Tokyo, `ap-northeast-1`              |
| Database engine         | PostgreSQL 17                        |
| Vercel project          | `sasara/eject`                       |
| Vercel application root | `control-plane` in the npm workspace |
| Vercel runtime          | Next.js, Node.js 22, Tokyo `hnd1`    |
| Git source              | `tnoborio/eject`                     |

The Supabase project is dedicated to EJECT. It is not a database inside
`sasara-hub`, and it does not share an application schema or credentials with
another Sasara service.

Migrations 0001–0005 were applied and checksum-verified. The following row
snapshot is historical (2026-07-24), not a current production query. PostgreSQL
rejects non-TLS external connections. The singleton delivery gate is `false`,
the physical hourly ceiling is unset, and the EJECT application tables contain
one invited person and no relationships, relationship invitations, devices,
commands, results, or private events.

## RLS and the Data API boundary — 2026-10-08

The owner reports that the project is paused after inactivity. Security Advisor
reported critical `rls_disabled_in_public` findings on 2026-09-27. Migration
`0006_close_data_api_access.sql` is now in the repository but has **not** been
applied to production. No cloud connection or provider operation was performed
for this change.

EJECT uses Supabase Auth, not the Data API (PostgREST). The control plane connects
with `pg` through `DATABASE_URL` and Supavisor. Migration 0006 enables RLS on all
18 application tables and `schema_migrations`, creates no policies, and does not
use FORCE RLS. It revokes all privileges from existing `anon` and `authenticated`
roles on public tables, sequences, and functions, and removes their public-schema
default grants for objects created by the migration role. Missing API roles are
skipped so plain PostgreSQL remains supported. Other object-creator roles and
future explicit grants require separate review; PostgreSQL's implicit PUBLIC
function EXECUTE privilege is not removed by role-specific revocation. EJECT's
migrations currently create no functions. Any future callable function needs an
explicit privilege review before it can expose application data.

The concrete other object creator is `supabase_admin`: its public-schema default
ACL still grants all privileges to `anon` / `authenticated`, and `postgres`
cannot revoke those defaults. A table created through the dashboard or Management
API as `supabase_admin` can therefore be exposed immediately without RLS. The
verifier detects missing RLS and effective API table privileges. Change schema
only through repository migrations, never through those provider paths.

Security Advisor's INFO `rls_enabled_no_policy` is expected for all 19 tables:
policy-free RLS is intentional. Do not add policies to silence these INFO findings.

The application connection must own all application tables or have `BYPASSRLS`.
The verifier conservatively checks every public table, including the migration
ledger, and rejects forced RLS for an owner without bypass. Run verification
with the application's connection role, not only a privileged operator role.
Do not work around a failure by adding Data API policies or widening privileges.
Every future public table must enable RLS in its own migration; PostgreSQL tests
check the whole schema after all migrations.

After review and merge, the owner must complete this sequence in the operator
environment: **resume → role preflight → migrate → verify → Security Advisor
confirmation**.
Have the reviewed revision and operator environment ready before resuming;
the repository change alone does not protect the resumed database.

1. Resume the project and wait for it to be healthy.
2. Run the read-only role preflight below using the application connection. Stop
   if neither bypass nor ownership is confirmed.
3. Apply repository migrations using the session pooler and the existing
   migration role, following the commands below.
4. Run `npm run verify:cloud-database` with the application's connection role
   and pinned TLS CA. Existing accounts mean `--expect-empty` must be omitted.
5. Refresh Security Advisor and confirm the `rls_disabled_in_public` findings
   are cleared. A failed verifier or remaining warning needs investigation
   before treating the boundary as verified.

### Read-only role preflight before migration 0006

Before `npm run migrate`, execute this once in a read-only SQL session using the
role from the application's `DATABASE_URL`, with the pinned CA and verified TLS.
Do not substitute the dashboard's role or a more privileged operator role.
The result contains only a boolean and a count, with no table or row identifiers.

```sql
BEGIN READ ONLY;
SELECT r.rolbypassrls,
       (SELECT count(*) FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND c.relowner <> r.oid) AS public_tables_owned_by_other_roles
FROM pg_roles AS r
WHERE r.rolname = current_user;
COMMIT;
```

Proceed only if `rolbypassrls = true` **or**
`public_tables_owned_by_other_roles = 0`. If neither holds, **do not apply 0006**;
resolve the connection/ownership mismatch through a reviewed change first.
This preflight applies before 0006, whose DDL does not FORCE RLS; after applying,
the full verifier also checks forced RLS and effective API privileges.

BYPASSRLS permits data access, not ownership-only DDL. The migration role must
also be allowed to alter every target table. If ownership is mixed and it cannot
act as an affected table's owner, 0006 fails with `must be owner` and the existing
transaction runner rolls back all of 0006. Do not treat application bypass as
proof that the migration role can alter other roles' tables.

### Emergency recovery

If the application is unexpectedly blocked after applying 0006, an incident
operator with table-owner authority can temporarily use
`ALTER TABLE public.<affected_table> DISABLE ROW LEVEL SECURITY;` for the
identified affected table (replace the placeholder). Preserve the API privilege
revocations, keep delivery/enrollment disabled, and verify that API access stays
closed. Disabling RLS weakens defense in depth and is a temporary incident action,
not normal schema management. Record the affected scope and restore the intended
boundary through the next reviewed forward-only migration; never edit 0006 or
its ledger checksum. Do not add Data API policies as a recovery shortcut.

## Environment boundary

Vercel stores configuration outside the repository:

| Variable                          | Production | Preview | Development |
| --------------------------------- | ---------- | ------- | ----------- |
| `DATABASE_URL`                    | sensitive  | absent  | absent      |
| `EJECT_DATABASE_SSL_CA_B64`       | sensitive  | absent  | absent      |
| `EJECT_AGENT_DELIVERY_ENABLED`    | `false`    | `false` | `false`     |
| `EJECT_DEVICE_ENROLLMENT_ENABLED` | absent     | absent  | absent      |
| `EJECT_PERSON_AUTH_ENABLED`       | `true`     | absent  | absent      |
| `EJECT_SUPABASE_AUTH_ISSUER`      | configured | absent  | absent      |
| `EJECT_SUPABASE_AUTH_AUDIENCE`    | configured | absent  | absent      |
| `EJECT_SUPABASE_PUBLISHABLE_KEY`  | configured | absent  | absent      |
| `EJECT_PUBLIC_ORIGIN`             | configured | absent  | absent      |

Production uses the Supavisor transaction pooler on port 6543. Preview builds
do not receive the production database credential. They can build and render
the shell, but the agent routes remain unavailable. Development uses the local
database URL supplied by the operator, not a downloaded production secret.

No server response-signing private key is configured in Vercel. Even if the
environment delivery flag were changed accidentally, agent transport
composition would fail closed without the required signing key. The independent
database delivery gate also remains disabled. Device enrollment is independently
fail-closed because its opt-in environment variable is absent. Person auth is
enabled only in Production for the exact `https://eject-bice.vercel.app` origin.
Preview and Development remain fail-closed because their auth opt-in and provider
configuration are absent.

## Invite-only person provisioning

Person authentication remains separate from device enrollment and delivery.
Before enabling it, set Supabase Auth to reject public sign-up and configure the
exact EJECT HTTPS origin as both the site URL and the only redirect origin.

Provision an invited existing account from an operator environment, never from
Vercel and never from a browser. Supply the protected production database
variables, the exact Supabase issuer, and an operator-only secret API key through
the process environment:

```sh
npm run person:provision --workspace @eject/control-plane -- \
  PERSON_EMAIL "Display name"
```

The script creates a confirmed Supabase Auth identity and then creates the
matching EJECT `people` row and private-by-default
`recipient_access_policies` row with the same UUID in one database transaction.
If that transaction fails, it attempts to remove the new Auth identity. It does
not print the email, token, or database credential. Review Supabase Auth
manually if it reports that rollback needs attention.

Never configure `EJECT_PROVISIONING_SUPABASE_SECRET_KEY` in Vercel. The deployed
application needs only the publishable key; its fixed sign-in request uses
`create_user = false`.

## Production email OTP delivery

As of 2026-07-27, Supabase Auth uses Resend custom SMTP with a sender on the
verified `sasara.io` domain. The SMTP credential exists only in the provider
configuration; it is not present in the repository or Vercel.

An independent Management API read-back verified that external email is
enabled, the SMTP endpoint is Resend on port 465, public sign-up remains
disabled, and email OTPs remain eight digits with a ten-minute expiry. The
magic-link template now contains the bounded `{{ .Token }}` value in English
and Japanese and contains no `{{ .ConfirmationURL }}`.

A fresh Production request returned HTTP 202 and delivered an email containing
one unique eight-digit code in its text and HTML alternatives, with no URL. The
OTP endpoint returned HTTP 204; the protected owner-device and consent routes
then returned HTTP 200 with zero devices, zero relationships, and incoming
access unpaused. Logout returned HTTP 204, and the protected device route
returned HTTP 401 afterward. No email address, OTP, provider credential, or
session value was logged. The Gmail connector only searched and read the
message, and all temporary PKCE and cookie files were removed.

## TLS trust

The application requires a base64-encoded X.509 CA in
`EJECT_DATABASE_SSL_CA_B64` for every Supabase hostname. It rejects TLS options
inside `DATABASE_URL`, validates the certificate, and pins the Supabase Root
2021 CA SHA-256 fingerprint:

```text
80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
```

This preserves CA and hostname verification instead of using an encrypted but
unverified connection. Supabase distributes the CA through its Dashboard, and
its [SSL guide](https://supabase.com/docs/guides/platform/ssl-enforcement)
describes `verify-full` as the strongest mode.

## Apply migrations

English SQL files in `control-plane/migrations/` remain the only EJECT schema
source of truth. Do not edit the database schema in the provider dashboard.

Complete the read-only role preflight above before applying 0006.
For an operator session, obtain the database password and current Supabase CA
through the provider controls without writing either to the repository. Use the
session pooler on port 5432 for migrations, then run:

```sh
cd control-plane
npm run migrate
npm run verify:cloud-database
```

`DATABASE_URL` and `EJECT_DATABASE_SSL_CA_B64` must already be present in that
process environment. The migration runner takes a PostgreSQL advisory lock,
applies each file transactionally, and verifies stored SHA-256 checksums before
skipping an applied migration.

Use `--expect-empty` only for a newly provisioned empty database. The verifier requires:

- the exact repository migration names and checksums;
- PostgreSQL major version 17;
- a pinned TLS CA and a successful verified connection;
- RLS enabled on every public table, including `schema_migrations`;
- no effective public table or column privileges for existing `anon` /
  `authenticated` roles (including PUBLIC and inherited grants);
- a connection role that owns every public table without FORCE RLS or has
  `BYPASSRLS`;
- `delivery_enabled = false`; and
- `physical_hourly_ceiling IS NULL`.

Its output contains only bounded operational facts and an aggregate EJECT row
count, migration count, security counts, and booleans. Database names, migration
filenames, other object identifiers, credentials, and row contents are not
printed, including on failure. Dedicated verification/configuration errors retain
their bounded diagnostic messages; untrusted upstream errors use a generic message. The JSON evidence below predates this output format.

After migration 0005 is deployed, run invitation cleanup from the same
operator-only environment:

```sh
npm run relationships:cleanup
```

Each run deletes at most 500 rows that have been used, invalidated, or expired
for more than 24 hours, and prints only the deleted count. Run until it reports
zero. Do not configure database credentials in a public scheduler or browser.

## Deployment behavior

The Vercel project is connected to GitHub. Pull requests receive Preview
deployments without production database access. Merges to `main` may create a
Production deployment with the protected database variables, but agent delivery
continues to return `404 DELIVERY_DISABLED`.

Migration 0005 and all five checksums are verified. Relationship disconnection
and reconnection are deployed, while authenticated use still requires an
existing invited account and relationship. Applying the schema and deploying
the routes did not enable device enrollment or physical delivery.

Do not configure response-signing keys or enable either delivery gate until all
of the following are complete:

1. device enrollment and revocation are implemented;
2. a Windows agent pins the response key and validates signed responses;
3. standard-user CNG behavior has real Windows evidence;
4. Stage 0 has real tray-style optical-drive evidence;
5. an independent security review accepts the construction; and
6. a deliberate enablement change includes rollback and incident procedures.

## Rotation and recovery

- Rotate the database password in Supabase, replace the Production
  `DATABASE_URL` sensitive value, redeploy, verify, and invalidate the previous
  credential. Never copy it into Preview.
- When Supabase rotates its CA, verify the new certificate through an official
  provider channel, update the pinned fingerprint and Production CA together,
  run the full test suite, and deploy as a reviewed change.
- If database access is suspect, keep delivery disabled, rotate the credential,
  revoke affected sessions or devices, and preserve only bounded security
  evidence.
- Restore schema from checked-in forward-only migrations. Provider backups are
  recovery material, not a replacement schema source.
- A provider project administrator can reset the database password; the
  temporary creation password is not retained in the repository or runbook.

## Provisioning and migration evidence

On 2026-07-21, the repository verifier established the pinned direct-TLS
connection and initial empty schema. On 2026-07-22, migration 0003 was applied
in one advisory-locked transaction through the authenticated Supabase
Management API. A separate read-only Management API query then established the
exact three migration checksums, PostgreSQL major version, disabled database
gate, unset physical ceiling, zero aggregate application rows, new device
metadata columns and indexes, and removal of the superseded owner constraint:

```json
{
  "database": "postgres",
  "postgres_major": 17,
  "tls": "CA_AND_HOSTNAME_VERIFIED",
  "migrations": [
    "0001_initial_control_plane.sql",
    "0002_agent_transport_security.sql",
    "0003_device_enrollment_and_revocation.sql"
  ],
  "delivery_enabled": false,
  "physical_hourly_ceiling": null,
  "application_rows": 0
}
```

This is cloud schema and connectivity evidence. It is not evidence that a
physical tray has opened and does not complete Stage 0.

On 2026-07-24, migration 0004 was applied through the authenticated Supabase
Management API in one transaction with the same advisory lock. An independent
read-only query then verified all four repository checksums, PostgreSQL 17,
disabled delivery, an unset physical ceiling, one person, zero relationships
and invitations, the digest-only invitation column, the unique one-pending-code
index, and the absence of accepter identity storage:

```json
{
  "database": "postgres",
  "postgres_major": 17,
  "migrations": [
    "0001_initial_control_plane.sql",
    "0002_agent_transport_security.sql",
    "0003_device_enrollment_and_revocation.sql",
    "0004_invite_only_relationships.sql"
  ],
  "delivery_enabled": false,
  "physical_hourly_ceiling": null,
  "people": 1,
  "relationships": 0,
  "relationship_invitations": 0
}
```

Later on 2026-07-24, PR #21 used a reviewed one-time Vercel Production build
bridge to apply migration 0005 before the new deployment became active. The
bridge changed only the Supabase pooler port in process memory, printed no
credential, drained zero eligible invitation rows, and independently verified
pinned TLS, PostgreSQL 17, all five checksums, disabled delivery, the unset
physical ceiling, and one aggregate application row:

```json
{
  "database": "postgres",
  "postgres_major": 17,
  "tls": "CA_AND_HOSTNAME_VERIFIED",
  "migrations": [
    "0001_initial_control_plane.sql",
    "0002_agent_transport_security.sql",
    "0003_device_enrollment_and_revocation.sql",
    "0004_invite_only_relationships.sql",
    "0005_relationship_lifecycle.sql"
  ],
  "delivery_enabled": false,
  "physical_hourly_ceiling": null,
  "application_rows": 1,
  "deleted_invitations": 0
}
```

Production deployment `dpl_B4GqXfk457m1qWeRkb5bzYMDFWEo` then reached `Ready`
with the relationship-disconnection route. External checks received HTTP 200
from `/`, `404 DELIVERY_DISABLED` from agent polling,
`404 ENROLLMENT_DISABLED` from agent enrollment, and
`401 AUTHENTICATION_REQUIRED` from an unauthenticated disconnection request.
PR #22 removed the one-time bridge. Ordinary Production deployment
`dpl_91cuRwKTJp2bLa3kT9MVtJ4PG8Nb` then reached `Ready` from merge commit
`739392a` with `next build` as the complete build command. The bridge is not a
retained general migration runner.

The current Production deployment also returned the bounded semantic bodies
`{"error":"DELIVERY_DISABLED"}` from agent polling and
`{"error":"ENROLLMENT_DISABLED"}` from agent enrollment. No response-signing
key, person, device, enrollment secret, command, result, or private event was
created during this operation.

The first protected Vercel deployment (`dpl_G6pHisFuPVmausakV6PXxzrGtZYi`)
reached `Ready` on 2026-07-21. Its Next.js Functions were placed in `hnd1`; an
authenticated deployment check received HTTP 200 from `/` and HTTP 404 with the
semantic body `{"error":"DELIVERY_DISABLED"}` from `POST
/api/agent/v1/poll`.
