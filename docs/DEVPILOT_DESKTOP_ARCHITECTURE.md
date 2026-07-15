# DevPilot Desktop Architecture

## Ownership boundary

DevPilot Desktop is a local graphical control plane. DevPilot-CLI remains the source of truth for autonomous reasoning, provider access, coordinator and executor behavior, memory, audits, reports, and runtime session state.

The desktop owns:

- the Tauri process and native desktop lifecycle;
- React/Expo desktop presentation and local navigation;
- project selection and runtime readiness presentation;
- safe child-process startup, cancellation, and reconnect behavior;
- rendering ACP session updates, tool activity, approvals, artifacts, and diagnostics;
- local desktop preferences and the explicit runtime-path override.

The desktop must not duplicate Python orchestration logic or modify the runtime repository as part of normal startup.

## Runtime flow

```text
Desktop UI
  → provider settings / selected project
  → sibling-aware runtime discovery
  → read-only readiness probe
  → DevPilot built-in ACP provider
  → devpilot acp --stdio
  → DevPilot-CLI coordinator, executors, memory, reports, and audit systems
```

Commands are spawned with an executable and argument array. Shell interpolation is disabled. ACP stdout is protocol-only; stderr carries logs and diagnostics.

## Provider integration

`devpilot` is a first-class provider ID in the shared agent catalog, not a user-authored custom ACP command. Its provider definition advertises:

- ACP session load and resume;
- runtime-provided research modes and model/config options;
- local process control and native MCP tool delivery;
- an optional machine-local executable override.

The CLI backend resolves the executable at session start so changes to local settings and virtual environments are honored without embedding machine-specific paths in shared metadata.

## Upstream relationship

The desktop shell and reusable UI/runtime infrastructure were imported from the pinned Happier baseline recorded in `HAPPIER_UPSTREAM_BASE.md`. The ignored `happier/` checkout is only a synchronization reference. Tracked imports are reproducible through the allowlisted importer and build independently of that checkout.

DevPilot-owned branding, runtime discovery, provider registration, and product workflows are preserved during upstream sync. Hosted Happier services, public web deployment, mobile releases, and upstream update endpoints are outside the desktop baseline.

## Current milestone and next slices

The current integration milestone establishes the clean desktop workspace, reproducible Happier source closure, DevPilot identity, sibling runtime detection/readiness, an official ACP bridge, and a DevPilot-native Research Run workspace.

## Research Run projection

`packages/devpilot-research` is a presentation projection, not an orchestration engine. It normalizes immutable event metadata from ACP transcript records and reduces that stream into a deterministic read-only state:

```text
DevPilot-CLI events.jsonl
  -> ACP session updates with _meta.devpilot
  -> inherited transcript persistence
  -> DevPilot event adapter
  -> immutable ResearchRunState
  -> Research cockpit
```

The projection keeps Coordinator, hypothesis, Executor, evidence, artifact, approval, file, and usage records separate. Parallel Executors are keyed independently. Reloading a stored transcript rebuilds the same state without a second desktop database. Older ACP plan transcripts can reconstruct hypothesis labels as a compatibility fallback, but provider metadata is authoritative for new sessions.

The Research tab is registered only for sessions whose built-in agent ID is `devpilot`. Existing chat, file, Git, detail, and terminal surfaces remain available and unchanged. The first tree view is deliberately read-only and highlights the best-scoring path; tree mutation remains deferred until runtime synchronization and persistence semantics are stable.

Memory search, skill inspection, audit execution, rich artifact opening, source actions, and approval decisions must continue to call DevPilot-CLI capabilities or standard ACP methods. They must not introduce competing TypeScript storage or bypass runtime permissions.
