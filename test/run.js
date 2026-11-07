#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v3 } from '../src/engine/recognition/v3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const version = process.argv[2] || 'v3';
if (version !== 'v3') {
    console.error('❌ 当前回归入口仅支持页面使用的 v3 引擎');
    process.exit(1);
}
const engine = v3;

const testData = [
    { char: '一', strokes: ['横'] },
    { char: '十', strokes: ['横', '竖'] },
    { char: '二', strokes: ['横', '横'] },
    { char: '三', strokes: ['横', '横', '横'] },
    { char: '土', strokes: ['横', '竖', '横'] },
    { char: '王', strokes: ['横', '横', '竖', '横'] },
    { char: '口', strokes: ['竖', '横折', '横'] },
    { char: '日', strokes: ['竖', '横折', '横', '横'] },
    { char: '月', strokes: ['撇', '横折钩', '横', '横'] },
    { char: '目', strokes: ['竖', '横折', '横', '横', '横'] },
    { char: '山', strokes: ['竖', '竖折', '竖'] },
    { char: '川', strokes: ['撇', '竖', '竖'] },
    { char: '工', strokes: ['横', '竖', '横'] },
    { char: '大', strokes: ['横', '撇', '捺'] },
    { char: '木', strokes: ['横', '竖', '撇', '捺'] },
    { char: '人', strokes: ['撇', '捺'] },
    { char: '八', strokes: ['撇', '捺'] },
    { char: '小', strokes: ['竖钩', '撇', '点'] },
    { char: '水', strokes: ['竖钩', '横撇', '撇', '捺'] },
    { char: '火', strokes: ['点', '撇', '撇', '捺'] },
    { char: '心', strokes: ['点', '卧钩', '点', '点'] },
    { char: '中', strokes: ['竖', '横折', '横', '竖'] },
    { char: '了', strokes: ['横撇', '竖钩'] },
    { char: '子', strokes: ['横撇', '竖钩', '横'] },
    { char: '上', strokes: ['竖', '横', '横'] },
    { char: '下', strokes: ['横', '竖', '点'] },
    { char: '田', strokes: ['竖', '横折', '横', '竖', '横'] },
    { char: '我', strokes: ['撇', '横', '竖钩', '提', '斜钩', '撇', '点'] },
    { char: '他', strokes: ['撇', '竖', '横折钩', '竖', '竖弯钩'] }, // 亻+也（5画）
    { char: '河', strokes: ['点', '点', '提', '横', '竖', '横折', '横', '竖钩'] }, // 氵+可（8画，官方标准）
    { char: '花', strokes: ['横', '竖', '竖', '撇', '竖', '撇', '竖弯钩'] }, // 艹+化（7画）
    { char: '字', strokes: ['点', '点', '横钩', '横撇', '竖钩', '横'] }, // 宀+子（6画）
    { char: '过', strokes: ['横', '竖钩', '点', '点', '横折折撇', '捺'] }, // 寸+辶（6画）
    { char: '打', strokes: ['横', '竖钩', '提', '横', '竖钩'] }, // 扌+丁（5画）
    { char: '吃', strokes: ['竖', '横折', '横', '撇', '横', '横折弯钩'] },
    { char: '林', strokes: ['横', '竖', '撇', '点', '横', '竖', '撇', '捺'] }, // 木+木（8画）
    { char: '明', strokes: ['竖', '横折', '横', '横', '撇', '横折钩', '横', '横'] }, // 日+月（8画）
    { char: '妈', strokes: ['撇点', '撇', '横', '横折', '竖折折钩', '横'] }, // 女+马（6画）
    { char: '们', strokes: ['撇', '竖', '点', '竖', '横折钩'] }, // 亻+门（5画）
    { char: '清', strokes: ['点', '点', '提', '横', '横', '竖', '横', '竖', '横折钩', '横', '横'] }, // 氵+青（11画）
    { char: '草', strokes: ['横', '竖', '竖', '竖', '横折', '横', '横', '横', '竖'] },
    { char: '家', strokes: ['点', '点', '横钩', '横', '撇', '弯钩', '撇', '撇', '撇', '捺'] },
    { char: '远', strokes: ['横', '横', '撇', '竖弯钩', '点', '横折折撇', '捺'] }, // 元+辶（7画）
    { char: '把', strokes: ['横', '竖钩', '提', '横折', '竖', '横', '竖弯钩'] }, // 扌+巴（7画）
    { char: '听', strokes: ['竖', '横折', '横', '撇', '撇', '横', '竖'] }, // 口+斤（7画）
    { char: '休', strokes: ['撇', '竖', '横', '竖', '撇', '捺'] }, // 亻+木（6画）
    { char: '线', strokes: ['撇折', '撇折', '提', '横', '横', '斜钩', '撇', '点'] },
    { char: '丝', strokes: ['撇折', '撇折', '撇折', '撇折', '横'] }
];

function runTests() {
    console.log('🧪 笔画名称回归 V3（既有样本预期，不代表规范审核）\n');
    console.log('='.repeat(50));

    let charCorrectCount = 0;
    const totalStrokes = testData.reduce((total, entry) => total + entry.strokes.length, 0);
    let correctStrokes = 0;
    const misidentifications = {};

    testData.forEach(test => {
        try {
            const dataPath = path.join(__dirname, 'data', `${test.char}.json`);
            const charData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
            if (!Array.isArray(charData.medians) || !Array.isArray(charData.strokes) ||
                charData.medians.length !== charData.strokes.length ||
                charData.strokes.length !== test.strokes.length) {
                throw new Error('Fixture 笔画路径、中心线与预期数量不一致');
            }
            const recognizedStrokes = charData.medians.map((m, i) => engine.getStrokeName(m, test.char, i));

            // 字级统计
            const isCharCorrect = recognizedStrokes.length === test.strokes.length &&
                recognizedStrokes.every((s, i) => s === test.strokes[i]);
            if (isCharCorrect) charCorrectCount++;

            // 笔画级统计
            test.strokes.forEach((expected, i) => {
                const actual = recognizedStrokes[i];
                if (actual === expected) {
                    correctStrokes++;
                } else {
                    const key = `${expected} ➔ ${actual || '无法识别'}`;
                    misidentifications[key] = (misidentifications[key] || 0) + 1;
                }
            });

            console.log(`${isCharCorrect ? '✅' : '❌'} ${test.char} [${recognizedStrokes.join(', ')}]`);
            if (!isCharCorrect) {
                console.log(`   期望: ${test.strokes.join(', ')}`);
            }
        } catch (error) {
            console.log(`❌ ${test.char}: ${error.message}`);
        }
    });

    console.log('\n' + '='.repeat(50));

    if (Object.keys(misidentifications).length > 0) {
        console.log('❌ 误识别笔画统计 (从小到大排序):');
        Object.entries(misidentifications)
            .sort((a, b) => a[1] - b[1])
            .forEach(([error, count]) => {
                console.log(`   ${count.toString().padStart(3)} 次: ${error}`);
            });
        console.log('');
    }

    console.log(`📊 字级通过率: ${charCorrectCount}/${testData.length} (${((charCorrectCount / testData.length) * 100).toFixed(1)}%)`);
    console.log(`📊 笔画识别率: ${correctStrokes}/${totalStrokes} (${((correctStrokes / totalStrokes) * 100).toFixed(1)}%)`);
    console.log('='.repeat(50) + '\n');

    process.exitCode = charCorrectCount < testData.length ? 1 : 0;
}

runTests();
