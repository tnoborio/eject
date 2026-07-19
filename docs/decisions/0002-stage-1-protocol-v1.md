# ADR 0002: Stage 1 Protocol v1

[日本語](0002-stage-1-protocol-v1.ja.md)

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Physical Windows validation is waiting for test hardware. The control plane and
agent can still advance if they share a closed contract that preserves EJECT's
single capability, consent boundary, replay resistance, truthful outcomes, and
internationalization rules.

The protocol must not turn uncertainty about hardware into a generic remote
execution escape hatch. It must also distinguish a server writing a response
from an agent receiving a command and from a physical outcome.

## Decision

1. Define protocol v1 as a transport-independent JSON Schema Draft 2020-12
   contract under `protocol/v1`.
2. Accept exactly three closed message kinds: `COMMAND`, `AGENT_RESULT`, and
   `LIFECYCLE_EVENT`. Reject unknown fields and protocol versions.
3. Accept only `OPTICAL_DRIVE_EJECT`. Do not carry a local drive ID, device path,
   executable, shell text, IO control code, script, localized sentence, or
   executable URL.
4. Address one registered device by UUID. Commands have globally unique UUIDs,
   UTC timestamps with at most millisecond precision, a positive lifetime of at
   most 60 seconds, and at most 30 seconds of future-issued clock skew.
5. Consume and durably persist an intended command ID before or atomically with
   the local attempt. Retry stored result delivery, never the physical action.
   Retain consumed IDs across restarts for at least 24 hours.
6. Report zero attempts for rejection or exactly one local attempt. Protocol v1
   fixes attempted physical outcomes to `UNKNOWN` and contains no `OPENED`
   lifecycle state.
7. Treat `DISPATCHED` as response placement and `DELIVERED` as agent-proven
   receipt. Preserve bounded reasons for server rejection, local rejection,
   cancellation, local failure, expiry, and unknown physical outcome.
8. Carry the actor display name only as an escaped semantic variable. Render
   notification text from recipient-owned locale resources.
9. Require authenticated encrypted outbound transport, while deferring the
   exact device credential and message-integrity construction to a focused
   security decision before enrollment is complete.

## Consequences

- The control plane, Windows polling agent, and future web UI can share lifecycle
  semantics before a transport endpoint or authentication provider is chosen.
- Schema validation alone is insufficient for timestamp ordering, maximum
  lifetime, audience, replay, and transition checks; the reference validator and
  tests define those additional requirements.
- A result upload may be idempotently retried after a crash or network failure
  without another mechanical attempt.
- Protocol v1 can honestly demonstrate a two-person request and response while
  physical outcome remains unknown.
- Any future physical-success claim or new command capability requires an
  explicit protocol version and evidence-backed decision.
