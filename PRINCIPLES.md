# EJECT Design Principles

[日本語](PRINCIPLES.ja.md)

These principles sit above individual features. When a feature is attractive
but conflicts with a principle, the principle wins unless we deliberately amend
this document.

## 1. Meaninglessness is the feature

EJECT must not justify itself as productivity, automation, or useful remote
administration. Friends can open one another's CD trays. That is enough.

## 2. One action, one physical consequence

One deliberate press creates one small physical event. The product should not
grow into a conventional social network with a feed, posts, likes, or chat. The
movement of the tray is more important than the screen around it.

## 3. It must feel like a person, not automation

The event should carry human presence: “Kaz ejected you,” not merely “Tray
opened.” Scheduled jobs, bots, bulk actions, and public automation APIs weaken
that presence and are excluded from the initial product.

## 4. Consent before connection

The device owner decides who may eject them. Access is private by default,
granted explicitly, revocable immediately, and subject to pause and quiet-hour
controls.

## 5. Safe by incapability

The desktop agent is safe because it can do almost nothing. It must not expose a
shell, arbitrary process execution, arbitrary device paths, file access, or
general remote-control primitives. Its product capability is ejecting a locally
approved optical drive.

## 6. Scarcity creates meaning

Unlimited presses turn contact into spam. Cooldowns and recipient-controlled
limits make each physical interruption intentional and noticeable.

## 7. Never fake the physical world

“Command dispatched” is not “tray opened.” The system must distinguish request,
authorization, delivery, execution, and verified local outcome. Offline,
unsupported, busy, and failed states should be reported honestly.

## 8. Serious technology, deadpan presentation

Engineering should be rigorous. Presentation should be restrained, direct, and
almost institutional. The joke is that all this serious machinery exists to
open a CD tray; the interface does not need to explain the joke.

## 9. Do not become a platform too early

Lights, printers, toys, and other physical outputs may be possible later, but
EJECT must first make one specific interaction excellent. Abstraction is useful
only when it preserves the strength of the concrete experience.

## 10. No surveillance

EJECT may touch a person's surroundings but must not look into them. It does not
need cameras, microphones, screenshots, media contents, or reaction tracking.
Collect the minimum operational data required to deliver the event safely.

## 11. Language is not the product boundary

The core experience is a button and a physical movement, not a paragraph. All
user-facing text, notifications, errors, and documentation must be designed for
translation from the beginning. English and Japanese are the initial locales;
the architecture must not make them the final ones.

## Decision examples

- **Eject back:** aligned; it completes a human, physical call-and-response.
- **Automatic reaction recording:** rejected; it violates no-surveillance.
- **Public anonymous eject:** rejected initially; it weakens consent and human
  trust.
- **Scheduled eject:** rejected initially; it feels like automation, not a
  person.
- **Generic command plug-ins:** rejected; they violate safe-by-incapability and
  premature-platform principles.

> EJECT does one thing, physically, with consent.
