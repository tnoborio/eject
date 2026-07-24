# ADR 0007: Relationship Disconnection and Reconnection

[日本語](0007-relationship-lifecycle.ja.md)

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

ADR 0006 creates a private relationship without granting EJECT permission, but
deliberately deferred disconnection, reconnection, cancellation, and invitation
retention. A person must be able to end a relationship immediately without
leaving either directional grant or an undelivered physical command active.

Disconnection must not become a block, an account-discovery signal, or a generic
social-network lifecycle. Reconnection must require the same deliberate
out-of-band action as the initial connection.

## Decision

1. Either person may disconnect one active relationship. The fixed request
   names only the other person ID and returns the same no-content result when
   the relationship is already inactive or unavailable.
2. In one short PostgreSQL `SERIALIZABLE` transaction, lock both recipient eject
   state rows in deterministic person-ID order, lock the relationship, mark it
   inactive, remove both directional grants, and cancel both directions of
   `QUEUED` or unconfirmed `DISPATCHED` commands with
   `PERMISSION_REVOKED`.
3. Disconnection does not create a block, notification, public event, account
   lookup, or new physical capability.
4. Reconnection requires one person to create a new ten-minute one-use code and
   the other person to accept it. Reactivate the relationship only in that
   acceptance transaction. Never restore either directional grant.
5. Store only the current active interval: reconnection resets `created_at` and
   clears `ended_at`. This is deliberate data minimization, not a relationship
   history.
6. Invitation rows become deletion-eligible 24 hours after use, invalidation, or
   expiry. Relationship mutations perform bounded opportunistic cleanup, and an
   operator-only cleanup command removes at most 500 eligible rows per run.
7. The cleanup command prints only the number of deleted rows. It does not print
   invitation, person, or relationship identifiers.

## Consequences

- One person can withdraw the relationship and both physical-action permissions
  immediately.
- Outstanding commands cannot survive the consent boundary that authorized
  them.
- Reconnection is explicit and private, while prior grants remain revoked.
- The service retains no accepter identity and no long-term invitation ledger.
- A periodic operator run is still required to enforce retention when the
  relationship endpoints receive no traffic.

## Rejected alternatives

- disconnecting only one directional grant;
- leaving already queued commands active;
- silently reconnecting on sign-in or contact-list state;
- restoring grants on reconnection;
- exposing whether an arbitrary person ID is connected; and
- retaining invitation metadata indefinitely for analytics.
