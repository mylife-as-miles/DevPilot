# Happier Upstream Synchronization

## Purpose

`happier/` is an ignored, local reference checkout. A clean DevPilot Desktop
clone builds from tracked files and does not require the upstream checkout.

## Prepare the reference checkout

Confirm that `happier/` is clean before updating it. Never discard local work in
that checkout.

```powershell
git -C happier remote -v
git -C happier status
git -C happier fetch origin
git -C happier checkout dev
git -C happier pull --ff-only origin dev
git -C happier rev-parse HEAD
```

## Review an import

```powershell
node scripts/import-happier-desktop.mjs --dry-run
```

The importer reads only its explicit desktop allowlist. It rejects unsafe
overwrites, ignores nested repository metadata and generated output, and writes
its comparison to `docs/HAPPIER_IMPORT_REPORT.md`.

Review upstream additions, changes, deletions, local differences, and conflicts
before applying anything. The importer deliberately does not delete tracked
DevPilot files merely because upstream removed them.

## Apply an import

```powershell
node scripts/import-happier-desktop.mjs
node --test scripts/import-happier-desktop.test.mjs
```

After an import, update `docs/HAPPIER_UPSTREAM_BASE.md`, run the retained
workspace tests and type checks, inspect branding/runtime integration changes,
and commit the synchronization as its own reviewable change.

## DevPilot-owned areas

The following areas require manual reconciliation and must not be blindly
replaced by upstream content:

- `packages/branding/`
- DevPilot runtime discovery and readiness diagnostics
- the built-in DevPilot provider
- Tauri product identifiers, icons, updater settings, and desktop titles
- DevPilot-native Research Run views
- root build commands and documentation
- import state and reports
