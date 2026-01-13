import cnchar from 'cnchar';
import order from 'cnchar-order';

// 初始化插件
cnchar.use(order);

export const v3 = {
    // 缓存已查询过的字符笔画
    cache: {},

    getStrokeName(points, char, index) {
        if (!char) {
            // 如果没传字符，回退到某种模糊识别（这里简单设为未知或点）
            return '点';
        }

        // 规范化字符
        const targetChar = char[0];

        // 获取该字符的所有笔画名称
        let names = this.cache[targetChar];
        if (!names) {
            try {
                const res = cnchar.stroke(targetChar, 'order', 'name');
                if (res && res[0] && Array.isArray(res[0])) {
                    // 清理名称，比如 "点2" -> "点", "斜钩|卧钩" -> "卧钩"
                    names = res[0].map(name => {
                        let cleanName = name;
                        // 处理 "点2" 这种后缀
                        cleanName = cleanName.replace(/\d+$/, '');
                        // 处理 "斜钩|卧钩" 这种多选，优先取后面的（通常更符合习惯）
                        if (cleanName.includes('|')) {
                            const parts = cleanName.split('|');
                            cleanName = parts[parts.length - 1];
                        }
                        return cleanName;
                    });
                    this.cache[targetChar] = names;
                }
            } catch (err) {
                console.error('CnChar recognition error:', err);
            }
        }

        if (names && names[index]) {
            return names[index];
        }

        // 兜底策略：如果 cnchar 没查到或索引越界，返回默认值
        return '点';
    }
};
