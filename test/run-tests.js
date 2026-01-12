#!/usr/bin/env node

/**
 * 笔画识别自动化测试脚本
 * 简化版算法：先保证基础笔画正确，再逐步添加复合笔画
 */

const fs = require('fs');
const path = require('path');

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

function loadCharacterData(char) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', `${char}.json`), 'utf-8'));
}

function getStrokeName(median) {
    if (!median || median.length < 2) return '点';

    const n = median.length;
    const dx = median[n - 1][0] - median[0][0];
    const dy = median[n - 1][1] - median[0][1];
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const length = Math.sqrt(dx * dx + dy * dy);

    // 点
    if (length < 100) return '点';
    if (length < 260 && n <= 5 && absDx < 200 && absDy < 280) return '点';

    // 复合笔画检测 - 需要有真正的方向变化
    if (n >= 6 && length > 350) {
        const t1 = Math.floor(n / 3);
        const t2 = Math.floor(n * 2 / 3);
        const firstDx = median[t1][0] - median[0][0];
        const firstDy = median[t1][1] - median[0][1];
        const lastDx = median[n - 1][0] - median[t2][0];
        const lastDy = median[n - 1][1] - median[t2][1];

        // 计算前后段主方向是否有显著变化
        const firstMainlyHoriz = Math.abs(firstDx) > Math.abs(firstDy) * 1.5;
        const firstMainlyVert = Math.abs(firstDy) > Math.abs(firstDx) * 1.5;
        const lastMainlyHoriz = Math.abs(lastDx) > Math.abs(lastDy) * 1.5;
        const lastMainlyVert = Math.abs(lastDy) > Math.abs(lastDx) * 1.5;

        // 横折：前段明确向右,后段明确向下
        if (firstMainlyHoriz && firstDx > 0 && lastMainlyVert && lastDy < 0) {
            const hookDx = median[n - 1][0] - median[n - 2][0];
            const hookDy = median[n - 1][1] - median[n - 2][1];
            if (hookDx < -50 && hookDy > 0) return '横折钩';
            return '横折';
        }

        // 竖折：前段明确向下,后段明确向右（后段几乎水平）
        // 区分捺：捺是连续斜向右下，后段也会向下
        if (firstMainlyVert && firstDy < 0 && lastMainlyHoriz && lastDx > 0 && lastDy > -50) {
            return '竖折';
        }

        // 横撇：前段向右,后段向左下（需要明确的方向变化）
        if (firstDx > 0 && firstMainlyHoriz && lastDx < 0 && lastDy < 0) {
            return '横撇';
        }
    }

    // 短横撇（如 了 的第一笔）：整体先右后左下
    if (n >= 5 && length > 250) {
        const midIdx = Math.floor(n / 2);
        const firstDx = median[midIdx][0] - median[0][0];
        const lastDx = median[n - 1][0] - median[midIdx][0];
        const lastDy = median[n - 1][1] - median[midIdx][1];
        // 前半向右,后半向左下
        if (firstDx > 50 && lastDx < -50 && lastDy < 0) {
            return '横撇';
        }
    }

    // 带钩的笔画（检查末端方向改变）
    // 要求钩有足够长度，避免把略带上翘的横误判为卧钩
    if (n >= 5) {
        const hookDx = median[n - 1][0] - median[n - 2][0];
        const hookDy = median[n - 1][1] - median[n - 2][1];
        const hookLen = Math.sqrt(hookDx * hookDx + hookDy * hookDy);

        const mainDx = median[Math.floor(n * 0.7)][0] - median[0][0];
        const mainDy = median[Math.floor(n * 0.7)][1] - median[0][1];

        // 钩需要足够明显（长度>60）且方向向上
        if (hookLen > 60 && hookDy > 20) {
            // 竖钩：主体主要向下
            if (mainDy < -Math.abs(mainDx) * 2 && hookDx < 0) return '竖钩';
            // 斜钩：主体向右下
            if (mainDx > 0 && mainDy < 0) return '斜钩';
            // 竖弯钩：主体向下,钩向右上
            if (mainDy < 0 && hookDx > 0) return '竖弯钩';
            // 卧钩：主体偏横,钩明显向上
            if (Math.abs(mainDx) > Math.abs(mainDy) && hookDy > 30) return '卧钩';
            // 弯钩
            if (mainDy < 0 && hookDx < 0) return '弯钩';
        }
    }

    // 基础笔画
    // 横：向右且基本水平
    if (dx > 0 && absDx > absDy * 3) return '横';
    // 提：向右上，有明显上升趋势
    if (dx > 0 && dy > 0 && absDy > absDx * 0.25) return '提';
    // 横（宽松）：向右，稍有倾斜
    if (dx > 0 && absDx > absDy * 2) return '横';
    // 竖：向下且很垂直
    if (dy < 0 && absDy > absDx * 4) return '竖';
    // 撇：向左下（包括陡峭的撇）
    if (dx < 0 && dy < 0) return '撇';
    // 竖（宽松）：主要向下
    if (dy < 0 && absDy > absDx * 2) return '竖';
    // 捺：向右下
    if (dx > 0 && dy < 0) return '捺';

    return '折';
}

function normalizeStroke(s) {
    if (['横折', '横撇', '横钩'].includes(s)) return '横折';
    if (['竖钩', '竖弯钩'].includes(s)) return '竖钩';
    if (['斜钩', '卧钩', '弯钩'].includes(s)) return '钩';
    return s;
}

function testCharacter(test) {
    try {
        const charData = loadCharacterData(test.char);
        const recognizedStrokes = charData.medians.map(m => getStrokeName(m));
        const isCorrect = recognizedStrokes.length === test.strokes.length &&
            recognizedStrokes.every((s, i) => normalizeStroke(s) === normalizeStroke(test.strokes[i]));
        return { char: test.char, expected: test.strokes, recognized: recognizedStrokes, correct: isCorrect };
    } catch (error) {
        return { char: test.char, expected: test.strokes, recognized: ['错误'], correct: false, error: error.message };
    }
}

function runAllTests() {
    console.log('🧪 笔画识别自动化测试\n');
    console.log('='.repeat(50));

    const results = testData.map(test => {
        const result = testCharacter(test);
        console.log(`${result.correct ? '✅' : '❌'} ${result.char}`);
        console.log(`   期望: ${result.expected.join(', ')}`);
        console.log(`   识别: ${result.recognized.join(', ')}`);
        console.log('');
        return result;
    });

    console.log('='.repeat(50));
    const correct = results.filter(r => r.correct).length;
    console.log(`📊 测试结果: ${correct}/${results.length} (${((correct / results.length) * 100).toFixed(1)}%)\n`);
    process.exit(correct < results.length ? 1 : 0);
}

runAllTests();
