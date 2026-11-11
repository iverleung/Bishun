import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {characterReadings} from '../src/web/character-info.js';
import {readingRecording} from '../src/data/reading-audio.js';

// Resource availability only: dictionary candidates are not contextual teaching review.
const catalogBytes=await fs.readFile('resources/reading-audio-catalog.json');
const index=JSON.parse(await fs.readFile('resources/textbooks/pilot-v1/index.json','utf8'));
const all=new Set(),books=[],candidates=new Map();
const readingsFor=char=>{
    if(!candidates.has(char))candidates.set(char,characterReadings(char));
    return candidates.get(char);
};
function coverage(characters){
    let full=0,partial=0;const noAudio=[],noDictionary=[];
    for(const char of [...characters].sort()){
        const readings=readingsFor(char),available=readings.filter(reading=>readingRecording(reading));
        if(!readings.length)noDictionary.push(char);
        if(!available.length)noAudio.push(char);
        else if(available.length===readings.length)full++;
        else partial++;
    }
    return {characters:characters.size,full,partial,noAudioCount:noAudio.length,noDictionaryCount:noDictionary.length,noAudioCharacters:noAudio.join(''),noDictionaryCharacters:noDictionary.join('')};
}
for(const entry of index.books){
    const book=JSON.parse(await fs.readFile('resources/textbooks/pilot-v1/'+entry.id+'.json','utf8'));
    const characters=new Set();let annotatedRecords=0,annotatedWithAudio=0;
    for(const task of book.units.flatMap(unit=>unit.tasks)){
        for(const mode of ['read','write'])for(const item of task[mode]){
            characters.add(item.character);
            if(item.reading){annotatedRecords++;if(readingRecording(item.reading))annotatedWithAudio++;}
        }
        for(const word of task.words||[])for(const char of word.text)characters.add(char);
    }
    for(const char of characters)all.add(char);
    books.push({id:entry.id,title:entry.title,sourceSha256:entry.sha256,...coverage(characters),annotatedRecords,annotatedWithAudio});
}
const missing=new Map(),covered=new Set();
for(const char of [...all].sort())for(const reading of readingsFor(char)){
    if(readingRecording(reading))covered.add(reading);
    else {if(!missing.has(reading))missing.set(reading,[]);missing.get(reading).push(char);}
}
const report={schemaVersion:1,scope:'12 supplied textbooks: recognition, writing and word characters',dictionary:'cnchar 3.2.6',catalogSha256:createHash('sha256').update(catalogBytes).digest('hex'),totals:{...coverage(all),coveredReadings:covered.size,missingReadings:missing.size},books,missingReadings:[...missing].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([reading,chars])=>({reading,characters:chars.join(''),characterCount:chars.length}))};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
