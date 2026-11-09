import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'vite';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function prepareOfflineBuild(outDir) {
    const manifest=JSON.parse(await fs.readFile(path.join(outDir,'.vite/manifest.json'),'utf8'));
    const paths=new Set(['/','/index.html','/print/index.html','/preview/index.html','/icon.png',
        '/characters/2.0.1/manifest.json','/characters/2.0.1/ARPHICPL.TXT','/characters/2.0.1/SOURCE.txt',
        '/audio/strokes/v1/manifest.json','/licenses/cnchar-LICENSE.txt','/licenses/qrcode-generator-LICENSE.txt']);
    const seen=new Set();
    function collect(key) {
        if(seen.has(key))return;seen.add(key);
        const entry=manifest[key];
        if(!entry)throw new Error(`Missing offline build entry: ${key}`);
        paths.add('/'+entry.file);
        for(const css of entry.css || [])paths.add('/'+css);
        for(const asset of entry.assets || [])paths.add('/'+asset);
        for(const imported of [...entry.imports || [],...entry.dynamicImports || []])collect(imported);
    }
    collect('index.html');collect('print/index.html');
    const files={};
    const diskPath=url=>path.join(outDir,url==='/'?'index.html':url.slice(1));
    for(const url of [...paths].sort())files[url]=hash(await fs.readFile(diskPath(url)));
    const id=hash(JSON.stringify(files));
    const home=diskPath('/');
    await fs.writeFile(home,(await fs.readFile(home,'utf8')).replace('__OFFLINE_VERSION__',id));
    files['/']=files['/index.html']=hash(await fs.readFile(home));
    await fs.writeFile(path.join(outDir,'offline-build.json'),JSON.stringify({schema:1,id,files}));
    await build({configFile:false,publicDir:false,define:{__OFFLINE_VERSION__:JSON.stringify(id)},build:{write:true,outDir,emptyOutDir:false,
        lib:{name:'BishunOfflineWorker',entry:'src/offline/worker.js',formats:['iife'],fileName:()=> 'offline-sw.js'},rollupOptions:{output:{inlineDynamicImports:true}}}});
    console.log(`Offline build ${id.slice(0,12)}: ${Object.keys(files).length} shell/metadata files; glyphs and recordings stay opt-in.`);
}
