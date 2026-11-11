import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import cnchar from 'cnchar';
import grade1Review from '../resources/textbooks/grade1-stroke-review.json' with {type:'json'};
import { v3 } from '../src/engine/recognition/v3.js';

test('missing characters and out-of-range indexes do not become a dot', () => {
    for (const char of ['', null, '木水', '🙂', '𠮷']) {
        assert.equal(v3.getStrokeName([], char, 0), '暂缺');
    }
    for (const index of [-1, 1.5, 20]) assert.equal(v3.getStrokeName([], '木', index), '暂缺');
});

test('unreviewed ambiguous alternatives remain unknown', () => {
    assert.equal(v3.getStrokeNames('戋')[2], null);
    assert.equal(v3.getStrokeName([], '戋', 2), '暂缺');
});

test('callers cannot mutate cached names', () => {
    const names = v3.getStrokeNames('水');
    names[1] = '点';
    assert.equal(v3.getStrokeNames('水')[1], '横撇');
});

test('游 resolves the reviewed 子 first stroke while retaining all twelve stroke positions', () => {
    assert.deepEqual(v3.getStrokeNames('游'),['点','点','提','点','横','横折钩','撇','撇','横','横撇','竖钩','横']);
    assert.equal(v3.getStrokeName([], '游', 9), '横撇');
    assert.equal(v3.getStrokeName([], '戋', 2), '暂缺');
});

test('grade-one reviewed corrections remain bound to original alternatives and exact textbook snapshots', async () => {
    assert.equal(grade1Review.schemaVersion,1);
    assert.equal(grade1Review.characters.length,156);
    assert.equal(new Set(grade1Review.characters.map(entry=>entry.character)).size,156);
    assert.equal(grade1Review.characters.reduce((n,entry)=>n+entry.strokes.length,0),180);
    const scoped=new Set();
    for(const book of grade1Review.books){
        const bytes=await fs.readFile(`resources/textbooks/pilot-v1/${book.id}.json`);
        assert.equal(createHash('sha256').update(bytes).digest('hex'),book.sha256);
        for(const unit of JSON.parse(bytes).units)for(const task of unit.tasks)for(const entry of [...task.read,...task.write])scoped.add(entry.character);
    }
    for(const entry of grade1Review.characters){
        assert.ok(scoped.has(entry.character));
        assert.equal(entry.ucs,entry.character.codePointAt(0).toString(16).toUpperCase().padStart(5,'0'));
        assert.ok(Number.isInteger(entry.pdfPage)&&entry.pdfPage>0);
        const original=cnchar.stroke(entry.character,'order','name')[0];
        assert.equal(original.length,entry.strokeCount);
        assert.equal(new Set(entry.strokes.map(s=>s.index)).size,entry.strokes.length);
        for(const stroke of entry.strokes){
            assert.equal(original[stroke.index],stroke.from,`${entry.character} original stroke ${stroke.index+1} changed`);
            assert.ok(stroke.from.split('|').includes(stroke.name));
            assert.equal(v3.getStrokeNames(entry.character)[stroke.index],stroke.name);
        }
    }
});

test('every character in the two integrated books has matching stroke counts and a recording for every resolved name', async () => {
    const manifest=JSON.parse(await fs.readFile('public/characters/2.0.1/manifest.json','utf8'));
    const counts=new Map(Array.from(manifest.characters,(character,i)=>[character,manifest.strokeCounts[i]]));
    const audio=JSON.parse(await fs.readFile('public/audio/strokes/v1/manifest.json','utf8'));
    const recordings=new Set(audio.items.map(item=>item.text));
    for(const {id} of grade1Review.books){
        const book=JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${id}.json`,'utf8'));
        const chars=new Set(book.units.flatMap(unit=>unit.tasks.flatMap(task=>[...task.read,...task.write].map(entry=>entry.character))));
        for(const char of chars){
            const names=v3.getStrokeNames(char);
            assert.equal(names.length,counts.get(char),`${char} stroke count mismatch`);
            assert.ok(names.every(name=>name&&recordings.has(name)),`${char} has unresolved or unrecorded strokes`);
        }
    }
    assert.deepEqual(v3.getStrokeNames('学').slice(4,6),['横钩','横撇']);
    assert.equal(v3.getStrokeNames('感')[6],'斜钩');
    assert.equal(v3.getStrokeNames('感')[10],'卧钩');
    assert.equal(v3.getStrokeNames('戋')[2],null);
    assert.equal(audio.items.filter(item=>item.reviewStatus==='reviewed').length,30);
    assert.deepEqual(audio.items.filter(item=>item.reviewStatus==='pending-listening').map(item=>item.text),['竖折折']);
    for(const name of ['竖折撇','横折弯','横撇弯钩','横折折折钩']) {
        const item=audio.items.find(item=>item.text===name);
        assert.equal(item.reviewedAt,'2026-11-10');
        assert.equal(item.reviewMethod,'user-confirmed-grade1-listening-reel');
    }
});


test('reported 婆 and 饼 resolve all exact stroke positions with existing reviewed recordings',async()=>{
    const recordings=new Set(JSON.parse(await fs.readFile('resources/stroke-audio-catalog.json','utf8')).items.map(item=>item.text));
    const expected={'婆':['点','点','提','横钩','撇','竖','横撇','捺','撇点','撇','横'],'饼':['撇','横钩','竖提','点','撇','横','横','撇','竖']};
    for(const [character,names] of Object.entries(expected)){
        const data=JSON.parse(await fs.readFile(`public/characters/2.0.1/${character}.json`,'utf8'));
        assert.deepEqual(v3.getStrokeNames(character),names);assert.equal(names.length,data.strokes.length);
        assert.ok(names.every(name=>recordings.has(name)));
    }
    assert.equal(cnchar.stroke('婆','order','name')[0][3],'横撇|横钩');
    assert.equal(cnchar.stroke('婆','order','name')[0][6],'横撇|横钩');
    assert.equal(cnchar.stroke('饼','order','name')[0][1],'横撇|横钩');
    assert.equal(v3.getStrokeNames('戋')[2],null);
});


test('textbook stroke availability snapshot matches current corrections and audio catalog',async()=>{
    const {execFileSync}=await import('node:child_process');
    const expected=JSON.parse(await fs.readFile('docs/教材笔画播报覆盖检查-2026-11-11.json','utf8'));
    const actual=JSON.parse(execFileSync(process.execPath,['tools/check-stroke-coverage.mjs'],{encoding:'utf8'}));
    assert.deepEqual(actual,expected);assert.equal(actual.totals.characters,2983);
    assert.equal(actual.totals.missingAudioCharacters,0);assert.equal(actual.totals.countMismatches,0);
    assert.ok(actual.unresolved.every(item=>!['婆','饼'].includes(item.character)));
});


test('all textbook stroke reviews bind source alternatives, glyph hashes and explicit corrected names',async()=>{
    const review=JSON.parse(await fs.readFile('resources/textbooks/textbook-stroke-review.json','utf8'));
    assert.equal(review.characters.length,701);assert.equal(review.characters.reduce((n,e)=>n+e.strokes.length,0),819);
    const textbookCharacters=new Set();
    for(const book of review.books){
        const bytes=await fs.readFile(`resources/textbooks/pilot-v1/${book.id}.json`);
        assert.equal(createHash('sha256').update(bytes).digest('hex'),book.sha256);
        for(const task of JSON.parse(bytes).units.flatMap(u=>u.tasks)){
            for(const item of [...task.read,...task.write])textbookCharacters.add(item.character);
            for(const word of task.words||[])for(const c of word.text)textbookCharacters.add(c);
        }
    }
    const available=new Set(JSON.parse(await fs.readFile('resources/stroke-audio-catalog.json','utf8')).items.map(item=>item.text));
    for(const entry of review.characters){
        assert.ok(textbookCharacters.has(entry.character));assert.equal(entry.ucs,entry.character.codePointAt(0).toString(16).toUpperCase().padStart(5,'0'));
        const bytes=await fs.readFile(`public/characters/2.0.1/${entry.character}.json`);
        assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.glyphSha256);
        assert.equal(JSON.parse(bytes).strokes.length,entry.strokeCount);assert.equal(entry.standardCodes.length,entry.strokeCount);
        assert.ok(entry.pdfPage>0);assert.equal(entry.sourceClip.length,4);
        assert.equal(new Set(entry.strokes.map(s=>s.index)).size,entry.strokes.length);
        const original=cnchar.stroke(entry.character,'order','name')[0];
        for(const stroke of entry.strokes){
            assert.equal(original[stroke.index],stroke.from);assert.equal(v3.getStrokeNames(entry.character)[stroke.index],stroke.name);
            assert.ok(available.has(stroke.name));assert.equal(entry.standardCodes[stroke.index],'5');
            if(!stroke.from.split('|').includes(stroke.name)){
                assert.equal(entry.character,'互');assert.equal(stroke.index,2);assert.equal(stroke.name,'横折');assert.ok(stroke.reason);
            }
        }
    }
    assert.equal(textbookCharacters.size,2983);
    for(const c of textbookCharacters){assert.ok(v3.getStrokeNames(c).every(name=>name&&available.has(name)),c);}
    assert.equal(v3.getStrokeNames('戋')[2],null);
});
