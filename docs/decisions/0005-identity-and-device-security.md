# ADR 0005: Identity and Device Security

[日本語](0005-identity-and-device-security.ja.md)

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

EJECT needs two different identities: a person using the web control plane and a
Windows agent acting as one registered device. Reusing a browser session as a
device credential would make theft, revocation, and unattended operation harder
to contain. Protocol v1 also requires the agent to verify command integrity,
audience, expiry, and uniqueness independently of server authorization.

This decision closes the authentication, enrollment, protected-storage,
message-integrity, replay, revocation, result-idempotency, and clock boundaries
before any agent-facing endpoint is enabled. It does not claim physical tray
behavior, authorize a generic remote command, or make macOS a supported target.

## Decision

### Person identity

1. Use managed Supabase Auth for Stage 1 person identity. Begin the private
   alpha with email magic link or email OTP through the PKCE flow. A public
   release still requires production SMTP, account-recovery review, and a
   separate decision on mandatory MFA or passkeys.
2. Use Supabase asymmetric JWT signing keys. Server-side code verifies the
   signature from the project JWKS and requires the configured issuer,
   audience, expiry, and UUID subject. It never accepts a person ID from a
   request body as identity.
3. Keep access and refresh material in Secure, HttpOnly, SameSite cookies owned
   by server-side auth routes. State-changing browser requests are POST-only,
   check `Origin`, and still perform application authorization from current
   database state. A valid JWT is identity evidence, not eject permission.
4. Never expose a Supabase secret or service-role key to browser code. Domain
   and application modules depend on an identity port, not the Supabase SDK.
   Supabase stores email and provider identity; EJECT tables use only the
   subject UUID and do not duplicate email unless a later product need is
   explicitly approved.
5. A mutating request checks the EJECT account status after JWT verification.
   Account restriction therefore takes effect even while a short-lived access
   token remains cryptographically valid. Global sign-out and provider session
   revocation remain incident controls.

### Device enrollment and credential

6. A person session may create a 32-byte cryptographically random enrollment
   secret for one owner. The secret is displayed once, sent only in an HTTPS
   body, expires after ten minutes, and is consumed once. PostgreSQL stores only
   its SHA-256 digest, owner, expiry, and bounded used state; it is never placed
   in a URL or log.
7. During enrollment, the Windows agent creates a per-device ECDSA P-256 key in
   Windows CNG. Prefer the Microsoft Platform Crypto Provider when available;
   otherwise use the Microsoft Software Key Storage Provider. The key is scoped
   to the current Windows user, persistent, and non-exportable. If neither
   protected provider works, enrollment fails; there is no plaintext or
   exportable-key fallback.
8. The agent sends only the enrollment secret, a new device UUID, a new key UUID,
   the P-256 public key as DER SubjectPublicKeyInfo, and closed setup metadata.
   The server atomically consumes the secret and binds the public key to its
   owner and device. Reinstall, profile loss, or key loss requires revocation and
   new enrollment; private keys are not backed up or synchronized.
9. Person sessions and device keys are never interchangeable. A person session
   creates or revokes an enrollment, while every poll and result request must
   prove possession of the registered device key.

### Authenticated request construction

10. Agent endpoints use HTTPS POST with no query parameters. Each request has a
    maximum body size fixed by the endpoint and carries these headers:

    ```text
    Eject-Device-Id: UUID
    Eject-Key-Id: UUID
    Eject-Timestamp: Unix time in decimal milliseconds
    Eject-Nonce: base64url without padding, 16 random bytes
    Eject-Content-SHA256: base64url without padding, SHA-256 of exact body bytes
    Eject-Signature: base64url without padding, 64-byte IEEE P1363 signature
    ```

11. The device signs UTF-8 bytes of the following newline-separated string,
    with no final newline. Method is uppercase, path is the exact registered
    path, and the body hash covers the exact UTF-8 JSON bytes received.

    ```text
    EJECT-DEVICE-REQUEST-V1
    <key UUID>
    <device UUID>
    <timestamp milliseconds>
    <nonce>
    <HTTP method>
    <path>
    <body SHA-256>
    ```

12. Sign and verify with ECDSA P-256 and SHA-256 using the fixed 64-byte IEEE
    P1363 `r || s` representation. Reject malformed encodings before crypto,
    compare identifiers exactly, and do not support algorithm negotiation in
    protocol v1.
13. The server rejects timestamps more than 30 seconds from control-plane time.
    It atomically inserts `SHA-256(device_id || nonce)` under a unique device
    constraint before performing the operation and retains that replay record
    for ten minutes. A repeated nonce is rejected even if its signature differs.
14. Key lookup, active device and key checks, replay consumption, command
    dispatch or result ingestion, and lifecycle writes form one database
    transaction where applicable. Authentication failure returns a bounded
    machine code and never reveals whether another person's device exists.

### Server response integrity

15. TLS provides transport confidentiality and endpoint authentication. In
    addition, the control plane signs every authenticated agent response with a
    distinct ECDSA P-256 server key. Private server signing keys are
    environment-specific, live only in protected server secret storage, and are
    never stored in PostgreSQL or the repository.
16. The response carries a key ID and a 64-byte P1363 signature. The signed
    UTF-8 string has no final newline:

    ```text
    EJECT-SERVER-RESPONSE-V1
    <request nonce>
    <HTTP status in decimal>
    <base64url SHA-256 of exact response body bytes>
    ```

    The agent verifies the signature over the raw body before parsing JSON. The
    body is a closed transport wrapper containing signed server time and either
    one protocol-v1 `COMMAND` or no command. Protocol messages remain unchanged
    and are validated after the transport wrapper.

17. The signed response key ring is pinned in the signed agent distribution.
    Rotation uses current and next public keys with an overlap release before
    the server begins signing with the next key. No response can add a command
    type, drive path, script, executable, or other local capability.

### Polling, revocation, results, and time

18. The agent initiates outbound HTTPS polling and opens no inbound port. A
    repeated poll may receive the same still-valid command, but the agent's
    durable command-ID consumption remains the authority preventing a second
    physical attempt.
19. Every poll checks active device, key, owner, global-delivery, and command
    state. Device or key revocation immediately blocks later polls without an
    agent update and cancels undelivered outstanding commands. A command already
    delivered cannot be recalled over an offline network; its maximum remaining
    protocol lifetime and local pause are the bounded controls.
20. Revoked credentials cannot submit results. An authenticated result must
    match the command's device and is uniquely bound to `(device_id,
command_id)`. An identical retry returns the stored result; different
    semantics conflict and create no new lifecycle transition or physical
    attempt.
21. Control-plane time is authoritative for issuance, expiry, cooldown, and
    replay windows. Each signed polling response includes server time. The agent
    derives a bounded offset for later request timestamps and uses monotonic
    elapsed time to reduce, never extend, a command's remaining lifetime. It
    never changes the operating-system clock. A stale but correctly signed
    request may receive a signed clock-skew response only after its key and
    signature have been verified.
22. Do not log enrollment secrets, cookies, JWTs, private keys, signatures,
    nonces, raw request or response bodies, or full IP histories. Public keys,
    bounded reason codes, key IDs, revocation times, and short-lived hashed
    nonces are the maximum authentication data required by this design.

## Consequences

- A stolen browser session does not become an unattended device credential,
  and a stolen device key does not become a person session.
- Device compromise is bounded to one registered device and one closed physical
  command until revocation or key replacement.
- The first polling implementation needs database records for enrollment
  digests, public keys, replay digests, result idempotency, and server signing
  key IDs, but no private device or server key column.
- Windows enrollment depends on real CNG behavior and must be tested as a
  standard user on target hardware. macOS protected storage remains undecided
  and experimental.
- Application-layer response signatures add rotation and release coordination,
  but let the agent validate an exact command response independently of
  intermediaries after TLS termination.
- This ADR specifies a private-alpha construction, not an independent security
  review. Threat review, production SMTP, binary signing, update verification,
  retention limits, and incident exercises remain required before public use.

## Rejected alternatives

- Reusing a Supabase person access or refresh token as the desktop credential.
- A shared bearer token for all devices or a device secret in a polling URL.
- Exportable private keys protected only by a configuration file or a silent
  plaintext fallback when CNG is unavailable.
- Mutual TLS for the first private alpha; it adds certificate issuance and
  proxy constraints without removing application replay and command-validation
  requirements.
- Accepting unsigned command JSON merely because it arrived through an
  authenticated person session.
- WebSockets, inbound listeners, generic webhooks, arbitrary command payloads,
  or remote update instructions in the command protocol.

## References

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- [Supabase JWT verification](https://supabase.com/docs/guides/auth/jwts)
- [Microsoft CNG key storage providers](https://learn.microsoft.com/en-us/windows/win32/seccertenroll/cng-key-storage-providers)
- [DSASignatureFormat](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dsasignatureformat)
