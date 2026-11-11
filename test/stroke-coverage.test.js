import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve('.');
async function fixture(){
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bishun-stroke-gate-'));
    await fs.mkdir(path.join(directory,'resources/textbooks'),{recursive:true});
    await fs.mkdir(path.join(directory,'public'),{recursive:true});
    await fs.symlink(path.join(root,'public/characters'),path.join(directory,'public/characters'),'dir');
    for(const name of ['pilot-v1','textbook-stroke-review.json','textbook-stroke-corrections.json']){
        const source=path.join(root,'resources/textbooks',name),target=path.join(directory,'resources/textbooks',name);
        if(name==='pilot-v1')await fs.symlink(source,target,'dir');else await fs.copyFile(source,target);
    }
    await fs.copyFile(path.join(root,'resources/stroke-audio-catalog.json'),path.join(directory,'resources/stroke-audio-catalog.json'));
    return directory;
}
test('strict textbook coverage gate rejects a missing stroke recording without changing project files',async()=>{
    const directory=await fixture();
    try{
        const filename=path.join(directory,'resources/stroke-audio-catalog.json');
        const catalog=JSON.parse(await fs.readFile(filename,'utf8'));catalog.items=catalog.items.filter(item=>item.text!=='横钩');
        await fs.writeFile(filename,JSON.stringify(catalog));
        assert.throws(()=>execFileSync(process.execPath,[path.join(root,'tools/check-stroke-coverage.mjs'),'--strict'],{cwd:directory,encoding:'utf8',stdio:'pipe'}),error=>{
            assert.equal(error.status,1);assert.match(error.stderr,/教材笔画名称或录音不完整/);
            assert.ok(JSON.parse(error.stdout).totals.missingAudioCharacters>0);return true;
        });
    }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('review gate rejects changed dictionary alternatives before generating corrections',async()=>{
    const directory=await fixture();
    try{
        const filename=path.join(directory,'resources/textbooks/textbook-stroke-review.json');
        const review=JSON.parse(await fs.readFile(filename,'utf8'));review.characters[0].strokes[0].from='changed';
        await fs.writeFile(filename,JSON.stringify(review));
        assert.throws(()=>execFileSync(process.execPath,[path.join(root,'tools/prepare-stroke-corrections.mjs'),'--check'],{cwd:directory,encoding:'utf8',stdio:'pipe'}),error=>{
            assert.equal(error.status,1);assert.match(error.stderr,/字典笔画候选已变化/);return true;
        });
    }finally{await fs.rm(directory,{recursive:true,force:true});}
});
