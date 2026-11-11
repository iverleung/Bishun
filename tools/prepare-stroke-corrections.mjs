import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import cnchar from 'cnchar';
import order from 'cnchar-order';
cnchar.use(order);
// Only names/indexes ship to browsers; original-page evidence stays in the review file.
const bytes=await fs.readFile('resources/textbooks/textbook-stroke-review.json');
const review=JSON.parse(bytes);
const books=JSON.parse(await fs.readFile('resources/textbooks/pilot-v1/index.json','utf8')).books;
for(const book of review.books){
    if(books.find(entry=>entry.id===book.id)?.sha256!==book.sha256)throw new Error('教材版本已变化，需重新核验笔画记录');
}
const characters={};
for(const entry of review.characters){
    if(characters[entry.character])throw new Error('笔画核验记录重复');
    const glyph=await fs.readFile(`public/characters/2.0.1/${entry.character}.json`);
    if(createHash('sha256').update(glyph).digest('hex')!==entry.glyphSha256)throw new Error('字形版本已变化：'+entry.character);
    const original=cnchar.stroke(entry.character,'order','name')[0];
    if(original?.length!==entry.strokeCount)throw new Error('字典笔画数量已变化：'+entry.character);
    const strokes={};
    for(const stroke of entry.strokes){
        if(!Number.isInteger(stroke.index)||stroke.index<0||stroke.index>=entry.strokeCount||!stroke.name||strokes[stroke.index])throw new Error('笔画核验尚未完成');
        if(original[stroke.index]!==stroke.from)throw new Error('字典笔画候选已变化：'+entry.character);
        strokes[stroke.index]=stroke.name;
    }
    characters[entry.character]=strokes;
}
const text=JSON.stringify({schemaVersion:1,reviewSha256:createHash('sha256').update(bytes).digest('hex'),characters})+'\n';
const target='resources/textbooks/textbook-stroke-corrections.json';
if(process.argv.includes('--check')){
    if(await fs.readFile(target,'utf8')!==text)throw new Error('笔画修正与核验记录不一致，请显式重制并审核');
}else await fs.writeFile(target,text);
console.log(`${Object.keys(characters).length} textbook character corrections ${process.argv.includes('--check')?'verified':'prepared'}.`);
