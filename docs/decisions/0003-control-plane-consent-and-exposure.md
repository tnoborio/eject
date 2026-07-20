# ADR 0003: Control Plane, Consent, and Exposure

[日本語](0003-control-plane-consent-and-exposure.ja.md)

- **Status:** Accepted
- **Date:** 2026-07-20

## Context

Protocol v1 fixes the wire capability to one short-lived optical-drive eject
command, but it does not decide how the Stage 1 control plane is deployed, how
recipient consent is evaluated, who qualifies to send, or how a future
subscription relates to physical interruption.

EJECT must preserve directional consent and recipient control while remaining
legible as more than a conventional IoT utility. Its deliberate excess is part
of the work: serious identity, policy, billing, lifecycle, and native-device
machinery exists to produce one nearly useless physical event. A subscription
can strengthen that reading only if it formalizes exposure chosen by the
recipient. It must not sell additional power over another person.

Stage 0 hardware truth remains unresolved. Nothing in this decision permits a
claim that a tray opened, sets a mechanically safe frequency, or completes
device enrollment security.

## Decision

### Stage 1 deployment and module boundaries

1. Build the Stage 1 web client and control plane as one TypeScript and Next.js
   modular monolith on the Vercel Node.js runtime.
2. Keep the web UI, person-facing HTTP, and future agent-facing HTTP in one
   deployment initially. Do not expose a public eject endpoint in the domain
   skeleton.
3. Organize code by product capability first: `identity`, `permissions`,
   `devices`, `eject`, and a deferred `entitlements` boundary. Within each
   module, dependencies point from transport to application to domain.
4. Domain code does not import Next.js, React, Vercel, PostgreSQL, an ORM, or
   protocol wire objects. Infrastructure implements application-owned ports;
   a composition root supplies implementations.
5. Person sessions and device credentials remain separate. Device enrollment,
   authenticated polling, credential storage, message integrity, and
   revocation lookup wait for their focused security decision.

### Authorization and cancellation

6. Evaluate a new eject request with a pure domain policy. An application use
   case loads current facts, passes an explicit server time, and receives a
   closed authorized or rejected result. Normal denial is not an exception.
7. Authorization considers actor status, relationship and grant where required,
   recipient access policy, block state, pause, quiet hours, cooldown, sender
   and recipient limits, device eligibility, and revocation.
8. Keep request-time authorization separate from cancellation of an already
   authorized command. Missing permission at request time is
   `PERMISSION_REQUIRED`; later permission, device, or global-delivery changes
   cancel outstanding commands with the protocol v1 cancellation reasons.
9. Start recipient-wide cooldown when an authorized command is transactionally
   persisted as `QUEUED`, using control-plane time. Failed delivery does not
   invite an immediate mechanical retry.
10. Individual blocks, account restrictions, pause, revocation, emergency
    shutdown, and physical safety limits always override a broader access
    setting or paid entitlement.

Authorization-state reads, pure policy evaluation, command and lifecycle
creation, cooldown start, rate-limit consumption, and exposure consumption form
one short PostgreSQL transaction. Agent delivery and all calls to identity,
billing, notification, or analytics services happen only after commit. A
rejected request may record only its bounded `REQUESTED` to `REJECTED` lifecycle
inside that transaction and never creates a deliverable command.

Run issuance and revocation transactions at PostgreSQL `SERIALIZABLE` isolation.
Both lock the recipient's single `recipient_eject_state` row with `FOR UPDATE`
before evaluating or changing consent state. Serialization failures and
deadlocks receive a bounded application retry, with a default maximum of three
attempts. Exhaustion is a temporary server failure, not a recipient rejection,
and leaves no command or quota consumption. Database unique constraints remain
the final authority for command and event identifiers. Do not add an external
distributed lock.

Each deliberate person action carries a client-generated UUID idempotency key.
The database uniquely binds `(actor_id, idempotency_key)` to a canonical
semantic request fingerprint and its committed rejection or command result. An
identical retry returns that stored result without reauthorization or additional
quota use. Reusing the key for another recipient, action, or eject-back source is
a conflict and creates nothing. Retain the bounded record for at least 24 hours;
do not store raw HTTP payloads or credentials in it. When commit outcome is
unknown, look up the same key before attempting issuance again.

One-time eject back is also protected independently by a unique
`reply_to_command_id` consumption constraint. Agent result ingestion remains an
idempotent upsert bound to `(device_id, command_id)` under protocol v1. Client
button state is never the source of any of these guarantees.

Use Kysely with the `node-postgres` driver for runtime PostgreSQL access. It is
a type-safe SQL query builder, not a domain model or full object graph ORM.
Kysely types and transaction objects remain inside infrastructure repository
implementations; application-owned ports expose domain-shaped values only.
Keep `SERIALIZABLE`, `FOR UPDATE`, constraints, and PostgreSQL-specific behavior
explicit in repository code. Do not add Prisma, Drizzle, or a provider-specific
database SDK to the Stage 1 runtime path.

The exact PostgreSQL schema and migration source of truth remain subsequent
architecture decisions. The transaction, isolation, locking, idempotency,
runtime query-tool, and verification boundaries are fixed by this decision.

### Control-plane verification boundary

Control-plane pull requests have four blocking verification layers:

- static and production-build checks, including formatting, lint, TypeScript,
  a Next.js production build, circular-dependency detection, and executable
  dependency rules that preserve transport to application to domain direction;
- Vitest unit tests and fast-check property tests for pure authorization,
  lifecycle transitions, exposure calculation, and idempotency fingerprints;
- integration tests against an ephemeral real PostgreSQL service, including
  migrations from an empty database, repository behavior, constraints,
  rollback, isolation, and locking; and
- deterministic multi-connection concurrency tests that coordinate transaction
  order with barriers rather than timing sleeps.

Persistence invariants are not proven with a mocked database. Concurrency tests
must cover at least final-slot exposure races, simultaneous identical
idempotency requests, issuance racing revocation, one-time eject-back
consumption, bounded serialization retry, and absence of partial command or
quota state after failure. A failed race is not made green by repeatedly
rerunning the test; its reproducible ordering and any property-test seed are
reported.

Require 100% branch coverage for the small critical pure-policy surfaces:
authorization, lifecycle transitions, effective exposure, idempotency
fingerprinting, and eject-back eligibility. Do not impose a repository-wide
coverage number merely to reward low-value tests. Add scheduled Stryker mutation
testing for those critical surfaces, and keep it advisory initially until its
runtime and stable threshold are measured.

CI uses only synthetic identities and an ephemeral database, carries no
production credentials or private event data, grants minimum workflow
permissions, and pins third-party Actions to full commit SHAs. The PostgreSQL
major version is pinned to the production provider's version once that provider
is selected; the decision does not guess that version in advance.

### Recipient-authored access

11. Model two independent recipient-owned policy axes:

    - audience scope: `NAMED`, `CONNECTED`, or `ALL_AUTHENTICATED`;
    - sender eligibility: `READY_PARTICIPANTS_ONLY` or
      `AUTHENTICATED_ACCOUNTS`.

12. Default to `NAMED` plus `READY_PARTICIPANTS_ONLY`. Under `NAMED`, an active
    relationship and an active directional grant from recipient to actor are
    required. `CONNECTED` requires an active relationship.
    `ALL_AUTHENTICATED` never includes anonymous actors.
13. A block always overrides scope. Accepting ejects does not make a person
    searchable: discoverability and eject access are separate policies.
14. Stage 1 exposes only the narrow default. Broader connected and authenticated
    scopes require explicit recipient opt-in and staged abuse review before
    release.

### Accounts, participants, and eject back

15. An account alone does not prove participation. Model coarse participation
    states such as `ACCOUNT_ONLY`, `SETUP_IN_PROGRESS`,
    `PARTICIPATION_READY`, and `REVOKED`, separately from transient
    `AVAILABLE`, `PAUSED`, and `OFFLINE` availability.
16. `PARTICIPATION_READY` means that an authenticated agent has an approved
    local drive and the owner completed a local setup test. It is a bounded,
    user-confirmed eligibility fact, not remote proof that a tray opened and
    not hardware attestation.
17. The default sender eligibility requires a ready and available participant.
    A recipient may deliberately choose to accept authenticated account holders
    who do not have a receiving-capable EJECT setup. The UI must then state
    truthfully that eject back may be unavailable.
18. Sending an eject creates explicit consent for the recipient to use one
    short-lived, one-time eject-back authorization toward the actor. It does
    not create a permanent reciprocal grant. Pause, revocation, expiry,
    cooldown, and safety controls still prevail.

### Subscription as an exposure contract

19. A future subscription belongs to the recipient side of the contract. It
    may raise the maximum inbound exposure the recipient is allowed to select;
    it must never buy a sender broader access to another person.
20. Keep three concerns independent:

    - access policy decides **who** may eject the recipient;
    - exposure policy decides **how often** the recipient elects to accept it;
    - entitlement decides the maximum exposure the current plan permits.

21. Compute the effective inbound limit as the minimum of the recipient's
    selected limit, the plan entitlement ceiling, and an evidence-backed
    physical safety ceiling.
22. A higher plan never changes access scope automatically. Pause, block,
    revoke, account deletion, and safe minimum controls remain available
    regardless of payment state.
23. Domain authorization consumes an effective entitlement and does not depend
    on a billing vendor, product plan name, or price. Billing integrations
    implement a replaceable entitlement port.
24. Do not set plan prices, frequency numbers, or an unlimited tier before
    physical hardware evidence establishes a defensible safety ceiling. Billing
    and public monetization remain outside the Stage 1 domain-skeleton PR.

## Consequences

- The first control-plane implementation can test consent and lifecycle without
  committing to authentication, billing, or device-enrollment vendors.
- EJECT preserves private-by-default directional consent while allowing a
  recipient to author broader, deliberately asymmetric participation later.
- Account-only observers do not silently acquire physical agency; they can act
  only when a recipient explicitly permits authenticated accounts.
- Subscription becomes part of the work's contractual form: payment expands a
  person's chosen capacity to be interrupted rather than purchasing power over
  somebody else.
- Cooldown and plan usage are updated atomically with command issuance; schema
  and migration tooling still need to be decided.
- Control-plane correctness is enforced through pure and property tests, a real
  PostgreSQL instance, deterministic race tests, executable architecture rules,
  and a production build. Mutation testing periodically tests the tests.
- Broader access increases abuse and privacy risk. Per-actor and per-recipient
  limits, block, pause, revocation, nondiscoverability, and emergency shutdown
  remain mandatory.
- The existing physical uncertainty remains visible. Participation readiness,
  command acceptance, agent attempt, and observed tray movement are distinct
  facts.

## Rejected alternatives

- Selling a sender the right to bypass another person's access policy.
- Treating a paid plan as consent or automatically broadening recipient scope.
- Making all registered accounts eligible by default.
- Treating account creation, agent enrollment, or a Windows API success as
  proof of physical tray movement.
- Introducing a generic policy engine, microservice split, or realtime service
  before the bounded Stage 1 domain requires one.
