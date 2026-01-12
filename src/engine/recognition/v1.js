/**
 * 笔画识别算法 V1 (Legacy)
 */

export const v1 = {
    getStrokeName(median) {
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
            if (firstMainlyVert && firstDy < 0 && lastMainlyHoriz && lastDx > 0 && lastDy > -50) {
                return '竖折';
            }

            // 横撇：前段向右,后段向左下（需要明确的方向变化）
            if (firstDx > 0 && firstMainlyHoriz && lastDx < 0 && lastDy < 0) {
                return '横撇';
            }
        }

        // 短横撇
        if (n >= 5 && length > 250) {
            const midIdx = Math.floor(n / 2);
            const firstDx = median[midIdx][0] - median[0][0];
            const lastDx = median[n - 1][0] - median[midIdx][0];
            const lastDy = median[n - 1][1] - median[midIdx][1];
            if (firstDx > 50 && lastDx < -50 && lastDy < 0) {
                return '横撇';
            }
        }

        // 带钩的笔画
        if (n >= 5) {
            const hookDx = median[n - 1][0] - median[n - 2][0];
            const hookDy = median[n - 1][1] - median[n - 2][1];
            const hookLen = Math.sqrt(hookDx * hookDx + hookDy * hookDy);

            const mainDx = median[Math.floor(n * 0.7)][0] - median[0][0];
            const mainDy = median[Math.floor(n * 0.7)][1] - median[0][1];

            if (hookLen > 60 && hookDy > 20) {
                if (mainDy < -Math.abs(mainDx) * 2 && hookDx < 0) return '竖钩';
                if (mainDx > 0 && mainDy < 0) return '斜钩';
                if (mainDy < 0 && hookDx > 0) return '竖弯钩';
                if (Math.abs(mainDx) > Math.abs(mainDy) && hookDy > 30) return '卧钩';
                if (mainDy < 0 && hookDx < 0) return '弯钩';
            }
        }

        // 基础笔画
        if (dx > 0 && absDx > absDy * 3) return '横';
        if (dx > 0 && dy > 0 && absDy > absDx * 0.25) return '提';
        if (dx > 0 && absDx > absDy * 2) return '横';
        if (dy < 0 && absDy > absDx * 4) return '竖';
        if (dx < 0 && dy < 0) return '撇';
        if (dy < 0 && absDy > absDx * 2) return '竖';
        if (dx > 0 && dy < 0) return '捺';

        return '折';
    },

    normalizeStroke(s) {
        if (['横折', '横撇', '横钩'].includes(s)) return '横折';
        if (['竖钩', '竖弯钩'].includes(s)) return '竖钩';
        if (['斜钩', '卧钩', '弯钩'].includes(s)) return '钩';
        return s;
    }
};
