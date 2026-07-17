import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
const requestedHeap = Number.parseInt(process.env.DEVPILOT_UI_TYPECHECK_HEAP_MB ?? '', 10);
const heapMb = Number.isFinite(requestedHeap) && requestedHeap >= 4096 ? requestedHeap : 8192;
const existing = String(process.env.NODE_OPTIONS ?? '').trim();
const heapOption = `--max-old-space-size=${heapMb}`;
const env = {
    ...process.env,
    NODE_OPTIONS: existing.includes('--max-old-space-size') ? existing : `${existing} ${heapOption}`.trim(),
};

const child = spawn(process.execPath, [tsc, '-p', 'tsconfig.json', '--noEmit'], {
    cwd: process.cwd(),
    env,
    shell: false,
    stdio: 'inherit',
});

child.once('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
});
