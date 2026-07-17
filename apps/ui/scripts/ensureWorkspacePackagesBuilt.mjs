import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ensureWorkspacePackagesBuiltForComponent as ensureWorkspacePackagesBuiltForComponentDefault } from '../../stack/scripts/utils/proc/pm.mjs';

const uiDir = dirname(dirname(fileURLToPath(import.meta.url)));

function isDevPilotWorkspaceRoot(rootDir) {
  try {
    const manifestPath = join(rootDir, 'package.json');
    if (!existsSync(manifestPath)) return false;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return manifest?.name === 'devpilot-desktop'
      && Array.isArray(manifest?.workspaces?.packages)
      && existsSync(join(rootDir, 'packages', 'protocol', 'package.json'));
  } catch {
    return false;
  }
}

export async function ensureUiWorkspacePackagesBuilt({
  env = process.env,
  ensureWorkspacePackagesBuiltForComponent = ensureWorkspacePackagesBuiltForComponentDefault,
} = {}) {
  // DevPilot vendors the desktop-relevant workspace packages directly. It is
  // intentionally not a full Happier services monorepo (there is no hosted
  // server package), so the upstream stack helper's `not-monorepo` result is
  // expected here and must not block Electron typechecking/builds.
  const devpilotRoot = dirname(dirname(uiDir));
  if (isDevPilotWorkspaceRoot(devpilotRoot)) {
    return { ok: true, built: [], skipped: ['devpilot-workspace'] };
  }
  const result = await ensureWorkspacePackagesBuiltForComponent(uiDir, { quiet: false, env });
  const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
  if (skipped.includes('not-monorepo')) {
    throw new Error('[ui] ensure:workspace:built failed (not-monorepo): apps/ui must be run from inside the Happier monorepo checkout.');
  }
  return result;
}

async function run() {
  await ensureUiWorkspacePackagesBuilt();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
