# Implementation Handoff

[日本語](HANDOFF.ja.md)

This document is the starting point for a new EJECT development session. It
records what is implemented, what has been verified, what remains unknown, and
the order in which work should continue.

## Snapshot

- **Date:** 2026-07-22
- **Repository:** `tnoborio/eject`
- **Current branch:** `main`
- **Merged PRs:** [#2](https://github.com/tnoborio/eject/pull/2) (Stage 0
  spike), [#3](https://github.com/tnoborio/eject/pull/3) (One Bit logo),
  [#4](https://github.com/tnoborio/eject/pull/4) (hardware validation kit),
  [#5](https://github.com/tnoborio/eject/pull/5) (protocol v1),
  [#6](https://github.com/tnoborio/eject/pull/6) (handoff refresh),
  [#7](https://github.com/tnoborio/eject/pull/7) (Kysely issuance),
  [#8](https://github.com/tnoborio/eject/pull/8) (PostgreSQL races),
  [#9](https://github.com/tnoborio/eject/pull/9) (mutation testing),
  [#10](https://github.com/tnoborio/eject/pull/10) (identity/device security),
  [#11](https://github.com/tnoborio/eject/pull/11) (authenticated agent
  polling), [#12](https://github.com/tnoborio/eject/pull/12) (cloud database
  environment), [#13](https://github.com/tnoborio/eject/pull/13) (person-session
  authentication), [#14](https://github.com/tnoborio/eject/pull/14) (device
  enrollment and revocation), [#15](https://github.com/tnoborio/eject/pull/15)
  (protected migration evidence), and
  [#16](https://github.com/tnoborio/eject/pull/16) (person PKCE sessions)
- **Current verified implementation:** PR #16 on `main`; all three repository
  migrations are applied and checksum-verified in the protected cloud database
- **Verified CI on `main`:** [Windows spike run 29688104811](https://github.com/tnoborio/eject/actions/runs/29688104811),
  [protocol contract run 29688208249](https://github.com/tnoborio/eject/actions/runs/29688208249),
  [control-plane run 29813234824](https://github.com/tnoborio/eject/actions/runs/29813234824)
- **Verified CI for PR #12:** [control-plane run 29839496511](https://github.com/tnoborio/eject/actions/runs/29839496511)
- **Verified CI for PR #13:** [control-plane run 29895265935](https://github.com/tnoborio/eject/actions/runs/29895265935),
  [protocol run 29895265928](https://github.com/tnoborio/eject/actions/runs/29895265928)
- **Verified CI for PR #14:** [control-plane run 29896627535](https://github.com/tnoborio/eject/actions/runs/29896627535)
- **Verified CI for PR #16:** [control-plane run 29898326094](https://github.com/tnoborio/eject/actions/runs/29898326094)
- **Current product phase:** Stage 0 awaits physical evidence; Stage 1 protocol,
  control-plane, and identity/device-security architecture are accepted. The
  control plane is implemented through authenticated agent polling and result
  ingestion. The person-session boundary now verifies Supabase asymmetric JWTs
  and rechecks current EJECT account status. Default-disabled one-use device
  enrollment and owner revocation are implemented on `main`, together with a
  default-disabled server-owned PKCE cookie lifecycle. A dedicated managed
  PostgreSQL environment and Vercel project exist under Sasara
  operational ownership, but delivery is disabled at every gate and no Windows
  agent is connected.

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
concurrency tests, with scheduled advisory mutation testing. The initial SQL
schema, checksum migration runner, Kysely issuance repository, deterministic
PostgreSQL 17 race tests, four-job control-plane CI, and scheduled Stryker
workflow are implemented. The Next.js shell, pure policy, application issuance
boundary, protocol transport mapper, locale resources, and blocking local
verification are implemented. ADR 0005 now selects Supabase Auth, per-device
non-exportable Windows CNG ECDSA P-256 keys, signed request and response
constructions, replay and revocation checks, result idempotency, and clock
rules. No public eject endpoint exists. The authenticated poll and result
routes, device key and nonce checks, signed responses, result idempotency, and
fail-closed environment and database delivery gates are now implemented. The
person-session adapter accepts identity only from a Supabase JWT with an exact
issuer and audience, valid expiry, and UUID subject, then rechecks the current
EJECT account status. The repository includes the server side of the
ten-minute, one-use enrollment ceremony and idempotent owner revocation. It
stores only enrollment-secret digests, accepts only canonical P-256
SubjectPublicKeyInfo, keeps enrollment creation disabled by default, and
atomically revokes device keys and undelivered commands. Live Supabase sign-in,
standard-user Windows CNG evidence, and Windows polling remain incomplete. Fixed
existing-user magic-link, PKCE callback, email OTP, refresh, and local-logout
routes are implemented with S256 state binding and separate host-only cookies;
provider configuration and UI remain absent.
The EJECT-specific Supabase PostgreSQL 17 project is provisioned in Tokyo with
SSL enforcement, all three migrations, zero application rows, and delivery
disabled.
The `sasara/eject` Vercel project is connected to GitHub, runs Next.js on Node.js
22 in Tokyo, with production-only protected database access and no database
credential in Preview.

Stage 0 itself is **not complete**. No real Windows computer with a tray-style
optical drive has run the executable yet. The project must not claim that it can
open a physical tray until that test evidence exists.

## What exists in the repository

```text
.github/workflows/windows-spike.yml
    Native Windows test, publish, smoke-test, checksum, and artifact workflow.

.github/workflows/protocol-contract.yml
    Locked Node.js install and protocol Schema/semantic tests.

.github/workflows/control-plane.yml
    Four blocking control-plane verification jobs with PostgreSQL 17.

.github/workflows/control-plane-mutation.yml
    Weekly and manually dispatchable advisory Stryker mutation testing.

control-plane/src/app/
    Localized Next.js shell with no remote action endpoint.

control-plane/src/modules/eject/
    Pure authorization, exposure, and lifecycle policy; application issuance
    and agent result boundaries; PostgreSQL issuance and agent-transport stores;
    and protocol-v1 transport mappers.

control-plane/src/modules/devices/
    Device request authentication and enrollment ports, Node P-256 crypto,
    bounded HTTP parsing, PostgreSQL enrollment/revocation, and signed
    poll/result response handlers.

control-plane/src/modules/identity/
    Application-owned person-session and account-status ports, a fixed
    host-only access-cookie reader, Supabase JWKS JWT verification, and the
    PostgreSQL current-account-status adapter.

control-plane/src/app/api/agent/v1/
    Fixed enrollment, poll, and result POST routes. Enrollment and delivery have
    independent default-disabled environment gates.

control-plane/src/app/api/person/v1/
    Origin-checked, person-session-authenticated enrollment-secret creation and
    idempotent device revocation POST routes. There is no person eject route.

control-plane/test/
    Unit, property, application-boundary, protocol-adapter, migration,
    repository, and deterministic concurrency tests.

control-plane/migrations/
    Ordered forward-only PostgreSQL schema migrations with checksum validation,
    including one-active-device-per-owner enrollment and revocation state.

control-plane/scripts/verify-cloud-database.ts
    Credential-redacting cloud schema, TLS configuration, and safety-state
    verification.

docs/CLOUD-DATABASE.md
    Paired operational ownership, protected environment, migration, rotation,
    recovery, and enablement runbook.

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

docs/decisions/0004-control-plane-schema-and-contract-sharing.md
    Accepted migration, Kysely, PostgreSQL schema, and protocol-sharing rules.

docs/decisions/0005-identity-and-device-security.md
    Accepted person auth, device key, enrollment, integrity, replay, revocation,
    result-idempotency, and clock construction.
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
19. All 49 control-plane tests pass, including fast-check properties, P-256
    request and response integrity, closed HTTP handling, protocol result
    mapping, and the default-disabled route. Critical
    authorization, lifecycle, exposure, and idempotency code has 100% branch,
    function, line, and statement coverage.
20. The 2026-07-21 production dependency audit reported zero known
    vulnerabilities. The
    PostCSS 8.5.20 override removes the advisory present in Next.js's transitive
    default.
21. The control-plane workflow passed all four jobs on `main`: static and
    architecture, domain and protocol with 100% critical coverage, all 12
    PostgreSQL 17 migration, repository, and concurrency tests, and the
    production build
    ([run 29813234824](https://github.com/tnoborio/eject/actions/runs/29813234824)).
22. Seventeen PostgreSQL tests pass locally, including atomic Kysely issuance,
    idempotent replay, deterministic races, two forward-only migrations, agent
    nonce replay, key revocation, fail-closed delivery, result idempotency,
    truthful lifecycle recording, checksum drift, safe defaults, and database
    constraints.
23. Five deterministic transaction-concurrency tests pass against PostgreSQL 17. Row-lock barriers prove final-slot serialization and retry, concurrent
    idempotent replay, all-write rollback after a constraint failure, grant
    revocation re-evaluation, and exactly one eject-back per source command.
24. Stryker 9.6.1 kills all 136 enabled mutants across authorization, exposure,
    lifecycle, and semantic idempotency policy. A weekly and manually
    dispatchable advisory workflow retains HTML and JSON reports for 14 days.
25. The Next.js production build includes fixed Node.js poll and result routes.
    Unit tests prove they return `404 DELIVERY_DISABLED` unless the environment
    gate is explicitly true; PostgreSQL independently blocks or cancels
    delivery when its global gate is false.
26. The authenticated polling change passed all control-plane and protocol
    checks before merge ([control-plane run 29815220933](https://github.com/tnoborio/eject/actions/runs/29815220933),
    [protocol run 29815220953](https://github.com/tnoborio/eject/actions/runs/29815220953)).
27. On 2026-07-21, the dedicated EJECT Supabase project reported
    `ACTIVE_HEALTHY`, PostgreSQL 17 in `ap-northeast-1`, and database SSL
    enforcement enabled. The repository verifier proved exact checksums for
    both migrations, a pinned-CA and hostname-verified connection, disabled
    delivery, no physical ceiling, and zero EJECT application rows.
28. The `sasara/eject` Vercel project is configured with the `control-plane`
    workspace root, Next.js, Node.js 22, Tokyo `hnd1` compute, and the GitHub
    repository. `DATABASE_URL` and the pinned CA exist only as sensitive
    Production values. Delivery is explicitly false in Production, Preview,
    and Development; Preview has no production database credential.
29. Protected deployment `dpl_G6pHisFuPVmausakV6PXxzrGtZYi` reached `Ready`
    with its Next.js Functions in `hnd1`. An authenticated deployment check
    received HTTP 200 from the shell and `404 DELIVERY_DISABLED` from the
    deployed poll route.
30. PR #12 passed all four blocking control-plane jobs and both Vercel checks
    ([run 29839496511](https://github.com/tnoborio/eject/actions/runs/29839496511)).
31. On 2026-07-22, the person-session adapter passed 58 control-plane unit
    tests. Its critical application, Supabase JWT, and fixed-cookie surfaces are
    included in the blocking 100% branch, function, line, and statement
    coverage boundary.
32. The JWT adapter accepts only ES256 or RS256 signatures resolved through the
    configured Supabase JWKS, exact issuer and audience, a required expiry, and
    a lowercase UUID subject. Tests reject wrong claims, expiry, signatures,
    malformed or oversized tokens, and non-UUID subjects without exposing
    email or provider identity to application code.
33. Eighteen PostgreSQL 17 tests pass locally. The added real-database test
    proves that a person changes from `ACTIVE` to `RESTRICTED` between requests
    and the next session authentication observes the restriction.
34. The current checkout passes locked `npm ci`, all eleven protocol tests, the
    control-plane static and architecture checks, the production build, and all
    ten .NET 10 tests. The new `jose` dependency is exact-pinned at 6.2.4.
35. A new `fast-uri` advisory discovered during this session is resolved with
    compatible 3.1.4 lockfiles, and the standalone protocol production audit is
    clean. The root production audit still reports the new Sharp/libvips
    advisory described under known limitations.
36. PR #13 merged as `45bac29` after all five GitHub Actions jobs and both
    Vercel checks passed ([control-plane run 29895265935](https://github.com/tnoborio/eject/actions/runs/29895265935),
    [protocol run 29895265928](https://github.com/tnoborio/eject/actions/runs/29895265928)).
37. The current checkout passes 70 control-plane unit tests. The enrollment
    application boundary is included in the blocking critical-coverage set,
    which remains at 100% branch, function, line, and statement coverage.
38. Twenty-three PostgreSQL 17 tests pass locally across three forward-only
    migrations. Real-database evidence covers digest-only ten-minute secrets,
    exact one-use consumption under a concurrent race, one active device per
    owner, account and expiry rechecks, replacement after revocation, and
    atomic key, pending-enrollment, and command cancellation.
39. Closed HTTP tests reject person IDs in request bodies, cross-origin person
    mutations, unknown enrollment fields, query strings, non-Windows metadata,
    malformed public keys, and non-canonical inputs. Only numeric three-part
    agent versions and canonical P-256 DER SubjectPublicKeyInfo are accepted.
40. The production build includes fixed agent enrollment and person enrollment
    and revocation routes. Enrollment creation returns a 404 response with
    `ENROLLMENT_DISABLED` before database or person-auth initialization unless
    its independent environment gate is explicitly true; revocation remains a
    separate authenticated safety path.
41. PR #14 merged as `f08d090` after all four control-plane jobs and both Vercel
    checks passed ([control-plane run 29896627535](https://github.com/tnoborio/eject/actions/runs/29896627535)).
42. On 2026-07-22, migration 0003 was applied to the dedicated protected
    Supabase PostgreSQL 17 database in one advisory-locked transaction. A
    separate read-only query verified all three repository checksums, both new
    indexes and metadata columns, removal of the old owner uniqueness
    constraint, `delivery_enabled = false`, an unset physical ceiling, and zero
    aggregate application rows.
43. The current Production deployment returned `DELIVERY_DISABLED` from agent
    polling and `ENROLLMENT_DISABLED` from agent enrollment. The enrollment
    environment opt-in and response-signing private key remain absent; no
    person, device, secret, command, result, or private event was created.
44. PR #16 passes 92 control-plane unit tests. The person-session
    lifecycle joins the blocking critical boundary, which remains at 100%
    branch, function, line, and statement coverage.
45. Closed HTTP tests bind magic-link initiation, OTP verification, refresh, and
    local logout to exact POST paths and exact HTTPS Origin. The callback accepts
    only one code and matching 32-byte state from the same browser, has no open
    redirect, clears the one-time PKCE cookies, and applies `private, no-store`
    and `no-referrer` response policy.
46. The Supabase adapter uses PKCE S256, sets `create_user = false`, keeps the
    publishable key server-side, bounds provider responses, rotates refresh
    tokens, requests local-scope logout, and requires a verified asymmetric JWT
    before installing access and refresh cookies.
47. The production build includes five fixed person-auth routes. They return
    `PERSON_AUTH_DISABLED` before provider initialization unless the independent
    opt-in is exactly true; no auth setting or publishable key is configured in
    Vercel.
48. PR #16 passed all four control-plane jobs and both Vercel checks before
    merge ([control-plane run 29898326094](https://github.com/tnoborio/eject/actions/runs/29898326094)).

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
- PostgreSQL issuance, authenticated poll/result transport, person-session
  verification, and the server enrollment/revocation boundary are implemented,
  and the server-owned Supabase magic-link/OTP PKCE cookie lifecycle is on
  `main` but disabled and unconfigured. A sign-in UI, live-provider
  end-to-end evidence, Windows CNG key creation, and the Windows polling client
  have not been implemented.
- The person JWT adapter has been verified with local asymmetric JWKS fixtures,
  not against the provisioned Supabase Auth issuer or a live rotated key set.
- The cloud environment has all three migrations applied and verified, but no
  person, device, enrollment secret, command, result, signing key, or private
  event has been added. Enrollment remains disabled. This is infrastructure
  readiness, not a live service.
- ADR 0005 fixes the authentication provider, device credential, integrity,
  replay, revocation, idempotency, and clock construction. It has not received
  independent security review or standard-user Windows CNG validation.
- As of 2026-07-22, `npm audit --omit=dev` reports a high-severity inherited
  libvips advisory through Next.js's optional Sharp 0.34.5 dependency. The
  current latest stable Next.js still declares `sharp ^0.34.5`, while the audit
  fix requires Sharp 0.35 or later. Do not force an unsupported major override;
  update through a compatible Next.js release or an explicit reviewed decision.
- Protocol sharing, pure test boundaries, SQL migrations, the PostgreSQL
  issuance repository, real-database race tests, and blocking control-plane CI
  are implemented. Scheduled advisory mutation testing is also implemented.
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
only development queue. SQL migrations, blocking CI, Kysely issuance,
deterministic PostgreSQL races, advisory mutation testing, ADR 0005,
authenticated poll/result transport, and the dedicated cloud database
environment, person-session adapter, and server enrollment/revocation boundary
are implemented, and all three migrations are applied to the protected cloud
database. The person PKCE cookie lifecycle is locally implemented. The next
software sequence is:

1. validate non-exportable P-256 Windows CNG creation as a standard user on real
   Windows before accepting enrollment as complete; and
2. add outbound Windows polling, durable replay consumption, and result resend
   without adding any generic command or inbound port.

Keep the enrollment opt-in absent, keep both delivery gates false, and do not
configure the server response-signing private key in Vercel during the
person-auth and enrollment work.

The skeleton's pull requests must block on formatting, lint, TypeScript,
dependency rules, a Next.js production build, pure and property tests, and
integration and deterministic concurrency tests against an ephemeral real
PostgreSQL service. Critical pure policy surfaces require 100% branch coverage.
Scheduled mutation testing starts as advisory. Database mocks do not establish
transaction, locking, or constraint correctness.

Authenticated polling and enrollment must conform to ADR 0005. Any algorithm,
header construction, key-storage fallback, or replay-window change requires an
explicit security decision rather than an implementation shortcut.

## Hardware work when equipment becomes available

Run the validation kit as a standard user, review the privacy-bounded reports,
repeat the matrix in `STAGE-0-WINDOWS-SPIKE.md`, fix only evidence-backed adapter
problems, and document a narrow Windows capability contract. Stage 0 remains
incomplete until that contract is repeatable on real hardware.

## Planned PR sequence from this implementation

CI verification for both updated workflows is complete on `main` (see the
snapshot links). Keep subsequent changes small and reviewable:

1. **Control-plane PostgreSQL and CI** — checked-in SQL migrations, Kysely
   issuance repository, real-database race tests, and blocking workflow are
   implemented, as is scheduled advisory mutation testing. This foundation was
   established before adding any public endpoint or device enrollment.
2. **Identity and device-security ADR** — accepted in ADR 0005: Supabase person
   identity, separate CNG device keys, protected storage, exact-byte integrity,
   replay, revocation, result idempotency, and clock rules.
3. **Authenticated outbound polling** — implemented on the control plane with
   exact-byte P-256 authentication, signed responses, nonce replay prevention,
   result idempotency, and two fail-closed delivery gates.
4. **Dedicated cloud environment** — implemented with an isolated managed
   PostgreSQL 17 project, SSL enforcement, protected production-only database
   access, exact migration verification, Git-connected Vercel deployment, and
   delivery disabled.
5. **Person auth and Windows enrollment/polling** — person-session verification
   and the default-disabled server enrollment/revocation boundary are on `main`,
   and their third migration is applied and verified in the protected cloud
   database. Server-owned PKCE cookie routes are also on `main` and
   default-disabled. Sign-in UI and live-provider evidence, protected Windows
   key creation, local replay protection, one attempt, result report, and
   outbound-only polling remain.
6. **Hardware evidence in parallel** — add reviewed reports and any narrowly
   evidence-backed adapter corrections when equipment becomes available.

The selected construction still needs independent security review and real
standard-user Windows CNG evidence before Stage 1 enrollment is complete.

## Completion criteria for the next handoff

A future session should leave behind:

- a focused PR with tests and paired English/Japanese meaning changes;
- links to relevant Actions runs;
- explicit evidence for what was verified;
- an updated list of unresolved physical or security questions;
- no credentials, signing material, device tokens, or private event logs; and
- this handoff updated if the current phase or next recommended action changes.
