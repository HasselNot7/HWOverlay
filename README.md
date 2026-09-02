<div align="center">

![HWOverlay 效果预览](/images/overlay_preview.png)

<h2>直播用的硬件监控叠加层 —— 使用AIDA64数据</h2>

自由拼装显示部件、拖拽排版、实时预览，自带本地管理页。<br>
JetBrains字体 + 控制台风格，与 [Now Playing](https://github.com/Widdit/now-playing-service) 搭配使用效果极佳。

</div>

---

## 功能特性

### 核心功能

- **叠加层**：`web/monitor.html`
- **排版编辑器**：部件拖拽，边缘/中线自动吸附，网格
- **内置部件**：指标卡、小指标行、大数字、进度条、圆环仪表、文本、自定义 HTML
- **模板库**：调好的版式可存为自己的模板，也能导出 `.json` 文件备份、分享给别人或从文件导入
- **多版式档位**：不同直播场景各存一套已发布版式，侧栏一键切换生效
- **连接排障**：AIDA64 连接异常时状态点可点开分步解决指南；非编辑页右下角常驻可拖动的实时预览窗
- **自定义组件带脚本**：HTML 部件里可以写 `<script>`，提供 `HWOB` 数据 API
- **自定义指标**：AIDA64 导出了但还没注册的传感器
- **字节预算条**：AIDA64 共享内存只有 4096 字节，选指标本质是分配字节，超没超一眼看见

### 部件类型

| type | 说明 |
|:---:|:---|
| `cards` | 指标卡片网格：标题 + 进度条 + 大数字 + 小字 + 迷你曲线，逐槽位可换指标 |
| `chips` | 小指标行，一行摆一串传感器 |
| `stat` | 大数字 |
| `progress` | 进度条 |
| `gauge` | 圆环仪表，按指标量程定标，超温变红 |
| `text` | 文本行，`{cpu.usage}` 占位符插值，`{time}` `{date}` 本地时钟 |
| `html` | 自定义 HTML + `<script>`，带 `HWOB` 数据 API |

### 兼容性

- 直播软件：OBS Studio
- 操作系统：Windows 10 / 11（64 位）
- 数据源：[AIDA64](https://www.aida64.com/)，需在 Sensor Data 页面勾选 Shared Memory
![AIDA64设置](/images/aida64.png)
---

## 界面预览

![管理页 · 自由排版](/images/editor_preview.png)

管理页共 6 个视图：开始使用 / 状态总览 / 流式排版 / 自由排版 / 自定义指标 / 指标总表。

---

## 搭配 Now Playing 使用

使用Now Playing中的Shell风格：

1. Now Playing 用它的 OBS 浏览器源组件展示「正在播放」
2. HWOverlay 画布设置里打开**背景透明**，OBS 里就是无边底色直接叠在画面上
3. 把 HWOverlay 的宽高填成画布尺寸

你可以得到类似下面的直播界面：
![OBS View](/images/obs.png)

---

## 使用方法

### 方法一：下载整合包（推荐）

- 前往本仓库的 [Release](https://github.com/HasselNot7/HWOverlay/releases) 页面下载 `HWOverlay-<版本>-win64.zip`
- 解压双击 `HWOverlay.exe`，自动打开管理页

### 方法二：从源码运行

```bash
python -m pip install -r requirements.txt
python -m hwobs --open            # 管理页 http://localhost:8765/admin
```

### 在 OBS 里挂载

添加「浏览器」源，**取消勾选"本地文件"**，填：

| 字段 | 值 |
|:---:|:---|
| URL | `http://localhost:8765/` |
| 宽度 / 高度 | 管理页「状态总览」里写的画布尺寸 |

改过版式后要在浏览器源属性里点一次**刷新缓存**。

---

## 开发引导

| 操作 | 命令 |
|:---:|:---|
| 起后端 | `python -m hwobs`（localhost:8765） |
| 前端开发 | `cd frontend && npm ci && npm run dev`（5173，API 自动代理到 8765） |
| 打包 exe | `python -m pip install -r requirements-dev.txt && python scripts/build.py` |

构建期需要 Node.js ≥ 18；运行期不需要。

---

## 程序原理

```
浏览器 ──HTTP──> FastAPI (uvicorn, localhost:8765)
                   ├── /api/*        管理页 API
                   ├── /hw.json /overlay.json /metrics.json /sensors
                   ├── /            叠加层 web/monitor.html（零依赖原生页面，OBS 用）
                   └── /admin       管理页（React 19 + HeroUI v3 构建产物，静态文件）
```

监控项走三级管线：**AIDA64 导出 → 注册表映射成指标 → 版式引用**。
管理页"自定义指标"视图会把未注册的传感器列出来，点"做成指标"填名字单位即可，
存 `metrics.user.json`（用户数据目录），不需要重启。

<details>
<summary>点击展开：版式 schema、API、注册表模型与限制</summary>

### 自定义版式（schema v2）

版式是 JSON（管理页可视化编辑，存 `overlays/monitor.json`，打包后落在
`%LOCALAPPDATA%\HWOverlay`）：

```jsonc
{
  "version": 2,
  "canvas":  { "w": 2000, "h": 200, "padding": [12, 24] },
  "prompt":  { "user": "...", "cmd": "...", "cursor": true, "size": 19,
               "x": 24, "y": 12 /* 自由画布下可拖动；不写=落在画布内边距 */ },
  "widgets": [ /* 部件数组 */ ]
}
```

内置部件在 `hwobs/widgets.py` 登记校验与几何、`web/monitor.html` 的 `WIDGET_TYPES`
登记渲染，两边以 type 为契约。几何全部来自配置本身，改字号/内边距校验跟着变。

### API

| 方法+路径 | 用途 |
|:---|:---|
| GET `/hw.json` `/overlay.json` `/metrics.json` `/sensors` | 数据 |
| GET/POST `/api/layout-check` | 校验磁盘配置 / 校验草稿 |
| GET `/api/aida/status` `/api/aida/plan` | 导出清单状态与只读对比（缺哪些/补全清单；**不写 AIDA64 的 ini**） |
| PUT `/api/config`；POST `/api/config/rollback` | 版式写盘（校验不过不落盘、备份、原子替换）/ 回滚 |
| GET `/api/sensors/unknown`；POST/DELETE `/api/metrics/custom` | 自定义指标（删除 = 回未知池） |
| POST `/api/metrics/preset`；GET/POST/DELETE `/api/layout/presets` | 一键注册默认指标集 / 模板库：内置+用户模板列表、存为模板（保存前过一遍完整校验）、删除 |
| GET/POST/DELETE `/api/profiles`；POST `/api/profiles/activate` | 多版式档位：列表 / 把当前发布版式另存为档 / 删除 / 切换生效（走 config.save：校验+备份） |
| POST `/api/app/shutdown` | 退出程序（需 `confirm`，管理页按钮用） |

### 注册表模型（0.3.0 起）

`metrics.user.json` 就是注册表的全部。新装机器上它不存在 -> 注册表为空，
所有导出传感器都是"未知传感器"，用户自己挑着注册 —— 各家 AIDA64 版本/主板不同，
硬编码的传感器 ID 在别人机器上大半是死行。内置 `metrics.json` 降级为默认指标集
（预设），一键整包搬进用户文件，幂等；旧版用户文件首次加载自动迁移，无感。

### 三个必须知道的限制

1. **AIDA64 共享内存固定 4096 字节**，约最坏 36 / 典型 47 个传感器，写满**静默截断**。
   选指标本质是分配字节，管理页的预算条就是干这个的。
2. **传感器 ID 因机器而异**（活动网卡可能是 `SNIC4*`，还会重连变号）。
   注册新指标用 `agg` 正则而不是写死 ID；温度读到 0 当"无数据"。
3. **速率类传感器不带单位**。`python -m hwobs.calibrate --long` 与 Windows
   计数器对拍标定；流量不足会明确说"区分不开"。

</details>

---

## 致谢

- [Now Playing](https://github.com/Widdit/now-playing-service) —— 本项目的很多灵感来自它：控制台 / Shell 风格的叠加层形态、管理页的排版与微动效语言，都是照着它学出来的。

## 参与

Issues 和 PR 都欢迎。

---

## 许可证

[MIT](LICENSE)。可自由使用、修改、分发（含商用），保留版权声明即可；
软件按"原样"提供，不附带任何担保。

