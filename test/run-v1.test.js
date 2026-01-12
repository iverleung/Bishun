#!/usr/bin/env node

/**
 * 笔画识别自动化测试脚本 V1
 * 使用外部共享的 V1 识别模块
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v1 } from '../src/engine/recognition/v1.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    { char: '小', strokes: ['竖钩', '点', '点'] },
    { char: '水', strokes: ['竖钩', '横撇', '撇', '捺'] },
    { char: '火', strokes: ['点', '撇', '撇', '捺'] },
    { char: '心', strokes: ['点', '卧钩', '点', '点'] },
    { char: '中', strokes: ['竖', '横折', '横', '竖'] },
    { char: '了', strokes: ['横撇', '竖弯钩'] },
    { char: '子', strokes: ['横撇', '弯钩', '横'] },
    { char: '上', strokes: ['竖', '横', '横'] },
    { char: '下', strokes: ['横', '竖', '点'] },
    { char: '田', strokes: ['竖', '横折', '横', '竖', '横'] },
    { char: '我', strokes: ['撇', '横', '竖钩', '提', '斜钩', '撇', '点'] },
];

function runAllTests() {
    console.log('🧪 笔画识别自动化测试 V1 (Legacy)\n');
    console.log('='.repeat(50));

    let correctCount = 0;
    testData.forEach(test => {
        try {
            const dataPath = path.join(__dirname, 'data', `${test.char}.json`);
            const charData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
            const recognizedStrokes = charData.medians.map(m => v1.getStrokeName(m));

            const isCorrect = recognizedStrokes.length === test.strokes.length &&
                recognizedStrokes.every((s, i) => v1.normalizeStroke(s) === v1.normalizeStroke(test.strokes[i]));

            if (isCorrect) correctCount++;

            console.log(`${isCorrect ? '✅' : '❌'} ${test.char}`);
            console.log(`   期望: ${test.strokes.join(', ')}`);
            console.log(`   识别: ${recognizedStrokes.join(', ')}`);
        } catch (error) {
            console.log(`❌ ${test.char}: ${error.message}`);
        }
    });

    console.log('='.repeat(50));
    console.log(`📊 测试结果: ${correctCount}/${testData.length} (${((correctCount / testData.length) * 100).toFixed(1)}%)\n`);
    process.exit(correctCount < testData.length ? 1 : 0);
}

runAllTests();
