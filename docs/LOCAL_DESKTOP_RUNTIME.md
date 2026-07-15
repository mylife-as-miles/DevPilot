# Local Desktop Runtime

DevPilot Desktop controls an existing DevPilot-CLI installation. The Python runtime is not copied into, created by, or managed from this repository.

## Repository boundary

The supported development layout is:

```text
C:\Users\MILES\Documents\
├── DevPilot\
│   ├── happier\
│   ├── apps\
│   ├── packages\
│   ├── scripts\
│   └── docs\
└── DevPilot-CLI\
```

`happier/` is an ignored upstream reference checkout. `DevPilot-CLI` is an independent sibling Git repository. Desktop development and build commands never clone, move, install, or write into the sibling repository.

## Discovery order

Runtime discovery is implemented by `packages/devpilot-runtime` and stops at the first runnable candidate:

1. the executable selected in DevPilot provider settings;
2. the sibling repository at `../DevPilot-CLI`;
3. the active environment identified by `VIRTUAL_ENV`;
4. the global `devpilot` command on `PATH`.

On Windows, the sibling candidates are checked in this exact order:

```text
..\DevPilot-CLI\.venv\Scripts\devpilot.exe
..\DevPilot-CLI\venv\Scripts\devpilot.exe
..\DevPilot-CLI\.venv\Scripts\python.exe
..\DevPilot-CLI\venv\Scripts\python.exe
```

When only Python is present, the desktop launches `python -m devpilot.cli.app`; it does not use a shell command string.

## Readiness checks

Before starting work, the runtime probe can verify:

- `devpilot --version` succeeds and returns a version;
- root help exposes the `acp` command;
- the virtual environment uses Python 3.10 or newer when its interpreter is identifiable;
- the selected project directory is readable.

The checks are read-only and do not start ACP. Runtime sessions use the official stdio transport:

```text
devpilot acp --stdio
```

Protocol stdout is reserved for ACP frames. Runtime diagnostics are emitted on stderr.

## Sessions, logs, and recovery

The desktop starts one ACP process for the selected DevPilot provider session. The ACP adapter starts the runtime with an argument array and a validated project working directory; it never invokes a shell. Durable DevPilot run state remains under the selected project's `.devpilot/sessions/` directory. The ACP session index is stored by DevPilot-CLI in its own user configuration directory.

Runtime event records are tailed from the durable session `events.jsonl` file and forwarded as standard ACP updates. DevPilot metadata is attached under `_meta.devpilot`; credentials and credential-shaped fields are redacted before they reach the desktop. Ordinary CLI logs and child-process diagnostics are forwarded to stderr, keeping ACP stdout framing clean.

On cancellation, the adapter first sends the platform's graceful interrupt signal to the child process and waits for checkpoint shutdown. Termination and then process kill are bounded fallbacks, not the first strategy. The run name, transcript, event log, idea tree, evidence, and checkpoint remain on disk. ACP load/resume restores the stored session and the next prompt starts the CLI with `--resume`.

If the desktop or runtime crashes, restart the desktop, select the same project, and resume the stored DevPilot session. Readiness probing is safe to rerun because it performs version/help checks only. A failed probe must not mutate the sibling checkout or its virtual environment.

## Manual override and recovery

Set the provider's **DevPilot executable path** only when automatic discovery is unsuitable. The equivalent development environment variable is `DEVPILOT_EXECUTABLE_PATH`. Relative configured paths resolve from `DEVPILOT_DESKTOP_ROOT`; the root desktop commands set that variable explicitly.

If detection fails:

1. confirm the sibling checkout still exists at `../DevPilot-CLI`;
2. confirm one of its virtual environments contains `devpilot` or Python;
3. run the runtime's own editable installation inside that repository if necessary;
4. select a valid executable in provider settings and retry detection.

Do not create a nested `DevPilot-CLI/` directory in this repository as a recovery step.
