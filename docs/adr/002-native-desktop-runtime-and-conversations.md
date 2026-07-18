# ADR 002: DevPilot-native desktop runtime and conversation domain

## Status

Accepted. This ADR supersedes the `devpilot acp --stdio` lifecycle portion of
ADR 001. Electron remains the first DevPilot desktop shell.

## Context

The first desktop milestone reused Happier's application domain as well as its
visual components. That made projects appear as task collections, started an
ACP process for individual tasks, and adapted those records to Happier session
state. Those are transport and product-domain concerns, not presentation
concerns, and they conflict with DevPilot's local coding-agent model.

Happier remains valuable as a visual/component foundation: shell layout,
sidebar interaction patterns, transcript cards, composer, review panes,
typography, themes, and animations. It is not the source of truth for local
DevPilot projects, conversations, authentication, runtime state, or Git work.

## Decision

### Product domain

DevPilot Desktop owns these concepts:

```
local project folder
  -> persistent conversation
    -> turns
      -> agent runs
        -> one persistent DevPilot SDK conversation context
```

- A **project** is a selected local folder plus lightweight metadata.
- A **conversation** is a durable coding chat attached to one project.
- A **turn** is a user message and its resulting DevPilot response.
- A **run** is the Coordinator/Executor work started by a turn.
- A **runtime session** is the SDK context behind a conversation and is reused
  for follow-up turns.

Electron may retain UI preferences such as the selected project, conversation,
panel layout, and last-used controls. The Python SDK/runtime is the source of
truth for conversations, messages, runs, checkpoints, artifacts, reports,
changes, and resume state. Project-local data belongs under
`<project>/.devpilot/`.

### Runtime protocol

The official Electron transport is a long-lived private protocol process:

```
Electron DevPilotRuntimeClient
  -> python -m devpilot.cli.app desktop-runtime --stdio
  -> devpilot.sdk
  -> Coordinator and Executors
```

The protocol is newline-delimited JSON with request, response, and event
envelopes. `stdout` contains protocol frames only; sanitized bounded
diagnostics are emitted to and continuously drained from `stderr`.

The protocol uses DevPilot-native methods and identifiers, including
`project.*`, `conversation.*`, `run.*`, `sandbox.*`, and `changes.*`. It never
exposes ACP session IDs, Happier server/machine/account identifiers, or
temporary worker IDs to the renderer.

`devpilot acp --stdio` remains supported as a separate adapter for third-party
clients. It is not used by the DevPilot desktop application and must use the
same SDK rather than becoming a second runtime.

### Authentication, models, permissions, and Git

The only first-launch identity flow is the existing local ChatGPT/Codex login.
There is no Happier account, Relay, QR/device setup, remote-machine setup,
GitHub OAuth, or cloud synchronization requirement in local desktop mode.

Models and supported reasoning levels are supplied by the runtime. Sandbox
modes are runtime-enforced, not renderer decoration:

- `read-only` permits inspection only;
- `workspace-write` permits writes inside the selected project only;
- `full-access` requires an explicit warning and approval.

Git inspection and review use the selected local repository and installed Git
executable. GitHub authentication is neither required nor requested.

### UI migration

The renderer reuses Happier-derived presentation components while replacing
the local domain with DevPilot-native screens and state:

- `DevPilotConversationSidebar` groups conversations by DevPilot state;
- `DevPilotNewConversationScreen` selects a folder without starting work;
- `DevPilotConversationView` maps structured runtime events into transcript,
  tool, command, permission, Coordinator, and Executor surfaces;
- `DevPilotReviewPanel` renders local Git/runtime changes and diffs;
- `DevPilotComposerControls` obtains provider/model/reasoning/sandbox choices
  from the runtime and sends a new turn to the selected conversation.

The renderer will explicitly allow authenticated local DevPilot routes while
retaining hosted-service guards for any future hosted mode.

### Migration and safety

Existing `devpilot-workspace.json` data is migrated once, with a versioned
marker and backup. Projects become DevPilot projects; task titles, messages,
status, and safe preferences become conversations. Stale ACP process/session
identifiers and transient worker state are intentionally discarded.

Electron keeps `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, and `webviewTag: false`. IPC and protocol inputs validate
project paths, IDs, models, reasoning levels, sandbox values, and methods.
The renderer cannot launch arbitrary executables or receive credentials,
tokens, cookies, environment dumps, or unsanitized runtime logs.

## Consequences

- The desktop path requires a migration from task/ACP records to
  project/conversation/run records.
- The Python SDK gains persistent, event-oriented conversation APIs instead
  of Electron orchestrating a new Coordinator context for each prompt.
- A single desktop runtime process may manage many conversations, reducing
  process churn and preserving context across follow-up turns.
- ACP remains available for compatible external tools, but cannot shape the
  normal desktop vocabulary, storage, UI, or diagnostics.
- Packaging must launch the bundled Python interpreter with
  `-m devpilot.cli.app desktop-runtime --stdio` and document runtime size,
  dependencies, platform constraints, and notices.

## Migration phases

1. Freeze this architecture decision.
2. Add and test the private desktop runtime protocol.
3. Replace Electron's ACP process client with `DevPilotRuntimeClient`.
4. Add persistent SDK conversation APIs.
5. Migrate task/workspace persistence with a backup.
6. Rewire sidebar, new conversation, transcript, composer, permissions, and
   review UI to the native domain.
7. Package and verify the complete local flow without Happier product services.
