# Product Concept

[日本語](PRODUCT.ja.md)

## Definition

EJECT is a consent-based social service in which one person can cause the
tray-style optical drive attached to another person's computer to eject.

The service combines modern IoT-like infrastructure with an outcome that has
almost no practical meaning. That contrast is the product.

## Emotional outcome

The recipient should feel three things in quick succession:

1. surprise at a physical sound and movement;
2. recognition that a specific person caused it from somewhere else;
3. the urge to eject that person back.

The intended emotion is not alarm and not utility. It is a small, absurd sense
of remote presence.

## Why a CD tray

- It crosses the boundary between software and physical space.
- It makes sound, occupies space, and is impossible to ignore completely.
- It is obsolete enough to feel unnecessary but familiar enough to understand.
- The ⏏ symbol and the word “eject” already form a recognizable action.
- A three-second video can communicate the whole idea.

The decreasing prevalence of optical drives is a constraint, but also part of
the character. EJECT gives unused hardware one final social purpose.

## Product model

### Person

An account with a display name, locale, relationships, and explicit permissions.

### Device

A computer running the EJECT agent. A person may eventually own multiple
devices, but the first version should optimize for one.

### Drive

A locally discovered and explicitly approved optical drive. The server must not
be allowed to supply an arbitrary device path.

### Relationship

A mutually known connection between two people. A relationship does not itself
grant eject permission; the recipient grants that separately.

### Eject event

One authorized request from one person to another person's registered device,
with a recorded delivery and local execution outcome.

### Participation

An account alone does not grant physical agency. A ready participant has an
authenticated agent, a locally approved drive, and a user-confirmed local setup
test. This state is eligibility to participate, not remote proof that a tray
opened. Availability, pause, and offline state remain separate and coarse.

### Access and exposure

The recipient independently chooses an audience, whether senders must be ready
participants, and how much inbound activity to accept. The private default is
one named, connected, ready participant with a directional grant. A recipient
may later opt in to connected people, all authenticated accounts, or senders
without receiving-capable hardware. Anonymous access remains excluded.

Access answers **who** may eject. Exposure answers **how often**. A future
subscription may expand the maximum exposure a recipient can elect, but never
expands a sender's access. The recipient may always select less than the plan
allows.

## Primary flow

1. Alice creates an account and signs in to the desktop agent.
2. The agent discovers a compatible tray-style optical drive.
3. Alice approves that drive and enables receiving.
4. Alice invites Bob.
5. Alice grants Bob permission to eject her.
6. Bob sees Alice as available and presses **EJECT** once.
7. The service authorizes and delivers a short-lived command.
8. Alice's agent attempts the local operation and reports the result.
9. If successful, Alice sees “Bob ejected you.”
10. Alice may press **EJECT BACK**.

## Recipient controls

- permission per person;
- audience and sender-eligibility policy;
- global receiving pause;
- quiet hours;
- recipient-selected rate and cooldown limits within a physical safety ceiling;
- immediate device unlink and token revocation;
- a visible local history of recent attempts and outcomes.

The recipient always has the final say. Availability shown to senders must not
reveal more device state than necessary.

## Honest states

The interface should distinguish at least:

- available;
- paused;
- offline;
- no compatible drive;
- request rate-limited;
- command delivered;
- tray opened;
- failed because the drive was busy or unsupported;
- result unknown.

“Sent” must never be presented as “opened.”

## Product language

EJECT may be used as a product-specific verb even in localized text.

```text
Kaz ejected you.
Eject back.
Allow this person to eject you?
Nobody can eject you right now.
```

The tone is brief, factual, calm, and slightly strange. It does not add jokes to
explain why the situation is funny.

## Initial non-goals

- general remote administration;
- reading a disc or its metadata;
- closing the tray remotely;
- feeds, posts, likes, direct messages, or follower counts;
- public anonymous eject access;
- bots, scheduled ejects, bulk actions, or public automation APIs;
- reaction cameras, microphones, or screenshots;
- support for arbitrary IoT devices;
- gamification that rewards spam.

## Earliest validation

The idea is validated when two real people on separate networks can reliably
complete the call-and-response loop and both describe the physical event as more
interesting than an ordinary notification.

Scale, retention, and monetization are later questions. The first question is
whether the tray movement creates a distinctive human feeling.

The intended monetization direction, if that first question is answered, is a
recipient-side exposure contract: a higher plan may permit the recipient to
choose a higher inbound limit. It does not sell a sender a right to override
consent. Prices and frequency ceilings require physical evidence and a later
public-experiment decision.
