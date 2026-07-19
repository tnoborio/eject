# EJECT Protocol v1

[日本語](README.ja.md)

This directory defines the transport-independent semantic contract between the
EJECT control plane and a Windows agent. The JSON Schema is canonical for wire
shape. This document defines cross-field checks and state transitions that JSON
Schema alone cannot express.

Stage 0 hardware behavior remains unverified. Protocol v1 therefore allows an
agent to report one fixed attempt, but never allows it to claim that the tray
physically opened.

## Messages

`eject-protocol.schema.json` accepts exactly three message kinds:

- `COMMAND`: one short-lived `OPTICAL_DRIVE_EJECT` instruction for one device;
- `AGENT_RESULT`: a bounded rejection or the result of exactly one local
  attempt; and
- `LIFECYCLE_EVENT`: a factual control-plane state transition with a bounded
  reason code.

Every object is closed with `additionalProperties: false`. An unknown command
type, drive path, executable name, shell text, localized sentence, physical
success claim, or any other extra field is invalid.

## Command contract

A command carries:

- protocol version `1` and kind `COMMAND`;
- one globally unique canonical lowercase UUID command ID;
- the single type `OPTICAL_DRIVE_EJECT`;
- the canonical lowercase UUID of the intended registered device;
- the actor's UUID and display name as semantic notification variables; and
- UTC `issued_at` and `expires_at` timestamps with at most millisecond precision.

The command never carries the approved local drive ID. The agent resolves its
locally approved binding only after validating the message.

The server must issue a command with a positive lifetime of at most 60 seconds.
The agent rejects a command when its local time is at or after `expires_at`, or
when `issued_at` is more than 30 seconds in the future. This clock-skew allowance
does not extend `expires_at`.

## Audience, uniqueness, and one attempt

The agent validates in this order:

1. closed Schema and protocol version;
2. exact device audience;
3. timestamp ordering, maximum lifetime, expiry, and future skew;
4. command ID uniqueness;
5. local pause and approved-drive state; and
6. the one fixed optical-drive eject capability.

For a structurally valid, current command addressed to this device, the agent
durably records the command ID and its eventual result before or atomically with
starting the physical attempt. Paused and no-approved-drive rejections also
consume the ID. A crash or result-upload failure may retry delivery of the same
stored `AGENT_RESULT`; it must never call the adapter a second time.

The server also treats `command_id` as an idempotency key and never reuses it.
The production replay store must survive agent restarts and retain consumed IDs
for at least 24 hours, well beyond the protocol's maximum command lifetime.

## Agent result

A rejected command reports:

- `disposition: REJECTED`;
- `attempt_count: 0`;
- one bounded rejection reason; and
- `physical_outcome: NOT_ATTEMPTED`.

A local attempt reports:

- `disposition: ATTEMPTED`;
- `attempt_count: 1`;
- one bounded adapter result; and
- `physical_outcome: UNKNOWN`.

`COMMAND_ACCEPTED` means only that the fixed Windows call returned success. It
does not permit `OPENED`. Native error numbers remain local diagnostics and are
not part of protocol v1.

The control plane accepts a result only when `command_id` belongs to the
authenticated `device_id`, then upserts it idempotently. `recorded_at` is a
device observation timestamp, not authority to extend expiry or reorder
server-owned lifecycle events; server receipt time remains the audit boundary.

## Lifecycle

`DISPATCHED` means the control plane placed a command in an outbound response.
It is not delivery proof. `DELIVERED` is recorded only when an authenticated
agent report proves that the agent received the command.

```text
REQUESTED
  -> REJECTED | AUTHORIZED
AUTHORIZED
  -> QUEUED | CANCELLED
QUEUED
  -> DISPATCHED | EXPIRED | CANCELLED
DISPATCHED
  -> DISPATCHED | DELIVERED | EXPIRED | CANCELLED
DELIVERED
  -> REJECTED_BY_AGENT | ATTEMPTED
ATTEMPTED
  -> FAILED | OUTCOME_UNKNOWN
```

Terminal states have no outgoing transition. Protocol v1 has no `OPENED`
state. A future version may add one only after a defined hardware class can
provide trustworthy local evidence of physical movement.

Lifecycle event timestamps are control-plane generated and must not move
backward for one command. Agent-provided timestamps are stored separately from
these authoritative transition times.

## Transport and integrity boundary

The Schema contains no credential, executable URL, or transport instruction.
Messages must use an authenticated encrypted outbound connection initiated by
the agent. The agent must bind the authenticated control-plane identity and its
own device credential to the `device_id` audience check.

The exact device credential, message-integrity construction, revocation check,
and polling endpoint are deliberately deferred to a focused security decision.
They must be settled before enrollment is considered complete; adding arbitrary
payload fields to this Schema is not a substitute.

## Internationalization and privacy

The actor display name is a semantic variable, not a prewritten sentence. The
recipient agent escapes it and renders a locale-resource key locally. No sender
chooses the recipient's language.

Protocol payloads exclude media names, disc contents, device paths, hardware
inventory, computer names, native error numbers, and free-form notes. Raw
payloads must not be written to ordinary logs.

## Validation

From the repository root:

```sh
npm ci --prefix protocol
npm test --prefix protocol
```

The tests validate accepted and rejected fixtures, exact device audience,
60-second lifetime, future skew, replay consumption, pause and drive approval,
one-attempt reporting, and lifecycle transitions.
