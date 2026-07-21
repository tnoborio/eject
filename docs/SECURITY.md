# Security and Privacy

[日本語](SECURITY.ja.md)

EJECT deliberately lets a remote person cause a physical action on another
person's computer. The action is small, but the trust boundary is real. Security
is part of the product concept, not an implementation detail.

## Security invariants

1. A person cannot eject another person without an active recipient grant.
2. A server command cannot select an arbitrary local device path.
3. The agent cannot execute arbitrary code, commands, scripts, or plug-ins.
4. Every command is bound to one registered device, expires quickly, and can be
   accepted only once.
5. Revoking a person or device takes effect without waiting for an app update.
6. The agent makes outbound connections only and exposes no remote-control port.
7. The system does not read disc contents or infer what media is inserted.
8. A network success is never represented as a confirmed physical success.

## Threat model

The initial design must account for:

- an abusive or compromised friend account;
- repeated commands intended to annoy or damage hardware;
- replayed, delayed, modified, or misrouted commands;
- stolen desktop-agent credentials;
- a compromised web session;
- a malicious server payload attempting to broaden local execution;
- drive identifiers changing after hardware reconnect;
- logs revealing relationships, presence, or device behavior;
- an update channel delivering a modified agent;
- the tray physically striking an object or repeatedly cycling.

## Authorization

Permission is directional and explicit. “Alice and Bob are friends” does not
mean Bob may eject Alice. Alice grants, pauses, limits, and revokes that ability.

Authorization should evaluate, at command issuance time:

- authenticated actor;
- active relationship where required;
- active recipient grant;
- recipient pause and quiet-hour policy;
- sender and recipient rate limits;
- target device registration and eligibility;
- abuse or account restrictions.

The agent independently verifies the command's device audience, integrity,
expiry, and command ID. Server authorization does not replace local validation.

## Capability containment

The command protocol has a closed set of types. Initially the only physical
command is `OPTICAL_DRIVE_EJECT`.

The command must not contain:

- shell text;
- executable paths;
- DLL or library names;
- generic IO control codes;
- arbitrary device paths;
- URLs for executable payloads;
- scripts or serialized objects interpreted as code.

The locally approved drive binding is created on the recipient's computer and
is not chosen by the sender.

Protocol v1 makes these constraints executable: commands address one exact
device, expire within at most 60 seconds, and reject unknown fields. For a valid
current command addressed to the device, the agent durably consumes the command
ID before or atomically with the local attempt. It may resend the stored result
after a transport failure but must not repeat the physical action. Consumed IDs
survive restart for at least 24 hours.

Protocol validation does not replace authenticated transport. ADR 0005 selects
Supabase Auth for person identity and a separate, non-exportable Windows CNG
ECDSA P-256 key for each device. Poll and result requests bind the device, key,
timestamp, random nonce, method, exact path, and exact body hash in a signed
construction. Authenticated responses are separately signed and bound to the
request nonce, status, and exact body hash. The agent verifies response
integrity before protocol parsing.

## Abuse and physical safety

- Apply a recipient-controlled cooldown after each accepted eject.
- Enforce server-side burst and daily limits as a second layer.
- Allow one-click local pause and immediate revocation.
- Do not provide remote tray closing in the initial product.
- Warn during setup that the tray requires unobstructed physical space.
- Stop retries after one local attempt unless the recipient initiates another.
- Prefer failure over repeated mechanical cycling.
- Keep public anonymous access disabled in the initial product.

## Credentials and transport

- Use modern authenticated encryption in transit.
- Give each device its own revocable ECDSA P-256 key pair, separate from person
  sessions.
- Keep the Windows private key non-exportable in CNG protected storage. Fail
  enrollment instead of falling back to plaintext or an exportable key.
- Never place device credentials in URLs, logs, analytics, or notification text.
- Rotate server secrets and support immediate device-session revocation.
- Sign and verify distributable agent binaries and updates before public use.

The complete enrollment, signature, replay, revocation, result-idempotency, and
clock construction is in
[ADR 0005](decisions/0005-identity-and-device-security.md). It still requires an
independent review and real standard-user Windows validation before public use.

## Privacy and data minimization

EJECT does not need:

- camera or microphone access;
- screenshots;
- disc titles, file names, or contents;
- continuous fine-grained presence history;
- a detailed inventory of computer hardware;
- room, location, or nearby-device data;
- advertising profiles.

Store only enough event history to show recent actions, diagnose failures,
enforce abuse controls, and investigate security incidents. Define deletion and
retention periods before private alpha.

## Logging

Use bounded identifiers and reason codes. Redact credentials and avoid raw
payload logging. Separate user-visible history from security audit data, and
restrict operational access to both.

## Incident controls required before public use

- revoke one device;
- revoke all sessions for one account;
- disable all eject delivery globally;
- block one abusive actor;
- invalidate outstanding commands;
- rotate signing and service credentials;
- communicate whether a command was requested, delivered, or executed without
  overstating certainty.

## Reporting

A security contact and responsible disclosure process must be added before a
public alpha. Do not invite vulnerability reports until there is a monitored
channel capable of receiving and acting on them.
