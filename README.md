# 汉字笔顺工具（Bishun）

面向小朋友的汉字笔顺动画 Web 工具，支持多字顺序播放和笔画名称播报。项目使用 Vite、原生 JavaScript ES Modules 和 CSS，目前没有 UI 框架或动态后端。

## 当前功能

- 输入最多 20 个汉字，支持单字点击播放和整组顺序播放。
- 字卡格线展示、当前字进度、播放／暂停／继续和五档速度设置。
- 使用浏览器 Web Speech API 朗读笔画名称，可关闭语音。
- 速度和语音开关保存在本地 `localStorage`。
- 字形数据优先从本站静态资源加载，未收录或加载失败时依次尝试备用 CDN；失败字可重试。
- 提供手机、平板和桌面的响应式样式；实际适配与播放稳定性仍在改进中。

当前页面使用 v3，通过 `cnchar` 和 `cnchar-order` 按字及笔画序号查询名称；v1/v2 几何识别算法仍保留在仓库中。这里的“笔画识别”不表示已经支持用户手写识字。

## 开发与构建

依赖范围见 [package.json](package.json)，锁定版本见 [package-lock.json](package-lock.json)：HanziWriter ^3.7.3、cnchar ^3.2.6、cnchar-order ^3.2.6，以及开发依赖 Vite ^6.4.1。

```bash
npm ci
npm run dev
```

生产构建与本地预览：

```bash
npm run build
npm run preview
```

构建输出为 `dist/`，可部署到静态托管服务。`public/` 中的字形资源会复制到构建输出。预览命令需要先构建；未构建的源代码依赖 Vite 解析 npm 导入，不能直接用普通静态文件服务器运行。目前根目录没有 `deploy.sh`。

## 测试与检查

```bash
npm test                # 默认测试 v2
npm run test:v1          # 测试 v1
node test/run.js v3      # 测试当前页面使用的 v3
```

测试读取 `test/data/` 中的字形 fixture。该目录在 `.gitignore` 中，但部分 fixture 已被 Git 跟踪；运行前需确认测试数据是否齐全。`test/download_data.js` 是需要网络的下载辅助脚本。

**测试局限：** 默认测试与页面实际使用的引擎不同；当前 runner 仅在 v2 字符断言失败时返回非零，v1/v3 不能只凭退出码判断通过，还需检查完整结果和缺失数据。有限样本结果也不能代表全部字库准确率。

没有配置 lint、TypeScript 或类型检查脚本。可运行基础语法检查：

```bash
node --check src/main.js
node --check src/engine/speech.js
node --check src/engine/recognition/v3.js
```

尚未配置浏览器自动化测试或经过验证的浏览器版本支持矩阵。布局和媒体播放需要在实际浏览器与代表性移动设备上检查。

## 项目结构

```text
Bishun/
├── index.html                  # 当前 HTML 入口
├── src/
│   ├── main.js                 # 应用、数据加载与播放控制
│   ├── style.css               # 当前页面样式
│   └── engine/
│       ├── speech.js           # 浏览器语音合成
│       └── recognition/        # v1/v2 几何算法，v3 字典查询
├── public/
│   └── hanzi-writer-data/      # 本站字形 JSON，覆盖尚不完整
├── test/
│   ├── run.js                  # 笔画名称回归测试
│   ├── data/                   # 测试用字形数据
│   └── download_data.js        # 数据下载辅助脚本
├── docs/                       # 产品与重构规划
├── backup_static/              # 历史静态版本，不是当前入口
├── STROKE_REFERENCE.md         # 笔画名称参考
├── vite.config.js              # Vite 配置与构建信息
└── package.json
```

## 汉字数据与内容

字形数据优先从 `public/hanzi-writer-data/` 加载，目前包含一批测试集常用字。未收录的字会依次尝试国内镜像和海外 CDN。新增字形时可在该目录加入兼容 HanziWriter 格式的 JSON，但还应校验路径、笔画数、顺序及名称对应关系。

动画路径由 HanziWriter 数据提供，笔画名称来自 cnchar；两者的对应关系需要核验。笔画分类参考 [STROKE_REFERENCE.md](STROKE_REFERENCE.md)，仓库也包含 GF0023-2020 规范 PDF；参考文档本身不等于全字库已完成规范审核。

### 已知限制

- 输入当前采用 `/[^\u4e00-\u9fa5]/g` 过滤，不覆盖全部 Unicode 汉字。
- 暂停主要保存字位置，继续时可能从该字首笔重播，尚未实现可靠的笔画级恢复。
- v3 缺失名称时返回“点”，名称有多个候选时取最后一个，存在教学准确性风险。
- 数据源串行尝试且无显式超时；本站资源覆盖不完整，也未实现完整离线支持。
- 播放阶段会另行调用 `HanziWriter.loadCharacterData`，尚未统一复用预加载数据及自定义来源。
- 语音仍依赖浏览器合成，动画与语音的同步、播放取消及移动端交互需要重构。
- 目前没有屏幕手写练习、拍照查字、拼音释义、教材同步、账号或原生 App。

## 当前规划

优先稳定和完善 Web，先重设计 UI 与交互，再完善资源加载、预生成笔画录音和统一播放控制。Web 通过验收后，再评估功能平移到 App 及手机能力扩展。

- [Web 重构计划](docs/Web重构计划.md)：当前 Web 范围、交互规则、阶段交付和验收标准。
- [K12 长期产品设计与功能探索](docs/K12产品设计与Web重构规划.md)：用户场景、产品方向及 72 项功能候选，不代表本次 Web 待办。
- [代理工作规则](AGENTS.md)：编码代理的修改约束、实现约定和验证要求。

预生成语音、自托管完整目标字库、逐笔定位等属于规划，尚未上线。

## 历史更新记录

以下保留既有更新日志。算法版本和测试准确率描述反映当时记录，未在本轮重新验证；当前实现与测试边界以本文前述说明为准。

### v2.0.0 (2026-01-13)
- **工程化升级**：引入 Vite 构建工具，改为 NPM 依赖管理。
- **算法突破**：实现 V22 笔画识别算法，测试集通过率由 46% 提升至 100%。
- **语音增强**：支持根据识别出的精准笔画名称进行实时语音播报。
- **结构优化**：逻辑与样式分离，代码模块化。

## 协议状态

`package.json` 当前标记为 ISC，原 README 标记为 MIT，仓库未找到独立 LICENSE 文件，协议声明尚待维护者统一。HanziWriter、字形数据和其他依赖的许可需分别核实。
