# Future Web and Mobile Surfaces

The present product target is a local Electron desktop application. Public web deployment and mobile applications are deliberately deferred.

## Deferred work

- browser-hosted runtime access and relay architecture;
- authentication, account, billing, and hosted synchronization services;
- public website and web deployment infrastructure;
- iOS and Android projects, signing, push notifications, and store submission;
- cross-device remote control and offline synchronization semantics.

These capabilities must not be re-enabled merely because related Happier code exists upstream. Each future surface needs an explicit threat model and product decision for runtime access, credential storage, approvals, session ownership, and network transport.

## Compatibility principle

Future clients should consume a versioned protocol exposed by DevPilot-CLI rather than importing its Python implementation. ACP is the local desktop integration baseline. Any remote transport should preserve the same separation of concerns: the client presents state and intent; the runtime owns autonomous execution and durable research semantics.

Desktop-only identifiers and configuration must remain isolated so later web or mobile packages can choose their own application IDs, deep-link schemes, update channels, and release lifecycle without renaming the desktop product again.
