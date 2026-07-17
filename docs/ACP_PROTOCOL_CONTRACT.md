# DevPilot ACP protocol contract

DevPilot ACP is a local, newline-delimited JSON-RPC 2.0 transport. It is
started only by the desktop bridge as `devpilot acp --stdio`.

## Framing and streams

Each non-empty stdout line is one JSON object containing either a JSON-RPC
response (`id` plus `result`/`error`) or a notification (`method` plus
`params`). Stdout contains protocol frames only. Diagnostics, warnings, status
text, and tracebacks are written to stderr.

## Supported methods

- `initialize` → `{ protocolVersion: 1, authMethods: [] }`
- `session/new` with `{ cwd }` → `{ sessionId }`
- `session/prompt` with `{ sessionId, prompt: { text }, options? }` → final
  `{ stopReason: "end_turn" | "cancelled" }`
- `session/cancel` with `{ sessionId }` → `{ status: "idle" | "cancelled" }`
- `devpilot/preflight` with `{ cwd, options? }` → `{ ready, checks }`

`session/update` notifications retain compatible ACP content and carry
DevPilot-specific structured data under `update._meta.devpilot`. Sensitive
configuration fields are redacted before protocol serialization.

Cancellation is cooperative: the SDK asks the Coordinator to preserve a
checkpoint before cancelling its active task. The desktop may force-stop a
dead ACP process only during shutdown/restart, never as normal Abort behavior.

## Verification status

The process contract is integration-tested against the repository-local Python
executable with an opt-in deterministic runtime fixture. That fixture is only
selected by `DEVPILOT_ACP_TEST_MODE=1` in the test process; it does not add a
public ACP method or alter production provider selection. The test verifies
preflight, runtime notifications, final response, cancellation acknowledgement,
JSON-RPC-only stdout, stderr consumption, and restart with a fresh session.
