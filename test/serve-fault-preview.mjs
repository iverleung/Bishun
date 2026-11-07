import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Test-only loopback server: first character request fails, retry succeeds.
const root = fileURLToPath(new URL('../dist/', import.meta.url)).replace(/\/$/, '');
const port = Number(process.argv[2] || 5187);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
if (!fs.existsSync(path.join(root, 'preview/index.html'))) throw new Error('Run npm run build first');
const counts = new Map();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg' };
const faults = new Map([
    ['/characters/2.0.1/木.json', '404'],
    ['/characters/2.0.1/水.json', 'html'],
    ['/characters/2.0.1/心.json', 'timeout']
]);
http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const count = (counts.get(pathname) || 0) + 1;
    counts.set(pathname, count);
    response.setHeader('Cache-Control', 'no-store');
    const fault = faults.get(pathname);
    if (fault && count === 1) {
     console.log('FAULT',fault,pathname);
     if (fault === '404') { response.writeHead(404); response.end('missing'); return; }
     if (fault === 'html') { response.setHeader('Content-Type', 'text/html'); response.end('<html>fallback</html>'); return; }
     setTimeout(() => { if (!response.destroyed) { response.writeHead(504); response.end(); } }, 5500);
     return;
    }
    if (pathname.endsWith('.mp3')) { console.log('FAULT audio',pathname); response.setHeader('Content-Type','audio/mpeg'); response.end('bad recording'); return; }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type',types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Fault preview http://127.0.0.1:${port}/preview/index.html`));
