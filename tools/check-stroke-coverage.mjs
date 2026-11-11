import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import cnchar from 'cnchar';
import {v3} from '../src/engine/recognition/v3.js';
const index=JSON.parse(await fs.readFile('resources/textbooks/pilot-v1/index.json','utf8'));
const manifest=JSON.parse(await fs.readFile('public/characters/2.0.1/manifest.json','utf8'));
const counts=new Map(Array.from(manifest.characters,(c,i)=>[c,manifest.strokeCounts[i]]));
const audioBytes=await fs.readFile('resources/stroke-audio-catalog.json');
const recordings=new Set(JSON.parse(audioBytes).items.map(item=>item.text));
const characters=new Set();
for(const {id} of index.books){
    const book=JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${id}.json`,'utf8'));
    for(const task of book.units.flatMap(unit=>unit.tasks)){
        for(const item of [...task.read,...task.write])characters.add(item.character);
        for(const word of task.words||[])for(const c of word.text)characters.add(c);
    }
}
const unresolved=[],missingAudio=[],countMismatches=[];
let complete=0,unresolvedPositions=0;
for(const c of [...characters].sort()){
    const names=v3.getStrokeNames(c),count=counts.get(c);
    if(names.length!==count){countMismatches.push({character:c,glyphCount:count??null,nameCount:names.length});continue;}
    const raw=cnchar.stroke(c,'order','name')[0];
    const missing=names.flatMap((name,index)=>name?[]:[{index:index+1,candidates:raw?.[index]??null}]);
    if(missing.length){unresolved.push({character:c,positions:missing});unresolvedPositions+=missing.length;}
    const absent=names.flatMap((name,index)=>name&&!recordings.has(name)?[{index:index+1,name}]:[]);
    if(absent.length)missingAudio.push({character:c,positions:absent});
    if(!missing.length&&!absent.length)complete++;
}
process.stdout.write(JSON.stringify({schemaVersion:1,scope:'12 supplied textbooks including word characters; name/resource completeness, not full teaching review',audioCatalogSha256:createHash('sha256').update(audioBytes).digest('hex'),books:index.books.map(({id,sha256})=>({id,sha256})),totals:{characters:characters.size,complete,unresolvedCharacters:unresolved.length,unresolvedPositions,missingAudioCharacters:missingAudio.length,countMismatches:countMismatches.length},unresolved,missingAudio,countMismatches},null,2)+'\n');

if (process.argv.includes('--strict') && (unresolved.length || missingAudio.length || countMismatches.length)) {
    console.error('教材笔画名称或录音不完整，请先核验修复。');
    process.exitCode=1;
}
