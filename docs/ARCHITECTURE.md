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

- authenticates as one registered device;
- maintains an outbound secure connection or polling channel;
- discovers compatible optical drives locally;
- lets the owner approve a drive;
- validates command integrity, audience, expiry, and uniqueness;
- maps only the approved product operation to a platform adapter;
- reports a bounded result code;
- shows a localized native notification and local pause control.

### Platform adapter

The platform adapter exposes a deliberately tiny internal interface:

```text
discover_optical_drives() -> DriveCapability[]
eject(approved_drive_id) -> EjectResult
```

It does not expose a generic command runner, arbitrary device path, file access,
disc reading, or arbitrary DeviceIoControl/IOKit invocation.

## Command lifecycle

```text
requested
  -> rejected | authorized
  -> queued
  -> delivered
  -> accepted_by_agent | expired
  -> executed
  -> opened | failed | unknown
```

Each transition has a timestamp and machine-readable reason code. The UI may say
“tray opened” only after the local adapter reports a successful outcome. If the
hardware cannot confirm physical movement, the result must remain appropriately
qualified rather than upgraded optimistically.

## Illustrative command envelope

```json
{
  "command_id": "opaque-unique-id",
  "type": "OPTICAL_DRIVE_EJECT",
  "device_id": "registered-device-id",
  "issued_at": "RFC3339 timestamp",
  "expires_at": "RFC3339 timestamp",
  "actor": {
    "id": "person-id",
    "display_name": "Kaz"
  }
}
```

The server does not send a drive path, shell text, executable name, or localized
message. The agent resolves the one approved local drive and localizes the actor
event on the recipient's machine.

## Minimum data model

- `person`: identity, display name, locale, account status;
- `relationship`: two people and relationship state;
- `eject_permission`: grantor, grantee, policy, status;
- `device`: owner, public key or credential reference, platform, last-seen class;
- `drive_capability`: opaque local binding and coarse capability status;
- `eject_event`: actor, recipient, device, lifecycle state, bounded reason code;
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
