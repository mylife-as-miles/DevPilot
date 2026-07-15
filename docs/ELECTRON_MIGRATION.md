# Electron Desktop Shell

DevPilot Desktop now uses Electron as its active desktop shell. The React/Expo application remains in `apps/ui`; Electron owns the native window, the isolated preload boundary, local production web serving, and operating-system packaging.

## Local development

```powershell
cd C:\Users\MILES\Documents\DevPilot
corepack yarn install
corepack yarn desktop:dev
```

`desktop:dev` starts Expo Web on `127.0.0.1:8081`, waits for it, and starts Electron against that local URL. It does not need Rust, Cargo, Tauri, or any change to the sibling `DevPilot-CLI` repository.

## Production package

```powershell
corepack yarn desktop:build
```

The build exports Expo Web into `apps/ui/dist`, adds that export as an Electron resource, and invokes Electron Forge. Forge creates a Windows Squirrel installer on Windows and ZIP artifacts on macOS/Linux. Production signing, notarization, and publishing remain CI configuration work; no signing credentials are stored in this repository.

## Security boundary

Electron runs the renderer with context isolation, sandboxing, disabled Node integration, disabled `<webview>`, denied browser permissions, and a narrow preload API. The preload exposes only runtime metadata and HTTPS/mailto external-link opening. It does not expose `ipcRenderer`, filesystem access, shell execution, or DevPilot credentials.

The production renderer is served only from an in-process loopback server. Navigation away from the trusted local origin is blocked, and new windows are denied after safe external links are delegated to the operating system.

## Transitional scope

The inherited Tauri source remains tracked as an upstream-compatibility reference while Electron is adopted as the root development and packaging path. Tauri-only tray, updater, pet overlay, and system-task adapters are not enabled by Electron yet. They must be ported behind explicit, reviewed preload methods; do not re-enable Node integration or expose generic IPC to shortcut that work.
