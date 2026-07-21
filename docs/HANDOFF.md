# Implementation Handoff

[日本語](HANDOFF.ja.md)

This document is the starting point for a new EJECT development session. It
records what is implemented, what has been verified, what remains unknown, and
the order in which work should continue.

## Snapshot

- **Date:** 2026-07-20
- **Repository:** `tnoborio/eject`
- **Current branch:** `main`
- **Merged PRs:** [#2](https://github.com/tnoborio/eject/pull/2) (Stage 0
  spike), [#3](https://github.com/tnoborio/eject/pull/3) (One Bit logo),
  [#4](https://github.com/tnoborio/eject/pull/4) (hardware validation kit),
  [#5](https://github.com/tnoborio/eject/pull/5) (protocol v1),
  [#6](https://github.com/tnoborio/eject/pull/6) (handoff refresh)
- **Current `main` base commit:** `93d035b8419058b0bd7e13d9b4e01fc90fff504e`
- **Verified CI on `main`:** [Windows spike run 29688104811](https://github.com/tnoborio/eject/actions/runs/29688104811),
  [protocol contract run 29688208249](https://github.com/tnoborio/eject/actions/runs/29688208249),
  [control-plane run 29802928858](https://github.com/tnoborio/eject/actions/runs/29802928858)
- **Current product phase:** Stage 0 awaits physical evidence; Stage 1 protocol
  v1 and control-plane architecture are accepted, and the control-plane domain
  skeleton is implemented without a public eject endpoint

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

The repository also includes a privacy-bounded Windows hardware
validation kit. It verifies the executable checksum, requires a deliberate
physical-safety confirmation, performs one attempt without retry, and records a
schema-constrained report containing the API result and human-observed outcome.
This kit has not yet run on a real Windows optical drive and does not complete
Stage 0 by itself.

Stage 1 protocol v1 is also implemented as a closed JSON Schema contract with a
reference validator, valid and invalid fixtures, eleven semantic tests, and a
dedicated CI workflow. It defines exact device audience, a maximum 60-second
lifetime, replay consumption, one-attempt reporting, and a factual lifecycle
that cannot claim `OPENED`.

The One Bit visual identity is adopted, with production assets and usage notes
in `assets/logo/` and the study preserved in `assets/logo-concepts/`.

Stage 1 control-plane deployment, module direction, pure authorization,
recipient-authored access, participation eligibility, one-time eject back, and
recipient-side subscription exposure are accepted in ADR 0003. The atomic
command-issuance transaction, `SERIALIZABLE` isolation, recipient row lock, and
bounded retry are also fixed. Person request, one-time eject-back, and agent-
result idempotency are fixed independently. Kysely and `node-postgres` are
selected for infrastructure repositories. Ordered, forward-only SQL migrations
with a checksum ledger are selected as the schema source of truth, and protocol
v1 is shared as a private workspace package used only by transport adapters.
The control-plane CI boundary is also accepted: blocking static and architecture
checks, pure and property
tests, a production build, and real-PostgreSQL integration and deterministic
concurrency tests, with scheduled advisory mutation testing. Exact schema,
migration tooling, authentication, device credentials, and billing
implementation remain undecided. The initial SQL schema, checksum migration
runner, PostgreSQL 17 migration tests, and four-job control-plane CI are
implemented. The Next.js shell, pure policy, application
issuance boundary, protocol transport mapper, locale resources, and blocking
local verification are implemented. No public eject endpoint exists.

Stage 0 itself is **not complete**. No real Windows computer with a tray-style
optical drive has run the executable yet. The project must not claim that it can
open a physical tray until that test evidence exists.

## What exists in the repository

```text
.github/workflows/windows-spike.yml
    Native Windows test, publish, smoke-test, checksum, and artifact workflow.

.github/workflows/protocol-contract.yml
    Locked Node.js install and protocol Schema/semantic tests.

control-plane/src/app/
    Localized Next.js shell with no remote action endpoint.

control-plane/src/modules/eject/
    Pure authorization, exposure, and lifecycle policy; application issuance
    boundary; and protocol-v1 transport mapper.

control-plane/test/
    Unit, property, application-boundary, and protocol-adapter tests.

protocol/v1/
    Closed command, agent-result, and lifecycle Schema; reference validator;
    fixtures; and paired English/Japanese contract documentation.

src/Eject.Agent.Core/
    Closed capability interface, drive capability, and bounded eject results.

src/Eject.Agent.Windows/
    Windows drive discovery, opaque identifiers, fixed Win32 eject adapter.

src/Eject.Agent.Cli/
    Non-networked JSON CLI with only `list` and `eject <opaque-id>`.

tests/Eject.Agent.Windows.Tests/
    Adapter containment, identity, native mapping, and selection tests.

scripts/build-windows-spike.sh
    Local tests, self-contained `win-x64` cross-publish, checksum, and validation
    kit assembly.

scripts/record-windows-hardware-test.ps1
    Checksum verification, one deliberate attempt, and privacy-bounded evidence
    capture with English and Japanese locale resources.

docs/schemas/stage-0-hardware-evidence.schema.json
    Closed schema for reviewed Stage 0 hardware evidence.

docs/STAGE-0-WINDOWS-SPIKE.md
    Build, operation, safety, and hardware-test instructions.

docs/decisions/0001-implementation-stack.md
    Accepted language, deployment, and architecture direction.

docs/decisions/0002-stage-1-protocol-v1.md
    Accepted expiry, audience, replay, result, lifecycle, and transport boundary.

docs/decisions/0003-control-plane-consent-and-exposure.md
    Accepted Stage 1 deployment, module, authorization, participation, access,
    eject-back, and recipient-side exposure boundaries.
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
8. On 2026-07-18, the current implementation passed all ten tests and reproduced
   the self-contained `win-x64` cross-publish on Linux ARM64 with .NET 10.
9. The local build assembled the executable, checksum, validation helper, both
   locale resources, and evidence schema; the generated executable checksum
   verified successfully.
10. PowerShell 7.6.3 parsed the validation helper, decoded both JSON locale
    resources as strict UTF-8, and found exact parity across all 22 keys.
11. A temporary Linux test copy, with only the Windows platform guard removed,
    completed the non-ejecting `-VerifyOnly` path in both locales against a
    zero-drive fake executable.
12. A separate temporary record-path simulation with a fake executable and a
    substituted privilege classification produced a report accepted by AJV in
    strict Draft 2020-12 mode. This synthetic report is not hardware evidence.
13. The same AJV validation rejected an added `computer_name` field, and
    `actionlint` 1.7.12 accepted the updated Windows workflow.
14. All eleven protocol tests pass on Node.js 22 with AJV 8.20.0, including closed
    payloads, exact audience, expiry, future skew, replay, local rejection,
    one-attempt result shape, and lifecycle transitions.
15. `actionlint` 1.7.12 accepts both the Windows and protocol workflows, and
    `npm ci --prefix protocol` reproduces the locked dependency graph with no
    reported audit vulnerabilities.
16. On 2026-07-19, the `windows-spike` workflow on `main` assembled the
    validation kit, completed the non-ejecting `-VerifyOnly` check on the
    Windows runner, and uploaded the full kit as the artifact
    ([run 29688104811](https://github.com/tnoborio/eject/actions/runs/29688104811)).
17. The `protocol-contract` workflow passed on `main`
    ([run 29688208249](https://github.com/tnoborio/eject/actions/runs/29688208249)),
    so all eleven protocol tests also have CI evidence.
18. The control-plane skeleton passes formatting, ESLint, strict TypeScript,
    dependency-cruiser, and a Next.js 16.2.10 production build on Node.js 22.
19. All 35 control-plane tests pass, including fast-check properties. Critical
    authorization, lifecycle, exposure, and idempotency code has 100% branch,
    function, line, and statement coverage.
20. The production dependency audit reports zero known vulnerabilities. The
    PostCSS 8.5.20 override removes the advisory present in Next.js's transitive
    default.
21. The control-plane workflow passed all four jobs on `main`: static and
    architecture, domain and protocol with 100% critical coverage, PostgreSQL 17
    migration tests, and the production build
    ([run 29802928858](https://github.com/tnoborio/eject/actions/runs/29802928858)).
22. Seven PostgreSQL tests pass locally, including atomic Kysely issuance,
    idempotent replay, rejection without command or quota use, migrations,
    checksum drift, safe defaults, and database constraints.

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
  `physical_outcome` remains `UNKNOWN`;
- protocol v1 accepts only `OPTICAL_DRIVE_EJECT` for one exact device audience;
- protocol payloads cannot carry a local drive path, executable instruction,
  localized sentence, or an `OPENED` physical outcome; and
- a consumed command may resend its stored result but may not cause another
  physical attempt.

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
- Protocol v1 has not yet been exercised between a real control plane and agent.
- The control-plane shell and domain exist, but account authentication,
  PostgreSQL issuance persistence is implemented; account authentication,
  device credential, and polling transport have not been implemented.
- The exact authentication provider, device credential, message-integrity
  construction, and revocation check remain security decisions.
- Protocol sharing and pure test boundaries are implemented. SQL migrations,
  PostgreSQL repositories, real-database race tests, mutation testing, and the
  control-plane CI workflow remain to be implemented.
- Subscription prices and inbound frequency ceilings cannot be set before
  physical hardware evidence establishes a defensible safety ceiling.
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
npm ci --prefix protocol
npm test --prefix protocol
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

## Required next work while hardware is unavailable

Physical validation remains a parallel requirement, but it is no longer the
only development queue. The initial SQL migration and blocking control-plane CI
and the Kysely issuance repository are implemented. The next software change
should prove deterministic transaction races against real PostgreSQL:

1. prove rollback, last-slot races, duplicate requests, revocation
   races, and retry behavior against ephemeral real PostgreSQL;
2. add scheduled advisory mutation testing; and
3. continue to expose no public eject or device-delivery endpoint.

The skeleton's pull requests must block on formatting, lint, TypeScript,
dependency rules, a Next.js production build, pure and property tests, and
integration and deterministic concurrency tests against an ephemeral real
PostgreSQL service. Critical pure policy surfaces require 100% branch coverage.
Scheduled mutation testing starts as advisory. Database mocks do not establish
transaction, locking, or constraint correctness.

Before authenticated polling or enrollment, record a focused decision covering
the person auth provider, per-device credential, protected local storage,
message integrity, revocation lookup, result idempotency, and clock handling.

## Hardware work when equipment becomes available

Run the validation kit as a standard user, review the privacy-bounded reports,
repeat the matrix in `STAGE-0-WINDOWS-SPIKE.md`, fix only evidence-backed adapter
problems, and document a narrow Windows capability contract. Stage 0 remains
incomplete until that contract is repeatable on real hardware.

## Planned PR sequence from this implementation

CI verification for both updated workflows is complete on `main` (see the
snapshot links). Keep subsequent changes small and reviewable:

1. **Control-plane PostgreSQL and CI** — checked-in SQL migrations, Kysely
   issuance repository, real-database race tests, and blocking workflow; no
   public endpoint or device enrollment.
2. **Identity and device-security ADR** — choose person authentication, device
   credential, protected storage, integrity, revocation, idempotency, and clock
   rules.
3. **Authenticated outbound polling** — implement issuance and result ingestion
   strictly against protocol v1.
4. **Windows enrollment and polling** — separate device credential in protected
   storage, local replay protection, one attempt, result report, and no inbound
   port.
5. **Hardware evidence in parallel** — add reviewed reports and any narrowly
   evidence-backed adapter corrections when equipment becomes available.

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
