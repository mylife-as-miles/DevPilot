# Desktop local session resume

The Python runtime remains the source of truth for research artifacts and
checkpoints. ACP session IDs are process-local and cannot be reused after an
Electron restart. The desktop persists only safe project/session metadata,
validates that project on restart, then launches a fresh ACP process and marks
the former ACP ID as historical.

Until the durable `session/list`, `session/load`, and `session/resume` ACP
extensions are added, this restores the local connection rather than claiming
that an in-progress Coordinator run was resumed. A future runtime resume must
use the DevPilot checkpoint/workspace reference, not an Electron-owned copy of
messages or artifacts.

The reconnect path validates the persisted project directory, starts a new ACP
process, and then creates a new ACP session. The deterministic ACP process
integration test verifies the fresh-process/fresh-session half of that
contract; checkpoint restoration remains deferred.
