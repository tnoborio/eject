# Implementation Handoff

[日本語](HANDOFF.ja.md)

This document is the starting point for a new EJECT development session. It
records what is implemented, what has been verified, what remains unknown, and
the order in which work should continue.

## Snapshot

- **Date:** 2026-07-18
- **Repository:** `tnoborio/eject`
- **Current branch:** `main`
- **Merged implementation PR:** [#1](https://github.com/tnoborio/eject/pull/1)
- **Merge commit:** `b6bea9dab8d3538cc4140a95c400a1aa6e00e55a`
- **Verified Windows build:** [Actions run 29628427491](https://github.com/tnoborio/eject/actions/runs/29628427491)
- **Current product phase:** Stage 0 software spike implemented; physical
  hardware truth not yet established

## Executive status

The repository now produces an unsigned, self-contained Windows x64 console
application that discovers local optical drives and makes one fixed eject
attempt against a locally selected opaque drive identifier.

The following work is complete:

- the initial implementation-stack decision;
- the .NET 10 solution and capability-contained adapter boundary;
- optical-drive discovery without reading disc contents;
- opaque local drive identifiers instead of caller-supplied device paths;
- one fixed `IOCTL_STORAGE_EJECT_MEDIA` operation;
- bounded semantic result codes;
- ten platform-neutral unit tests;
- Linux-to-Windows cross-publishing;
- a native GitHub-hosted Windows build and discovery smoke test;
- downloadable workflow artifacts containing the executable and checksum; and
- paired English and Japanese Stage 0 documentation.

Stage 0 itself is **not complete**. No real Windows computer with a tray-style
optical drive has run the executable yet. The project must not claim that it can
open a physical tray until that test evidence exists.

## What exists in the repository

```text
.github/workflows/windows-spike.yml
    Native Windows test, publish, smoke-test, checksum, and artifact workflow.

src/Eject.Agent.Core/
    Closed capability interface, drive capability, and bounded eject results.

src/Eject.Agent.Windows/
    Windows drive discovery, opaque identifiers, fixed Win32 eject adapter.

src/Eject.Agent.Cli/
    Non-networked JSON CLI with only `list` and `eject <opaque-id>`.

tests/Eject.Agent.Windows.Tests/
    Adapter containment, identity, native mapping, and selection tests.

scripts/build-windows-spike.sh
    Local tests and self-contained `win-x64` cross-publish.

docs/STAGE-0-WINDOWS-SPIKE.md
    Build, operation, safety, and hardware-test instructions.

docs/decisions/0001-implementation-stack.md
    Accepted language, deployment, and architecture direction.
```

English documents are canonical. Update the corresponding `.ja.md` file in the
same change whenever meaning changes.

## Verified behavior

The following facts have direct build or test evidence:

1. .NET 10 builds the solution on Linux ARM64.
2. All ten unit tests pass on Linux and on GitHub's Windows runner.
3. Linux can cross-publish a self-contained Windows x64 PE executable.
4. GitHub Actions can publish the same application on `windows-2025`.
5. The application starts on the Windows runner and completes drive discovery.
6. The workflow uploads `eject-agent.exe` and
   `eject-agent.exe.sha256` as `eject-windows-x64` for 14 days.
7. The artifact downloaded from the verified `main` run passed SHA-256
   verification and was identified as a Windows x64 PE executable.

The verified `main` artifact had this checksum:

```text
d80c7f609a8aa36c332f0d2564c9ea869d56837ddfcf86698719cdc3b6406729
```

Artifacts expire and later builds have different checksums. Treat the checksum
file downloaded with each artifact as authoritative for that build.

## Deliberate safety boundaries

These properties are part of the implementation contract and must remain true:

- the executable has no network capability;
- there is no shell, process runner, script runner, plug-in system, or generic
  remote command;
- callers cannot provide a drive path or IO control code;
- `eject` accepts only an opaque identifier resolved against a fresh local
  optical-drive discovery;
- the adapter issues one fixed eject operation once and has no retry loop;
- the code does not read disc labels, file names, contents, or media metadata;
- there is no tray-close operation; and
- a successful Windows API call is `COMMAND_ACCEPTED`, while
  `physical_outcome` remains `UNKNOWN`.

Do not loosen one of these boundaries as a workaround for unsupported hardware.
Record the failure and narrow the supported capability contract instead.

## Known limitations and unknowns

- The code has not run against a physical optical drive.
- Standard-user access to the device handle is unverified.
- Empty, inserted, busy, disconnected, USB, SATA, multiple-drive, and trayless
  cases are unverified.
- Windows API success has not been correlated with visible tray movement.
- The opaque drive identifier is derived from the current drive root. It is
  suitable for this local spike but is not a permanent hardware identity and
  can change when Windows reassigns drive letters.
- The executable has no UI, installer, code signature, update channel, device
  credential, or server connection.
- The control plane, web client, account authentication, PostgreSQL schema, and
  realtime transport have not been implemented.
- macOS remains experimental and must not be started before Windows hardware
  truth is established.

## Start a new development session

Read these files before changing product behavior:

1. `PRINCIPLES.md`
2. `docs/SECURITY.md`
3. `docs/I18N.md`
4. `docs/ROADMAP.md`
5. `docs/ARCHITECTURE.md`
6. this handoff

Then synchronize and verify the checkout:

```sh
git switch main
git pull --ff-only origin main
dotnet test Eject.slnx --configuration Release
```

The repository selects .NET 10 through `global.json`. If `dotnet` is not
installed, install a supported .NET 10 SDK before continuing.

To reproduce the Windows cross-build:

```sh
./scripts/build-windows-spike.sh
```

To request a native Windows build and download it:

```sh
gh workflow run windows-spike.yml
gh run list --workflow windows-spike.yml --limit 1
gh run watch RUN_ID
gh run download RUN_ID --name eject-windows-x64 --dir artifacts/github-actions
```

## Required next work: close Stage 0

The next session should prioritize real hardware, not the server control plane.

1. Obtain a Windows 10 or Windows 11 computer and at least one tray-style
   optical drive.
2. Download a fresh GitHub Actions artifact and verify its checksum.
3. Run `eject-agent.exe list` as a standard user.
4. Keep the tray area clear and run one eject attempt using a returned opaque
   identifier.
5. Record Windows version, privilege, drive model, connection type, media state,
   semantic result, native error code, and observed tray movement.
6. Repeat the matrix in `STAGE-0-WINDOWS-SPIKE.md` without adding automatic
   retries.
7. Fix only evidence-backed adapter problems, preserving the closed capability.
8. Document a narrow Windows capability contract in English and Japanese.

The Stage 0 exit condition is met only when this contract is repeatable on real
hardware without arbitrary command execution.

## Planned PR sequence after hardware evidence

Keep subsequent changes small and reviewable:

1. **Hardware evidence and capability contract** — add the real test matrix,
   supported cases, unsupported cases, and truthful outcome definition.
2. **Adapter corrections** — only if the evidence identifies a specific Windows
   API or identity problem; include tests and update both languages.
3. **Stage 0 completion record** — update the roadmap status without implying
   broader hardware support.
4. **Stage 1 protocol contract** — define machine-readable command, lifecycle,
   expiry, audience, uniqueness, and bounded result schemas; no localized text
   or device path in payloads.
5. **Stage 1 control-plane skeleton** — Next.js/TypeScript modular monolith,
   managed PostgreSQL/auth, directional permission, cooldown, pause, revoke,
   and authenticated outbound polling.
6. **Windows enrollment and polling** — separate device credential in protected
   storage, local replay protection, one attempt, result report, and no inbound
   port.

The authentication provider and precise cryptographic scheme need a focused
security decision before Stage 1 enrollment is considered complete.

## Completion criteria for the next handoff

A future session should leave behind:

- a focused PR with tests and paired English/Japanese meaning changes;
- links to relevant Actions runs;
- explicit evidence for what was verified;
- an updated list of unresolved physical or security questions;
- no credentials, signing material, device tokens, or private event logs; and
- this handoff updated if the current phase or next recommended action changes.
