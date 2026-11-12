import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

// Retry transient directory cleanup failures; never keep stale build artifacts.
const outDir = fileURLToPath(new URL('../dist/', import.meta.url));
rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
const base = process.env.VITE_BASE || process.argv[2] || '/';
await build({ base, build: { outDir, emptyOutDir: false, manifest: true } });
