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
        const chord = Math.sqrt(dx * dx + dy * dy) || 1;
        const straightness = chord / totalLength;

        // 1. 递归提取关键拐点 (阈值设为 0.16，既能捕捉转折又能容忍书法弧度)
        let corners = [];
        this._rdp(points, 0, points.length - 1, totalLength * 0.16, corners);
        corners.sort((a, b) => a - b);

        // 2. 深度检测末端钩特征
        const hookData = this.detectHookFine(points, totalLength);
        const hasHook = !!hookData;

        let segments;
        if (hasHook) {
            const hookStartIndex = hookData.startIndex;
            const filteredCorners = corners.filter(c => c < hookStartIndex - 3);
            segments = this.getSegments(points.slice(0, hookStartIndex + 1), filteredCorners);
        } else {
            segments = this.getSegments(points, corners);
        }

        // 3. 语义化各段方向，并执行智能段合并
        let rawDs = segments.map(s => {
            const v = { dx: s[s.length - 1][0] - s[0][0], dy: s[s.length - 1][1] - s[0][1] };
            return this.getSemanticDir(v, totalLength);
        });

        let ds = [];
        if (rawDs.length > 0) {
            ds.push(rawDs[0]);
            for (let i = 1; i < rawDs.length; i++) {
                if (rawDs[i] !== rawDs[i - 1]) ds.push(rawDs[i]);
            }
        }
        const pStr = ds.join('-');

        // --- A. 单段识别 ---
        if (ds.length === 1) {
            const ang = this.calcAngle(dx, dy);

            if (hasHook) {
                // 如果主体是撇，即便检测到钩特征，也强制识别为撇 (月、川的第一笔)
                if (ds[0] === '撇') return '撇';
                if (['竖', '横'].includes(ds[0])) {
                    if (this.isBetween(ang, 210, 335)) return '竖钩';
                    if (dx > 0) return (dx > Math.abs(dy) * 1.5) ? '卧钩' : '斜钩';
                    return '弯钩';
                }
            }

            // 点的判定：在较宽长度范围内 (<260) 只要角度在撇捺区间均视为点
            if (totalLength < 255) {
                if (this.isBetween(ang, 345, 55)) return '横';
                if (this.isBetween(ang, 55, 125)) return '提';
                if (this.isBetween(ang, 125, 240) || this.isBetween(ang, 300, 345)) {
                    // 如果长度极短，则是点；如果较长且角度明显，则是撇/捺
                    return (totalLength > 185) ? (this.isBetween(ang, 125, 240) ? '撇' : '捺') : '点';
                }
                return '点';
            }

            if (this.isBetween(ang, 345, 45)) return '横';
            if (this.isBetween(ang, 240, 315)) {
                // 撇 vs 竖 判定优化
                return (this.calculateDXRate(points) < -0.12 || straightness < 0.88) ? '撇' : '竖';
            }
            if (this.isBetween(ang, 120, 240)) return '撇';
            if (this.isBetween(ang, 310, 350)) return '捺';
            if (this.isBetween(ang, 45, 120)) return '提';
            return '点';
        }

        // --- B. 组合识别 (Profile Mapping) ---
        if (pStr === '横-竖') {
            if (hasHook) return '横折钩';
            // 针对“口”、“目”等字的横折优化
            const v2Seg = segments[segments.length - 1];
            const v2dx = v2Seg[v2Seg.length - 1][0] - v2Seg[0][0];
            const v2dy = v2Seg[v2Seg.length - 1][1] - v2Seg[0][1];
            // 只有当第二笔斜率极大 (dx负向很多) 且长度足够时才识别为横撇
            if (v2dx < -Math.abs(v2dy) * 0.7 && Math.abs(v2dx) > 80) return '横撇';
            return '横折';
        }
        if (pStr === '横-撇' || pStr === '横-捺') return '横撇';
        if (pStr === '竖-横') {
            const v2Seg = segments[segments.length - 1];
            const v2dy = v2Seg[v2Seg.length - 1][1] - v2Seg[0][1];
            // 竖弯钩必须有明确的钩或明确的向上回折
            return (hasHook || v2dy > 55) ? '竖弯钩' : '竖折';
        }
        if (pStr.includes('撇-点') || pStr.includes('撇-捺')) return '撇点';
        if (pStr.includes('撇-横') || pStr.includes('撇-折') || pStr.includes('撇-提')) return '撇折';
        if (pStr === '横-提' || pStr === '点-提') return '横钩';
        if (pStr.includes('横-竖-横')) return hasHook ? '横折折钩' : '横折弯';
        if (pStr.includes('竖-横-竖')) return hasHook ? '竖折折钩' : '竖折折';
        if (pStr === '横-撇-竖') return '横撇弯钩';

        // 兜底策略
        if (ds[0] === '横') return hasHook ? '横折钩' : '横折';
        if (ds[0] === '竖') return hasHook ? '竖钩' : '竖折';
        return hasHook ? '弯钩' : '横折';
    },

    getSemanticDir(v, total) {
        const a = this.calcAngle(v.dx, v.dy);
        if (this.isBetween(a, 340, 60)) return '横';
        if (this.isBetween(a, 240, 315)) {
            return (v.dx < -total * 0.08) ? '撇' : '竖';
        }
        if (this.isBetween(a, 120, 240)) return '撇';
        if (this.isBetween(a, 315, 350)) return '捺';
        if (this.isBetween(a, 45, 120)) return '提';
        return '点';
    },

    detectHookFine(points, totalLength) {
        const n = points.length;
        if (n < 8) return null;
        const scanRange = Math.max(5, Math.floor(n * 0.22));
        for (let i = n - 2; i > n - scanRange; i--) {
            const vBody = { dx: points[i][0] - points[0][0], dy: points[i][1] - points[0][1] };
            const vHook = { dx: points[n - 1][0] - points[i][0], dy: points[n - 1][1] - points[i][1] };
            const aBody = this.calcAngle(vBody.dx, vBody.dy);
            const aHook = this.calcAngle(vHook.dx, vHook.dy);
            let diff = Math.abs(aBody - aHook);
            if (diff > 180) diff = 360 - diff;
            const lenHook = Math.sqrt(vHook.dx * vHook.dx + vHook.dy * vHook.dy);

            // 钩特征：剧烈回弹且长度适中且不能太长
            if (diff > 115 && diff < 175 && lenHook > 12 && lenHook < totalLength * 0.2) {
                return { startIndex: i };
            }
        }
        return null;
    },

    calculateDXRate(points) {
        const start = points[0], end = points[points.length - 1];
        const dx = end[0] - start[0];
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
        if (end - start < 5) return;
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
