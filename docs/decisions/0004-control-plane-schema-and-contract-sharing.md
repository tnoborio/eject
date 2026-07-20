# ADR 0004: Control-plane Schema and Contract Sharing

[日本語](0004-control-plane-schema-and-contract-sharing.ja.md)

- **Status:** Accepted
- **Date:** 2026-07-20

## Context

ADR 0003 fixes the Stage 1 transaction, locking, idempotency, Kysely, and test
boundaries. Implementation still needs one reviewable PostgreSQL source of
truth and a way to consume protocol v1 without making wire objects part of the
domain.

Generated schema push, ORM metadata, copied JSON Schema, and independently
maintained transport types would hide or duplicate the invariants that protect
recipient consent. The repository also needs migrations that can be reproduced
from an empty database in CI without production credentials.

## Decision

### PostgreSQL source of truth

1. Store ordered, forward-only SQL migrations under
   `control-plane/migrations`. Those committed SQL files are the canonical
   database schema history.
2. Name migrations with a monotonically increasing numeric prefix. Apply each
   migration in one transaction and record its filename and SHA-256 checksum in
   a `schema_migrations` ledger.
3. Serialize migration runners with a PostgreSQL advisory lock. This lock is
   only for schema deployment; command issuance continues to use the row locks
   fixed in ADR 0003 and gains no distributed locking dependency.
4. Never edit a migration after it has been applied to a shared environment.
   Make corrections with a new forward migration. Treat rollback as restoration
   from a tested backup or a deliberate compensating migration, not an
   automatically generated `down` function.
5. Do not use schema push, runtime auto-synchronization, or ORM metadata as a
   second source of truth. Kysely database interfaces are a compile-time mirror
   contained in infrastructure and must be updated with the migration.
6. Use PostgreSQL constraints for closed state values, UUID identity, foreign
   keys, idempotency uniqueness, one-time eject-back consumption, positive
   limits, and the maximum protocol-v1 command lifetime. Application checks do
   not replace those constraints.
7. Store timestamps as `timestamptz` and generate person, request, command, and
   event UUIDs in the application. The database remains authoritative for
   uniqueness.

The initial schema contains only bounded control-plane facts: people without
authentication secrets, relationships, directional grants, blocks,
recipient-authored access policy, plan-agnostic entitlement ceilings, registered
device eligibility, recipient and sender rate state, idempotent requests,
commands, and lifecycle events. It stores no email address, device credential,
disc metadata, raw request body, or localized sentence.

### Protocol sharing

8. Keep `protocol/v1/eject-protocol.schema.json` as the sole wire-contract
   source of truth. Expose the existing protocol directory as the private
   workspace package `@eject/protocol-contract`.
9. Only control-plane transport adapters import the protocol validator or wire
   schema. They validate closed payloads and explicitly map validated data to
   application and domain values. Domain and application modules do not import
   JSON Schema, AJV, protocol package types, or wire objects.
10. Do not generate a second authoritative set of protocol types initially.
    Small transport-local types may describe already validated values, but the
    JSON Schema and semantic protocol tests remain authoritative.
11. CI runs the existing protocol contract tests whenever the protocol package
    or its control-plane adapter changes. The control-plane production build
    must resolve the same workspace package; copying the schema into the app is
    prohibited.

## Consequences

- A reviewer can see consent, lifecycle, and idempotency invariants in explicit
  SQL and reproduce the complete schema from an empty PostgreSQL database.
- Migration drift is detected by checksum before a changed historical file can
  be silently applied.
- Infrastructure remains PostgreSQL-aware while domain policy remains portable
  and pure.
- The agent and control plane validate one protocol artifact without coupling
  authorization to transport representation.
- Destructive rollback is intentionally not automatic. Production deployment
  requires backup and restore practice before private alpha.

## Rejected alternatives

- Prisma, Drizzle, or provider schema push as the migration source of truth.
- Runtime schema auto-synchronization.
- Maintaining a copied JSON Schema under the control-plane directory.
- Importing wire payloads directly into domain policy.
- Generating and treating TypeScript protocol types as more authoritative than
  the accepted JSON Schema.
