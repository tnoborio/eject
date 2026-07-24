# Cloud Database Operations

[日本語](CLOUD-DATABASE.ja.md)

This runbook records the EJECT-specific managed database and deployment
boundary. It contains provider identifiers and reproducible checks, but no
credential, signing material, device token, or user data.

## Provisioned environment

As of 2026-07-22, the following environment exists under Sasara operational
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

The first four repository migrations are applied. Migration
`0005_relationship_lifecycle.sql` exists only in the current development
checkout and is not applied to the protected cloud database. PostgreSQL rejects
non-TLS external connections. The singleton delivery gate is `false`, the
physical hourly ceiling is unset, and the EJECT application tables contain one
invited person and no relationships, relationship invitations, devices,
commands, results, or private events.

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

For an operator session, obtain the database password and current Supabase CA
through the provider controls without writing either to the repository. Use the
session pooler on port 5432 for migrations, then run:

```sh
cd control-plane
npm run migrate
npm run verify:cloud-database -- --expect-empty
```

`DATABASE_URL` and `EJECT_DATABASE_SSL_CA_B64` must already be present in that
process environment. The migration runner takes a PostgreSQL advisory lock,
applies each file transactionally, and verifies stored SHA-256 checksums before
skipping an applied migration.

Omit `--expect-empty` after real accounts exist. The verifier still requires:

- the exact repository migration names and checksums;
- PostgreSQL major version 17;
- a pinned TLS CA and a successful verified connection;
- `delivery_enabled = false`; and
- `physical_hourly_ceiling IS NULL`.

Its output contains only bounded operational facts and an aggregate EJECT row
count. It does not print the connection string, host credential, row contents,
or event identifiers.

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

Migration 0004 is applied and its checksum is verified, so its schema may remain
dormant until the relationship-invitation routes are reviewed and deployed.
Applying that schema did not enable device enrollment or physical delivery.
Do not deploy relationship disconnection or reconnection behavior until
migration 0005 is applied and all five repository checksums are verified.

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
