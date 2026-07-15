import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function resolveCorepackCommand(args, options = {}) {
  const nodePath = options.nodePath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const entrypoint = options.entrypoint ?? join(
    dirname(nodePath),
    'node_modules',
    'corepack',
    'dist',
    'corepack.js',
  );

  if (existsSync(entrypoint)) {
    return { command: nodePath, args: [entrypoint, ...args] };
  }

  return {
    command: platform === 'win32' ? 'corepack.cmd' : 'corepack',
    args: [...args],
  };
}
