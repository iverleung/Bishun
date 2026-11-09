import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { prepareOfflineBuild } from './offline-build.mjs';

// Retry transient directory cleanup failures; never keep stale build artifacts.
const outDir = fileURLToPath(new URL('../dist/', import.meta.url));
rmSync(outDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
await build({ build: { outDir, emptyOutDir: false, manifest: true } });
await prepareOfflineBuild(outDir);
