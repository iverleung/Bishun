import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从 test/run.js 中提取测试汉字
const runScriptPath = path.join(__dirname, 'run.js');
const runScriptContent = fs.readFileSync(runScriptPath, 'utf8');
const charRegex = /char:\s*'(.+?)'/g;
const chars = [];
let match;
while ((match = charRegex.exec(runScriptContent)) !== null) {
    chars.push(match[1]);
}

const dataDir = path.join(__dirname, 'data');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

async function download(char) {
    const dest = path.join(dataDir, `${char}.json`);

    // 跳过已经下载的文件
    if (fs.existsSync(dest)) {
        console.log(`⏩ Skipped ${char} (already exists)`);
        return;
    }

    // 使用 unpkg 作为源
    const url = `https://unpkg.com/hanzi-writer-data@2.0.1/${encodeURIComponent(char)}.json`;

    return new Promise((resolve, reject) => {
        const request = https.get(url, (res) => {
            if (res.statusCode !== 200) {
                // 如果 unpkg 不行，尝试备用地址
                reject(new Error(`Failed to download ${char}: ${res.statusCode}`));
                return;
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`✅ Downloaded ${char}`);
                resolve();
            });
        });

        request.on('error', (err) => {
            reject(err);
        });

        request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error(`Timeout downloading ${char}`));
        });
    });
}

async function main() {
    console.log(`🔍 Found ${chars.length} characters in test/run.js`);
    for (const char of chars) {
        try {
            await download(char);
        } catch (e) {
            console.error(`❌ Error downloading ${char}: ${e.message}`);
        }
    }
    console.log('🏁 Batch download complete.');
}

main();
