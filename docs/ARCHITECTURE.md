# Architecture Direction

[日本語](ARCHITECTURE.ja.md)

This document defines boundaries and invariants, not a final technology stack.
Implementation choices should remain replaceable without weakening consent,
minimal capability, truthful outcomes, or internationalization.

## System shape

```text
Sender's web client
        |
        | authenticated eject request
        v
EJECT control plane
  - identity and relationships
  - recipient permissions
  - cooldowns and quiet hours
  - command issuance
        |
        | short-lived, one-time command
        v
Outbound connection from recipient's desktop agent
        |
        | platform adapter
        v
Locally approved optical drive
```

The desktop agent initiates the connection. It must not open an inbound network
port or require router configuration.

## Stage 1 control-plane shape

Stage 1 uses one TypeScript and Next.js modular monolith on the Vercel Node.js
runtime. The web UI, person-facing HTTP, and future agent-facing HTTP share one
deployment initially, but they do not share arbitrary implementation access.

```text
Next.js transport and UI
        |
        v
Application use cases
        |
        v
Framework-independent domain
        ^
        |
Infrastructure implements application-owned ports
```

Code is grouped by product capability before technical layer: `identity`,
`permissions`, `devices`, `eject`, and a deferred `entitlements` boundary.
Domain code does not depend on Next.js, React, Vercel, PostgreSQL, an ORM, or
protocol wire objects. A composition root connects infrastructure to
application ports.

The accepted consent, participation, and exposure boundaries are recorded in
[ADR 0003](decisions/0003-control-plane-consent-and-exposure.md). Ordered,
forward-only SQL files under `control-plane/migrations` are the schema source of
truth. A checksum ledger and PostgreSQL advisory lock make migration application
reproducible and serialized. Runtime repositories use Kysely and
`node-postgres`, contained within infrastructure. See
[ADR 0004](decisions/0004-control-plane-schema-and-contract-sharing.md).
Person identity uses Supabase Auth, while each Windows device has a separate
non-exportable CNG ECDSA P-256 key. Authenticated outbound requests and signed
server responses bind exact body bytes and replay-resistant nonces. See
[ADR 0005](decisions/0005-identity-and-device-security.md).
Existing accounts establish private relationships through digest-only,
ten-minute, one-use codes that never create directional permission or account
search. See [ADR 0006](decisions/0006-invite-only-relationships.md).

The Windows adapter implements that device-key boundary as a persistent,
current-user CNG ECDSA P-256 key. It prefers Microsoft Platform Crypto Provider
and falls back only to Microsoft Software Key Storage Provider, requests signing
usage with no export policy, rejects machine-scoped or otherwise nonconforming
stored keys, exports only DER SubjectPublicKeyInfo, and emits fixed 64-byte IEEE
P1363 signatures. The adapter is not yet wired to enrollment or polling, and
hosted Windows CI does not replace standard-user validation on real hardware.

The server-owned person-auth boundary contains fixed routes for existing-user
email magic-link initiation, PKCE callback exchange, email OTP verification,
refresh rotation, and local-session logout. It generates S256 verifier and state
cookies, keeps access and refresh material in separate Secure, HttpOnly,
SameSite cookies, rejects arbitrary redirect targets, and re-verifies every
provider-issued access JWT before installing it. Person auth is independently
disabled by default before provider configuration is initialized.

The control plane now contains fixed Node.js POST routes for agent enrollment,
polling, and results, plus person-authenticated device-enrollment creation and
revocation. It also has owner-bound recipient-consent reads and mutations for
pause and directional grants to existing active relationships. Pausing or
revoking a grant serializes on the same recipient lock as issuance and
atomically cancels affected `QUEUED` or unconfirmed `DISPATCHED` commands.
Separate authenticated routes create and consume one-use relationship codes;
they create only the relationship and keep accounts unsearchable.
Enrollment creation is independently disabled by default before database or
person-auth initialization. Poll and result delivery retains its separate
environment gate, and the independent database global-delivery gate must also
be true before a command can be returned. There is no person-facing public
eject endpoint, and no Windows agent is connected yet.

Protocol v1 remains canonical under `protocol/v1` and is consumed as the
private workspace package `@eject/protocol-contract`. Only transport adapters
import its validator or schema. Validated wire values cross an explicit mapper;
application and domain code never import protocol wire objects.

## Control-plane verification

Control-plane changes pass four blocking CI layers before merge:

1. formatting, lint, TypeScript, dependency-direction rules, and a production
   Next.js build;
2. Vitest unit tests and fast-check property tests for pure policy;
3. migration and repository integration tests against ephemeral real
   PostgreSQL; and
4. deterministic, barrier-coordinated multi-connection tests for transaction
   races and idempotency.

Critical pure authorization, lifecycle, exposure, fingerprint, and eject-back
logic requires 100% branch coverage. Repository-wide coverage is not a goal by
itself. Scheduled mutation testing challenges these critical tests but begins
as advisory rather than a pull-request blocker. Persistence, locking, and
constraint guarantees are never accepted from database mocks alone.

Dependency rules prohibit domain imports of Next.js, React, Kysely, `pg`,
infrastructure, and protocol wire types; application code cannot import
transport or infrastructure implementations. CI uses synthetic data, minimum
permissions, full-SHA-pinned Actions, and no production credentials. See
[ADR 0003](decisions/0003-control-plane-consent-and-exposure.md).

## Components

### Web client

- account creation and authentication;
- invitations and relationships;
- permission management;
- availability at a privacy-preserving level;
- one EJECT action and reciprocal EJECT BACK;
- localized request and result states.

### Control plane

- authenticates people and registered devices;
- evaluates recipient-controlled policy;
- enforces cooldowns and anti-abuse limits;
- creates signed or otherwise integrity-protected, short-lived commands;
- routes commands to the intended device;
- records minimal state transitions and outcomes;
- emits machine-readable event codes, not English sentences.

### Desktop agent

- authenticates as one registered device with a protected per-device key, never
  a person session;
- maintains an outbound secure connection or polling channel;
- discovers compatible optical drives locally;
- lets the owner approve a drive;
- validates command integrity, audience, expiry, and uniqueness;
- maps only the approved product operation to a platform adapter;
- reports a bounded result code;
- shows a localized native notification and local pause control.

The agent signs each fixed-path HTTPS request with a timestamp, random nonce,
and exact body hash. It verifies a response signature bound to that request
before parsing the closed transport wrapper and protocol-v1 message. PostgreSQL
checks device and key revocation on every request and consumes replay nonces for
a bounded period. These authentication steps do not broaden the adapter's one
physical capability.

### Platform adapter

The platform adapter exposes a deliberately tiny internal interface:

```text
discover_optical_drives() -> DriveCapability[]
eject(approved_drive_id) -> EjectResult
```

It does not expose a generic command runner, arbitrary device path, file access,
disc reading, or arbitrary DeviceIoControl/IOKit invocation.

## Authorization and recipient exposure

A pure domain policy evaluates a request from current facts supplied by an
application use case. It considers account restrictions, the recipient's
audience and sender-eligibility settings, relationship and directional grant
where required, block, pause, quiet hours, cooldown, limits, device eligibility,
and revocation. Request-time denial is separate from cancellation of a command
that was already authorized.

Recipient access has two independent axes:

```text
audience: NAMED | CONNECTED | ALL_AUTHENTICATED
sender eligibility: READY_PARTICIPANTS_ONLY | AUTHENTICATED_ACCOUNTS
```

The default is named, ready participants. Anonymous actors are never included.
Discoverability is separate from permission to eject. A block or safety control
always overrides a broad scope.

A future subscription may raise only the inbound exposure ceiling that a
recipient is allowed to select. It does not grant a sender more power. The
effective inbound limit is the minimum of the recipient-selected limit, plan
entitlement, and evidence-backed physical safety ceiling. Billing vendors stay
behind an entitlement port and are outside Stage 1 domain-skeleton scope.

## Command lifecycle

Protocol v1 uses the following factual lifecycle. The canonical wire shape and
cross-field rules are in `protocol/v1/README.md`.

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

`DISPATCHED` means only that the server placed a command in a response.
`DELIVERED` requires an authenticated agent report. Each transition has a
timestamp and machine-readable reason code. Protocol v1 has no `OPENED` state;
its attempted physical outcome is always `UNKNOWN` until hardware can provide
trustworthy evidence of movement.

## Illustrative command envelope

```json
{
  "protocol_version": 1,
  "kind": "COMMAND",
  "command_id": "018f47a0-7b2c-7c9d-8e1f-0123456789ab",
  "type": "OPTICAL_DRIVE_EJECT",
  "device_id": "018f47a0-7b2c-7c9d-8e1f-1123456789ab",
  "actor": {
    "person_id": "018f47a0-7b2c-7c9d-8e1f-2123456789ab",
    "display_name": "Kaz"
  },
  "issued_at": "2026-07-18T05:00:00Z",
  "expires_at": "2026-07-18T05:00:30Z"
}
```

The server does not send a drive path, shell text, executable name, or localized
message. The agent resolves the one approved local drive and localizes the actor
event on the recipient's machine.

## Minimum data model

- `person`: identity, display name, locale, account status;
- `relationship`: two people and relationship state;
- `eject_permission`: grantor, grantee, policy, status;
- `participation`: coarse account-only, setup, ready, or revoked eligibility;
- `recipient_access_policy`: audience, sender eligibility, pause, and limits;
- `device`: owner, public key or credential reference, platform, last-seen class;
- `drive_capability`: opaque local binding and coarse capability status;
- `eject_event`: actor, recipient, device, lifecycle state, bounded reason code;
- `entitlement`: replaceable reference to the recipient's inbound ceiling;
- `revocation`: revoked device or credential and effective time.

Do not store media names, disc contents, file lists, arbitrary hardware
inventories, IP history beyond operational necessity, or room-level context.

## Windows direction

Windows is the first implementation target. The native adapter should enumerate
optical drives, bind a locally approved drive to an opaque identifier, and use a
supported device-control operation such as `IOCTL_STORAGE_EJECT_MEDIA` where the
hardware supports it.

The first hardware spike must test empty trays, inserted media, busy media,
multiple drives, internal SATA drives, external USB drives, trayless drives, and
standard-user execution. Results determine the precise capability contract.

The public app should eventually be code-signed and distributed through a
trustworthy installer with an explicit startup preference and clean uninstall.

## macOS direction

macOS is an experimental secondary adapter. Disk Arbitration provides
`DADiskEject`, but an API-level eject does not guarantee the visible tray motion
that defines EJECT. Modern Macs also typically use external, often slot-loading,
optical drives.

Before claiming macOS support, test:

- a tray-style external optical drive;
- an empty drive as well as inserted media;
- Disk Arbitration and any optical-drive-specific path required for empty-tray
  behavior;
- app sandbox, permission, signing, and notarization constraints;
- the difference between logical media ejection and physical tray opening.

The shared protocol must support macOS without making the first Windows agent a
premature cross-platform abstraction.

## Technology selection criteria

When implementation begins, prefer choices that provide:

- reliable native device APIs;
- a small auditable agent binary;
- straightforward code signing and updates;
- mature internationalization;
- typed protocol contracts and bounded error codes;
- simple deployment for a low-volume private alpha;
- the ability to replace the realtime transport without changing product
  semantics.

Framework popularity alone is not an architectural requirement.
