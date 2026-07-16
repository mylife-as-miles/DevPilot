# ADR 001: Electron for the first DevPilot desktop milestone

## Status

Accepted.

## Decision

DevPilot Desktop uses Electron for the first local-first desktop milestone. The React/Expo Web renderer remains shared UI code; Electron owns the trusted main process, project-picker dialog, DevPilot runtime discovery, and `devpilot acp --stdio` process lifecycle through a narrow preload bridge.

## Consequences

- Electron has a larger installer and memory footprint than Tauri.
- Preload and IPC boundaries require explicit sender validation and must never expose Node or secrets to the renderer.
- The upstream Happier Tauri integration remains in the repository for synchronization compatibility but is not the shipping desktop shell.
- Updater, signing, and installer infrastructure follow Electron Forge rather than Tauri tooling.
- The Expo Web renderer can still be reused by future web or mobile clients; desktop-specific behavior stays behind the Electron bridge.
