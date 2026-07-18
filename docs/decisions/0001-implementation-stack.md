# ADR 0001: Initial Implementation Stack

[日本語](0001-implementation-stack.ja.md)

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

EJECT must first validate physical tray behavior on Windows, then connect two
people without broadening the desktop agent into remote administration. The
repository initially contained product and architecture documents but no
implementation. The current build host is Linux ARM64 and no Windows test
computer is presently available.

## Decision

1. Implement the Stage 0 Windows spike in C# on .NET 10 as a console program.
2. Cross-publish an unsigned, self-contained `win-x64` executable on Linux.
3. Defer WinUI 3 and MSIX packaging until physical behavior is tested on real
   Windows hardware.
4. For Stage 1, use TypeScript and Next.js for the web client and modular control
   plane, deployed on Vercel.
5. Use managed PostgreSQL and managed person authentication, initially favoring
   Supabase, while keeping device credentials separate from person sessions.
6. Begin device delivery with authenticated outbound HTTPS polling. Treat a
   realtime provider as a replaceable wake-up transport, not as the source of
   command truth.
7. Define shared semantic contracts with OpenAPI or JSON Schema and keep all
   user-visible messages in English and Japanese locale resources.

## Consequences

- Linux can compile and test most Stage 0 code, but cannot establish the physical
  capability contract or validate Windows permissions and hardware behavior.
- The first executable has no network capability and accepts no arbitrary device
  path or IO control code.
- Vercel is not required for Stage 0 and server implementation should not get
  ahead of hardware truth.
- The control plane begins as a modular monolith. Command transport can move to
  another service without changing authorization or lifecycle semantics.
- The authentication provider and precise cryptographic scheme require a focused
  security decision before Stage 1 account and device enrollment are complete.
