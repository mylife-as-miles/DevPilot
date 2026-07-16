# Electron Desktop Shell

DevPilot Desktop uses Electron from `apps/desktop`. The React/Expo renderer
remains in `apps/ui`; Electron owns the native window, isolated preload
boundary, local production web serving, and operating-system packaging.

## Local development

```powershell
cd C:\Users\MILES\Documents\DevPilot
corepack yarn install
corepack yarn desktop:dev
```

The command starts Expo Web on `127.0.0.1:8081`, waits for it, then starts the
Electron shell against that local URL. It uses the repository-local DevPilot
runtime and does not require Rust, Cargo, Tauri, or a sibling repository.

## Production package

```powershell
corepack yarn desktop:build
```

The build exports the UI to `apps/ui/dist`, packages it as an Electron
resource, and invokes Electron Forge. Production signing, notarization, and
publishing remain CI configuration work; no credentials are stored here.

## Security boundary

Electron uses context isolation, disabled Node integration, sandboxing, no
`<webview>`, denied browser permissions, and a narrow typed preload API. The
renderer cannot access `ipcRenderer`, files, shell execution, or DevPilot
credentials directly.
