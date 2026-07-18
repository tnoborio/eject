# EJECT repository instructions

Read `PRINCIPLES.md`, `docs/SECURITY.md`, and `docs/I18N.md` before proposing or
implementing product changes.

Read `docs/HANDOFF.md` before continuing implementation work. Update its English
and Japanese versions when the current phase, verified evidence, or next
recommended action changes.

- Preserve the product's single physical action and deadpan tone.
- Treat consent, minimal capability, and no-surveillance as binding constraints.
- Never add generic remote command execution to the desktop agent.
- Keep Windows as the first implementation target and macOS experimental until
  physical behavior is validated on real hardware.
- English documents are canonical. Update the corresponding `.ja.md` document
  in the same change whenever user-visible meaning changes.
- Product strings must use locale resources; never hard-code English or Japanese
  into protocol payloads.
- Do not commit credentials, signing material, device tokens, private event logs,
  or user data.
- Do not broaden EJECT into a general IoT platform without an explicit decision
  that amends the design principles.
