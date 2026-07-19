# Roadmap

[日本語](ROADMAP.ja.md)

The roadmap validates the physical feeling before investing in a general social
product. Each stage has an exit condition; feature count is not progress by
itself.

## Stage 0 — Hardware truth

Build a local, non-networked Windows spike that discovers and ejects one
explicitly selected optical drive.

Test:

- multiple Windows versions intended for support;
- internal and external tray-style drives;
- an empty tray and inserted media;
- busy, unsupported, disconnected, and trayless devices;
- standard-user execution;
- whether success can mean physical opening or only command acceptance.

**Exit condition:** document a narrow, repeatable Windows capability contract on
real hardware without requiring arbitrary command execution.

When test hardware is temporarily unavailable, protocol and control-plane
domain work may proceed in parallel if it preserves Stage 0 uncertainty and all
safety boundaries. Parallel work does not satisfy the Stage 0 exit condition,
authorize a physical-success claim, or permit public remote delivery before the
hardware contract exists.

## Stage 1 — Two-person prototype

Connect two accounts and two Windows agents across separate networks.

Include only:

- account sign-in;
- one registered device and approved drive per person;
- explicit directional permission;
- one eject action;
- result reporting;
- native notification;
- cooldown;
- pause and revoke;
- eject back.

**Exit condition:** two people reliably complete a physical call-and-response
and can tell request, delivery, and outcome apart.

## Stage 2 — Private bilingual alpha

Invite a small group of known participants.

Add:

- complete English and Japanese onboarding and notifications;
- invitation and relationship management;
- quiet hours and recipient limits;
- signed distribution and safe update path;
- data retention and account deletion;
- operational revocation and emergency delivery shutdown;
- product and security feedback collection without surveillance.

**Exit condition:** participants understand the consent model, the agent is
operationally supportable, abuse controls work, and the physical event remains
interesting after the first demonstration.

## Stage 3 — Public experiment decision

Do not assume a public launch. Review:

- repeated-use behavior;
- invite and installation friction;
- compatible-drive prevalence;
- hardware and support burden;
- abuse attempts;
- whether scarcity preserves meaning;
- whether EJECT is best as an artwork, social toy, or continuing product.

**Exit condition:** make an explicit continue, narrow, archive, or expand
decision.

## macOS experimental track

After Stage 0 establishes the product's physical contract on Windows, run a
separate macOS hardware spike. Do not call logical disk unmounting EJECT support
unless it creates the intended physical result on a defined class of drive.

## Deferred questions

- exact web and native implementation stacks;
- authentication provider;
- realtime transport;
- code-signing and distribution vendors;
- limits and cooldown values;
- whether relationships must be mutual;
- whether a person may register multiple devices;
- public launch and monetization;
- any physical action beyond optical-drive eject.

These are intentionally deferred, not forgotten. Resolve them with evidence
from the preceding stage and record the decision.
