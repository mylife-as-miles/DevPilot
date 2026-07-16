# DevPilot Desktop

DevPilot Desktop is the local graphical control plane for the Python DevPilot
runtime in this repository. It is an Electron application derived in part from
[Happier](https://github.com/happier-dev/happier).

The root `src/` directory remains the Python DevPilot package, including the
Coordinator, Executors, runtime, and SDK. The Happier-derived desktop shell is
under `apps/desktop/`; inherited `@happier-dev/*` packages remain temporary
internal TypeScript dependencies for this milestone.

## Local layout

```text
C:\Users\MILES\Documents\DevPilot\
|- .venv\Scripts\devpilot.exe
|- src\                 # Python DevPilot runtime and SDK
|- apps\desktop\        # Electron shell and typed bridge
|- apps\ui\             # Happier-derived renderer
`- packages\             # temporary internal dependencies
```

The desktop runs the repository-local executable at
`C:\Users\MILES\Documents\DevPilot\.venv\Scripts\devpilot.exe`. It never
searches for, clones, or depends on a sibling DevPilot runtime repository.

## Development

Prerequisites: Node.js 20+, Corepack with Yarn 1.22.22, and the local Python
virtual environment above. Rust and Cargo are not required.

```powershell
corepack yarn install
corepack yarn desktop:typecheck
corepack yarn desktop:test
corepack yarn desktop:dev
```

`desktop:dev` starts Expo Web and Electron. The Electron main process invokes
`devpilot acp --stdio` using an executable and argument array, never a shell.

Build a production bundle with:

```powershell
corepack yarn desktop:build
```

## Runtime boundary

```text
apps/desktop
  -> typed desktop client
  -> devpilot acp --stdio
  -> devpilot.sdk
  -> Coordinator / Executors / runtime
```

Runtime discovery prefers an explicit local override, then this repository's
`.venv`, then `venv`, and finally `devpilot` on `PATH`. ACP stdout is
protocol-only; diagnostics use stderr.

## Happier synchronization

The ignored `happier/` checkout is an import source, not a build dependency.
Inspect a synchronization with `node scripts/import-happier-desktop.mjs
--dry-run`; apply reviewed changes with `node scripts/import-happier-desktop.mjs`.

DevPilot is licensed under Apache-2.0. Imported Happier code retains its MIT
license and attribution; see [NOTICE.md](NOTICE.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
