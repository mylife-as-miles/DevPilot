#!/usr/bin/env node

import { runDesktopCommand } from './desktop-command.mjs';

try {
  await runDesktopCommand('build');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
