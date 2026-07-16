# Local DevPilot desktop runtime

DevPilot Desktop and the Python runtime share this repository:

```text
C:\Users\MILES\Documents\DevPilot\
├── .venv\Scripts\devpilot.exe
├── apps\desktop\
├── apps\ui\
└── packages\devpilot-runtime\
```

The desktop never clones, creates, or moves a separate runtime repository.

## Windows discovery order

1. Explicit user-configured executable.
2. `<repo-root>\.venv\Scripts\devpilot.exe`.
3. `<repo-root>\venv\Scripts\devpilot.exe`.
4. `<repo-root>\.venv\Scripts\python.exe -m devpilot.cli.app`.
5. Global `devpilot.exe` on `PATH`.

Electron verifies the selected runtime with `devpilot --version`, lets the user select a local project, then starts ACP without a shell:

```powershell
.\.venv\Scripts\devpilot.exe acp --stdio
```

The ACP process is scoped to the selected project and is stopped when the Electron application exits. Hosted Relay, account, QR-login, and cross-device-sync flows are disabled by default for the local desktop milestone.
# Local Desktop Runtime

The desktop launches the repository-local `devpilot acp --stdio` executable.
ACP resolves the same setup and project configuration layers as the SDK, and
uses JSON-only stdout with diagnostics on sanitized stderr.
