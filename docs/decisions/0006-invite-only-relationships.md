# ADR 0006: Invite-Only Relationship Establishment

[日本語](0006-invite-only-relationships.ja.md)

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

Stage 1 needs two existing EJECT accounts to establish a private relationship
before either recipient can grant directional EJECT access. Public account
search, address-book upload, email discovery, and automatic reciprocal
permission would add surveillance and social-network surface that the product
does not need.

A relationship is not consent to a physical action. The establishment
mechanism must preserve that separation and must not enable delivery, create a
device capability, or imply that either person can eject the other.

## Decision

1. A signed-in existing account may create one short-lived, one-use
   relationship code. The service does not send the code; the person shares it
   deliberately through a channel they already control.
2. Generate the code from 32 cryptographically random bytes and render it as a
   43-character unpadded base64url value. Show it once and expire it after ten
   minutes.
3. Store only a SHA-256 digest, inviter identifier, bounded timestamps, and
   use/invalidation state. Creating a new code invalidates that inviter's prior
   unused code.
4. Only another currently authenticated, active EJECT account may consume the
   code. Self-use, unknown, malformed, expired, invalidated, used, restricted,
   and otherwise unavailable codes return the same bounded unavailable result.
5. Accepting a code creates only one private, mutual `relationship` row. It
   does not create an `eject_grant`, broaden audience scope, enable delivery,
   enroll a device, expose account search, or make either person discoverable.
   Each recipient must grant EJECT access separately.
6. Run creation and acceptance in short PostgreSQL `SERIALIZABLE`
   transactions with bounded retries. Acceptance locks the invitation and both
   account rows in deterministic order. Exactly one accepter can consume a
   code.
7. If the pair already has an active relationship, consume the code
   idempotently without changing grants. Do not use this path to reactivate an
   inactive relationship; reconnection and disconnection require a separate
   reviewed decision with cancellation behavior.
8. Do not log codes, raw request bodies, email addresses, or relationship
   contents. Define invitation-row retention and deletion before private alpha.

## Consequences

- Two invited accounts can connect without a global directory or another
  identity provider lookup.
- Possession of a code can create only a relationship, not physical agency.
- The code is a bearer capability and must remain high entropy, short-lived,
  one-use, and absent from URLs and logs.
- Relationship establishment remains visibly separate from directional consent
  in the UI and data model.
- Account invitation into EJECT itself remains an operator-controlled process;
  this decision connects existing accounts only.

## Rejected alternatives

- searching by email address, display name, or public username;
- sending invitations from the control plane;
- creating an account when a code is consumed;
- automatically granting reciprocal EJECT access;
- putting the code in a URL or storing its plaintext value; and
- reactivating an inactive relationship without an explicit disconnect and
  cancellation design.
