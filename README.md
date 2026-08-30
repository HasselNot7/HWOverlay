# HWOverlay

直播用的硬件监控叠加层：读 AIDA64 的传感器数据，给 OBS 提供一个浏览器源页面，
并带一个本地管理页（React + HeroUI）用来**自由拼装显示部件**、改尺寸、看预算。

## 架构

```
浏览器 ──HTTP──> FastAPI (uvicorn, 127.0.0.1:8765)
                   ├── /api/*        管理页 API
                   ├── /hw.json /overlay.json /metrics.json /sensors
                   ├── /            叠加层 monitor.html（零依赖原生页面，OBS 用）
                   └── /admin       管理页（React 构建产物，静态文件）
frontend/           React 18 + Vite + Tailwind v4 + HeroUI（管理页源码）
hwobs/              Python 后端（数据装配、版式校验、AIDA64 读写）
```

## 跑起来

```bash
python -m pip install fastapi uvicorn     # 运行期 Python 依赖
python hw_server.py                       # 起服务，管理页 http://127.0.0.1:8765/admin
python hw_server.py --open                # 顺便打开管理页
```

改前端时（需要 Node.js ≥ 18）：

```bash
cd frontend
npm ci                 # 第一次
npm run dev            # Vite 开发服务器 5173，API 自动代理到 8765
```

## 打包成 exe

```bash
python -m pip install pyinstaller
python build.py                # 构建 frontend/dist → PyInstaller → dist/HWOverlay-<版本>-win64.zip
python build.py --skip-frontend   # 跳过前端构建（已有 dist 时）
```

构建期需要 Node.js；运行期不需要。解压后双击 `HWOverlay.exe`，自动打开管理页。
未签名 exe 会被 SmartScreen 拦一下，点"更多信息"→"仍要运行"。

## OBS 里怎么填

添加「浏览器」源，**取消勾选"本地文件"**，填：

| 字段 | 值 |
|---|---|
| URL | `http://127.0.0.1:8765/` |
| 宽度 / 高度 | 管理页"状态总览"里写的尺寸（当前 2000 × 200） |

改过版式后要在浏览器源属性里点一次**刷新缓存**。服务进程一关，叠加层自动压暗 ——
故意的，直播时一眼能看出数据断了。

## 自定义版式（schema v2）

版式是 JSON（管理页可视化编辑，存 `overlays/monitor.json`，打包后落在
`%LOCALAPPDATA%\HWOverlay`）：

```jsonc
{
  "version": 2,
  "canvas":  { "w": 2000, "h": 200, "padding": [12, 24] },
  "prompt":  { "user": "...", "cmd": "...", "cursor": true, "size": 19 },
  "widgets": [ /* 部件数组，从上往下排 */ ]
}
```

内置部件（`hwobs/widgets.py` 登记校验与几何，`monitor.html` 的
`WIDGET_TYPES` 登记渲染，两边以 type 为契约）：

| type | 说明 | 可调 |
|---|---|---|
| `cards` | 指标卡片网格：标题 + 进度条 + 大数字 + 小字 + 迷你曲线 | `cols` `gap` `item_height`，每张卡逐槽位可编辑 |
| `chips` | 底部小指标行 | `font` `margin_top` `fit`，逐项勾选 |
| `text` | 自定义文本行，`{cpu.usage}` 占位符插值 | `text` `size` `margin_top` |

校验在写盘前强制：内容超高、引用不存在的指标、卡片 key 重复都会被拒。
几何全部来自配置本身，改字号/内边距校验跟着变。

## AIDA64 之外的新监控项

三级管线：**AIDA64 导出 → 注册表映射成指标 → 版式引用**。
管理页"自定义指标"视图会把未注册的传感器列出来，点"做成指标"填名字单位即可，
存 `metrics.user.json`（用户数据目录），不需要重启。

## 管理页 /admin

React + HeroUI 单页应用（源码 `frontend/`）：

- **开始使用**：两步 —— 连接 AIDA64、OBS 填法。
- **状态总览**：数据源状态、共享内存预算条、OBS 填法。
- **版式编辑**：部件级可视化编辑 + 实时缩放预览 + 写盘前强制校验。
  默认是空白画布（每块屏幕尺寸都不同），有"加载默认样式"一键上手
  （顺带注册默认指标集）。
- **自定义指标**：未知传感器注册与删除 + 一键注册默认指标集。
- **指标总表**：每个指标的当前值、来源、是否被版式引用、候选传感器 ID；
  行内删除 = 回到未知池。

**注册表模型（0.3.0 起）**：`metrics.user.json` 就是注册表的全部。
新装机器上它不存在 -> 注册表为空，所有导出传感器都是"未知传感器"，
用户自己挑着注册 —— 各家 AIDA64 版本/主板不同，硬编码的传感器 ID 在
别人机器上大半是死行。内置 `metrics.json` 降级为默认指标集（预设），
一键整包搬进用户文件，幂等；旧版用户文件首次加载自动迁移，无感。

## API

| 方法+路径 | 用途 |
|---|---|
| GET `/hw.json` `/overlay.json` `/metrics.json` `/sensors` | 数据 |
| GET/POST `/api/layout-check` | 校验磁盘配置 / 校验草稿 |
| GET `/api/aida/status` `/api/aida/plan` | 导出清单状态与只读对比（缺哪些/补全清单；**不写 AIDA64 的 ini**） |
| PUT `/api/config`；POST `/api/config/rollback` | 版式写盘（校验不过不落盘、备份、原子替换）/ 回滚 |
| GET `/api/sensors/unknown`；POST/DELETE `/api/metrics/custom` | 自定义指标（删除 = 回未知池） |
| POST `/api/metrics/preset`；GET `/api/layout/preset` | 一键注册默认指标集 / 读预设版式 |
| POST `/api/app/shutdown` | 退出程序（需 `confirm`，管理页按钮用） |

## 三个必须知道的限制

1. **AIDA64 共享内存固定 4096 字节**，约最坏 36 / 典型 47 个传感器，写满**静默截断**。
   选指标本质是分配字节，管理页的预算条就是干这个的。
2. **传感器 ID 因机器而异**（活动网卡可能是 `SNIC4*`，还会重连变号）。
   注册新指标用 `agg` 正则而不是写死 ID；温度读到 0 当"无数据"。
3. **速率类传感器不带单位**。`python -m hwobs.calibrate --long` 与 Windows
   计数器对拍标定；流量不足会明确说"区分不开"。

## 测试

```bash
for t in tests/test_*.py tests/compare_snapshot.py; do python "$t"; done
```

`compare_snapshot.py` 用冻结的旧实现当活 oracle 逐字段对比 `/hw.json`。
改 `/hw.json` 字段必须在同一提交里复跑并在正文写结果。

## 目录

```
hwobs/
  api.py         FastAPI 应用（HTTP 壳，业务原样复用）
  app.py         入口：互斥量、端口回退、uvicorn 启动
  sources/       aida64 共享内存 / winapi 兜底
  registry/      指标注册表（+ 用户自定义 metrics.user.json）
  aida/          aida64.ini 定点读写 + 导出清单状态机
  widgets.py     部件注册表：默认几何、高度、校验
  refs.py        版式树引用收集（全项目唯一遍历）
  overlay.py     装配 /hw.json     config.py 版式读写+迁移    layout.py 校验
  budget.py      4096 字节预算    calibrate.py 速率标定    paths.py 定位
monitor.html     叠加层（零依赖，OBS 浏览器源直接跑）
frontend/        管理页 React 源码（构建产物 dist/ 由 FastAPI 服务）
overlays/monitor.json   版式配置（v2）
docs/commit-convention.md  提交约定
```
