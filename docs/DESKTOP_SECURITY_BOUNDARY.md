# DevPilot Desktop security boundary

The renderer is untrusted. Electron is configured with context isolation,
disabled Node integration, sandboxing, and `shell: false` for runtime child
processes. The preload exposes a narrow typed API for runtime discovery,
project selection, ACP prompt/cancel/preflight, and sanitized diagnostics.

The Python ACP process resolves provider configuration and credentials locally.
Secrets are never returned through ACP events, Electron IPC, persisted desktop
session metadata, or runtime diagnostics. Stderr is continuously drained,
redacted, bounded to 1,000 entries / 1.5 MB, and forwarded only after
sanitization.

Project preflight is read-only. It validates directory, configuration,
credentials, Git, and evaluation readiness; it does not install packages,
write configuration, or change Git state.

The real ACP integration test sends a sentinel API key through preflight and
asserts that it is absent from captured ACP stderr. Electron applies a second
redaction and bounded-log layer before any diagnostic reaches the renderer.
