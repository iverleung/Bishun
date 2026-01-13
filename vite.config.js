import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDirHash(dir) {
    // ... 原有逻辑保持不变 ...
    const files = fs.readdirSync(dir, { recursive: true });
    const hash = crypto.createHash('sha256');

    files.forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isFile()) {
            const content = fs.readFileSync(fullPath);
            hash.update(file);
            hash.update(content);
        }
    });

    return hash.digest('hex').substring(0, 8);
}

export default defineConfig(() => {
    const srcHash = getDirHash(path.resolve(__dirname, 'src'));
    const buildTime = new Date().toLocaleString('zh-CN', { timeZoneName: 'short' });
    const buildInfo = `${srcHash} (${buildTime})`;

    return {
        define: {
            __BUILD_INFO__: JSON.stringify(buildInfo)
        }
    };
});
