# DevPilot Desktop Architecture

## Ownership boundary

DevPilot Desktop is a local graphical control plane. The root Python DevPilot
package owns autonomous reasoning, providers, Coordinator and Executor
behavior, memory, audits, reports, and durable runtime state.

The desktop owns the Electron lifecycle, isolated preload boundary, React/Expo
presentation, project selection, readiness presentation, and ACP session
rendering. It does not reimplement Python orchestration or maintain a parallel
desktop database for research state.

## Runtime flow

```text
apps/desktop
  -> typed desktop client
  -> devpilot acp --stdio
  -> devpilot.sdk
  -> Coordinator / Executors / runtime
```

The desktop launches the repository-local
`C:\Users\MILES\Documents\DevPilot\.venv\Scripts\devpilot.exe` with an
executable and argument array. Shell interpolation is disabled. ACP stdout is
protocol-only; stderr carries diagnostics.

## Python SDK

`src/sdk/` is the stable Python boundary for local clients and protocol
adapters. It creates Coordinator-backed research sessions, exposes immutable
runtime events, and supports cancellation. The ACP adapter calls this SDK;
neither the desktop nor the adapter reaches into Executor internals directly.

## TypeScript desktop client

`apps/desktop/src/client.ts` defines the renderer-facing bridge. The Electron
main process exposes only runtime status, project selection, ACP launch, and
safe external-link opening. The renderer has no Node, filesystem, shell, or
credential access.

## Happier relationship

The desktop shell and reusable UI/runtime infrastructure are Happier-derived.
Existing `@happier-dev/*` packages are retained as temporary internal
dependencies for the first milestone. They are not a replacement for the
DevPilot Python runtime and are not globally renamed as part of this work.

## Research projection

The Research workspace consumes ACP updates, including `_meta.devpilot` event
metadata, as a read-only projection. Coordinator, hypotheses, Executors,
evidence, artifacts, approvals, files, and usage stay in the runtime's
authoritative session data.
