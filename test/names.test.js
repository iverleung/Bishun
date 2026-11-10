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
    assert.equal(v3.getStrokeNames('宇')[2], null);
    assert.equal(v3.getStrokeName([], '宇', 2), '暂缺');
});

test('callers cannot mutate cached names', () => {
    const names = v3.getStrokeNames('水');
    names[1] = '点';
    assert.equal(v3.getStrokeNames('水')[1], '横撇');
});

test('游 resolves the reviewed 子 first stroke while retaining all twelve stroke positions', () => {
    assert.deepEqual(v3.getStrokeNames('游'),['点','点','提','点','横','横折钩','撇','撇','横','横撇','竖钩','横']);
    assert.equal(v3.getStrokeName([], '游', 9), '横撇');
    assert.equal(v3.getStrokeName([], '宇', 2), '暂缺');
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
    assert.equal(v3.getStrokeNames('宇')[2],null);
    assert.equal(audio.items.filter(item=>item.reviewStatus==='reviewed').length,30);
    assert.deepEqual(audio.items.filter(item=>item.reviewStatus==='pending-listening'),[]);
    for(const name of ['竖折撇','横折弯','横撇弯钩','横折折折钩']) {
        const item=audio.items.find(item=>item.text===name);
        assert.equal(item.reviewedAt,'2026-11-10');
        assert.equal(item.reviewMethod,'user-confirmed-grade1-listening-reel');
    }
});
