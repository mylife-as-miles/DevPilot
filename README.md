# DevPilot Desktop

DevPilot Desktop is the graphical control plane for the independent
[DevPilot-CLI](https://github.com/mylife-as-miles/DevPilot-CLI) Python runtime.
It is a desktop-only Electron application derived in part from
[Happier](https://github.com/happier-dev/happier).

The desktop repository contains the Electron shell, React/Expo interface, local
process integration, desktop packaging, and synchronization tooling. Autonomous
reasoning, orchestration, providers, memory, audits, reports, and runtime session
state remain in DevPilot-CLI.

## Local layout

Keep the repositories as siblings:

```text
Documents/
├── DevPilot/
│   ├── happier/       # ignored upstream reference clone
│   ├── apps/
│   ├── packages/
│   ├── scripts/
│   └── docs/
└── DevPilot-CLI/      # independent Python runtime repository
```

The default development runtime path from this repository is
`..\DevPilot-CLI`. DevPilot Desktop never clones, moves, or silently installs
the Python runtime.

## Prerequisites

- Node.js 20 or newer
- Corepack with Yarn 1.22.22
- No Rust toolchain is required for the Electron desktop shell
- An existing DevPilot-CLI checkout or a globally installed `devpilot` command

Electron itself does not require the Rust or Visual C++ toolchain used by the
retired Tauri launch path.

## Development

```powershell
corepack yarn install
corepack yarn desktop:typecheck
corepack yarn desktop:test
corepack yarn desktop:dev
```

The development command starts Expo Web and Electron. It does not modify
DevPilot-CLI or create a Python environment.

Build a production desktop bundle with:

```powershell
corepack yarn desktop:build
```

## Happier upstream synchronization

The ignored `happier/` checkout is an import source, not a build dependency.
Inspect a synchronization without changing tracked files:

```powershell
node scripts/import-happier-desktop.mjs --dry-run
```

Apply reviewed, conflict-free changes with:

```powershell
node scripts/import-happier-desktop.mjs
```

See [the import plan](docs/HAPPIER_DESKTOP_IMPORT_PLAN.md),
[the dependency closure](docs/DESKTOP_DEPENDENCY_CLOSURE.md), and
[the upstream synchronization guide](docs/UPSTREAM_SYNC.md).

## Runtime boundary

Desktop runtime discovery follows this precedence:

1. explicit user-configured executable;
2. the sibling `..\DevPilot-CLI` virtual environment;
3. the currently active virtual environment;
4. `devpilot` on `PATH`.

Executable paths and arguments are always passed separately without shell
interpolation. The initial milestone uses an external runtime; bundling Python
as a sidecar is intentionally deferred.

See [the local runtime guide](docs/LOCAL_DESKTOP_RUNTIME.md) and
[the architecture boundary](docs/DEVPILOT_DESKTOP_ARCHITECTURE.md). Public web
and mobile work is recorded separately in
[the future-surfaces note](docs/FUTURE_WEB_AND_MOBILE.md).

## Licensing

DevPilot Desktop is licensed under the Apache License 2.0. Imported Happier
code retains its upstream MIT license and attribution. See [NOTICE.md](NOTICE.md),
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and
[licenses/Happier-LICENSE.txt](licenses/Happier-LICENSE.txt).
