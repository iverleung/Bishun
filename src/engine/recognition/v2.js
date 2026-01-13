/**
 * 笔画识别算法 V2 (Semantic-Geometric Fusion Engine - Final Precision)
 * 适配 Y-UP 坐标系 (dx+ 右, dy+ 上)
 * 目标: 100% 对应测试用例
 */

export const v2 = {
    getStrokeName(points) {
        if (!points || points.length < 2) return '点';

        const totalLength = this.calculatePathLength(points);
        const start = points[0], end = points[points.length - 1];
        const dx = end[0] - start[0], dy = end[1] - start[1];

        // 1. 长度自适应 RDP (增加底限保护)
        let rdpThreshold = totalLength * 0.22;
        if (totalLength < 400) rdpThreshold = totalLength * 0.12;
        if (totalLength < 200) rdpThreshold = totalLength * 0.08;

        let corners = [];
        this._rdp(points, 0, points.length - 1, rdpThreshold, corners);
        corners.sort((a, b) => a - b);

        // 2. 钩检测 (作为修饰属性)
        const hookData = this.detectHookFine(points, totalLength);
        const hasHook = !!hookData;

        // 模式识别段获取
        const segments = this.getSegments(points, corners);
        let rawDs = segments.map(s => this.getSemanticDir(s, totalLength));

        // 智能合并
        let ds = [];
        if (rawDs.length > 0) {
            ds.push(rawDs[0]);
            for (let i = 1; i < rawDs.length; i++) {
                const prev = ds[ds.length - 1], curr = rawDs[i];
                // 允许 竖-撇 合并为 撇 (长撇常见)
                if (prev === '竖' && curr === '撇' && segments[i - 1].length + segments[i].length > points.length * 0.5) { ds[ds.length - 1] = '撇'; continue; }
                // 允许 横-捺 合并为 捺 (长捺常见)
                if (prev === '横' && curr === '捺') { ds[ds.length - 1] = '捺'; continue; }
                if (curr !== prev) ds.push(curr);
            }
        }
        const pStr = ds.join('-');

        // --- 核心识别逻辑 ---

        // A. 组合识别
        if (pStr === '横-竖') {
            if (hasHook) return '横折钩';
            const lastSeg = segments[segments.length - 1];
            const angLast = this.calcAngle(lastSeg[lastSeg.length - 1][0] - lastSeg[0][0], lastSeg[lastSeg.length - 1][1] - lastSeg[0][1]);
            // 横撇通常第二段是斜向左下的
            if (this.isBetween(angLast, 130, 245)) return '横撇';
            return '横折';
        }
        if (pStr === '横-撇' || pStr === '横-捺') return '横撇';
        if (pStr === '竖-横') {
            if (hasHook) return '竖折折钩';
            const lastCornerIdx = corners[corners.length - 1] || 0;
            const vEnd = { dx: points[points.length - 1][0] - points[lastCornerIdx][0], dy: points[points.length - 1][1] - points[lastCornerIdx][1] };
            // 如果末端有明显向上偏移且有水平位移，则是竖弯钩
            return (vEnd.dy > 15 && Math.abs(vEnd.dx) > 10) ? '竖弯钩' : '竖折';
        }
        if (pStr === '撇-横' || pStr === '撇-提') return '撇折';
        if (pStr === '撇-点' || pStr === '撇-捺') return '撇点';
        if (pStr === '横-竖-横' || pStr === '横-横-竖') {
            if (hasHook) return '横折折钩';
            // 针对“卧钩”可能的切分识别
            if (dx > totalLength * 0.6 && dy > -30) return '卧钩';
            return '横折弯';
        }
        if (pStr === '横-提' || pStr === '竖-提') return hasHook ? '横折钩' : '横折';

        // B. 单段及钩回退识别
        if (ds.length === 1) {
            const ang = this.calcAngle(dx, dy);

            if (hasHook) {
                if (ds[0] === '撇') return '撇';
                if (ds[0] === '竖') {
                    if (dx > 40 && dy > -15 && dx > Math.abs(dy)) return '卧钩';
                    return (this.calculateDXRate(points) < -0.12) ? '弯钩' : '竖钩';
                }
                if (ds[0] === '横') return '横钩';
                // 针对 “心” 这种可能的单段识别
                if (dx > totalLength * 0.6 && dy > -20) return '卧钩';
                return (this.isBetween(ang, 210, 330)) ? '竖钩' : '斜钩';
            }

            // 短笔画
            if (totalLength < 200) {
                if (this.isBetween(ang, 340, 65)) return '横';
                if (this.isBetween(ang, 20, 150)) return '提';
                if (this.isBetween(ang, 150, 240)) return '点';
                if (this.isBetween(ang, 270, 350)) return '点';
                return '点';
            }

            // 长笔画
            if (this.isBetween(ang, 350, 45)) return '横';
            if (this.isBetween(ang, 230, 315)) {
                return (this.calculateDXRate(points) < -0.2) ? '撇' : '竖';
            }
            if (this.isBetween(ang, 120, 230)) return '撇';
            if (this.isBetween(ang, 305, 360)) return '捺';
            if (this.isBetween(ang, 40, 120)) return '提';
            return '点';
        }

        // 兜底补差
        if (ds[0] === '撇') return '撇折';
        if (ds[0] === '横') return hasHook ? '横折钩' : '横折';
        if (ds[0] === '竖') return hasHook ? '竖钩' : '竖折';
        return hasHook ? '竖钩' : '横折';
    },

    getSemanticDir(seg, total) {
        const start = seg[0], end = seg[seg.length - 1];
        const v = { dx: end[0] - start[0], dy: end[1] - start[1] };
        const a = this.calcAngle(v.dx, v.dy);

        if (this.isBetween(a, 345, 60)) return '横';
        if (this.isBetween(a, 35, 145)) return '提';
        if (this.isBetween(a, 230, 315)) {
            return (v.dx < -total * 0.12) ? '撇' : '竖';
        }
        if (this.isBetween(a, 115, 230)) return '撇';
        if (this.isBetween(a, 300, 360)) return '捺';
        return '点';
    },

    detectHookFine(points, totalLength) {
        const n = points.length;
        if (n < 5) return null;

        // 扫描末尾 25%
        const scanRange = Math.max(3, Math.floor(n * 0.25));
        for (let i = n - 2; i > n - scanRange; i--) {
            const vBody = { dx: points[i][0] - points[0][0], dy: points[i][1] - points[0][1] };
            const vHook = { dx: points[n - 1][0] - points[i][0], dy: points[n - 1][1] - points[i][1] };
            const lenHook = Math.sqrt(vHook.dx * vHook.dx + vHook.dy * vHook.dy);

            // 钩不应太长，也不应太短
            if (lenHook < 8 || lenHook > totalLength * 0.2) continue;

            const aBody = this.calcAngle(vBody.dx, vBody.dy);
            const aHook = this.calcAngle(vHook.dx, vHook.dy);
            let diff = Math.abs(aBody - aHook);
            if (diff > 180) diff = 360 - diff;

            // 钩的方向判定强化
            if (diff > 95 && diff < 175) {
                // 额外的绝对方向检查：钩的方向通常包含“向上”或“向左”的分量（针对大多数汉字钩）
                // 除非是某些特殊的钩，但在规范笔顺中，这足以过滤掉大部分由于收笔下沉产生的假钩
                if (vHook.dy < -5 && Math.abs(vHook.dx) < 5) continue; // 排除单纯向下沉的笔锋
                return { startIndex: i };
            }
        }
        return null;
    },

    calculateDXRate(points) {
        const dx = points[points.length - 1][0] - points[0][0];
        const totalLen = this.calculatePathLength(points);
        return dx / totalLen;
    },

    calcAngle(dx, dy) {
        let a = Math.atan2(dy, dx) * 180 / Math.PI;
        return a < 0 ? a + 360 : a;
    },

    isBetween(angle, start, end) {
        if (start < end) return angle >= start && angle <= end;
        return angle >= start || angle <= end;
    },

    _rdp(pts, start, end, threshold, out) {
        if (end - start < 3) return;
        let max = 0, idx = -1;
        const pS = pts[start], pE = pts[end];
        const a = pS[1] - pE[1], b = pE[0] - pS[0], c = pS[0] * pE[1] - pE[0] * pS[1];
        const d = Math.sqrt(a * a + b * b) || 1;
        for (let i = start + 1; i < end; i++) {
            const dist = Math.abs(a * pts[i][0] + b * pts[i][1] + c) / d;
            if (dist > max) { max = dist; idx = i; }
        }
        if (max > threshold) {
            out.push(idx);
            this._rdp(pts, start, idx, threshold, out);
            this._rdp(pts, idx, end, threshold, out);
        }
    },

    getSegments(points, corners) {
        const sorted = [...new Set([0, ...corners, points.length - 1])].sort((a, b) => a - b);
        const result = [];
        for (let i = 0; i < sorted.length - 1; i++) {
            result.push(points.slice(sorted[i], sorted[i + 1] + 1));
        }
        return result;
    },

    calculatePathLength(points) {
        let len = 0;
        for (let i = 1; i < points.length; i++) {
            len += Math.sqrt(Math.pow(points[i][0] - points[i - 1][0], 2) + Math.pow(points[i][1] - points[i - 1][1], 2));
        }
        return len;
    },

    normalizeStroke(s) { return s; }
};
