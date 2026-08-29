# HWOverlay

直播用的硬件监控叠加层：读 AIDA64 的传感器数据，提供一个 OBS 浏览器源页面，
并带一个本地管理页用来**自由拼装显示部件**、改尺寸、看预算。

## 跑起来

```bash
python hw_server.py            # 开发：起服务 + 打印体检结果
python hw_server.py --open     # 顺便打开管理页
```

打包成 exe（构建期需要 PyInstaller，运行期不需要）：

```bash
python -m pip install pyinstaller
python build.py                # 产出 dist/HWOverlay-<版本>-win64.zip
```

解压后双击 `HWOverlay.exe`，会自动打开管理页。未签名的 exe 会被 SmartScreen 拦一下，
点"更多信息"→"仍要运行"。

## OBS 里怎么填

添加「浏览器」源，**取消勾选"本地文件"**，填：

| 字段 | 值 |
|---|---|
| URL | `http://127.0.0.1:8765/` |
| 宽度 / 高度 | 以管理页"OBS 里怎么填"那块为准（当前 2000 × 200） |

改过版式后要在浏览器源属性里点一次**刷新缓存**，否则 OBS 还是旧页面。
服务进程一关，叠加层会自动压暗 —— 这是故意的，直播时一眼能看出数据断了。

## 自定义版式（schema v2）

版式是一份 JSON（管理页可视化编辑，存在 `overlays/monitor.json`，
打包后落在 `%LOCALAPPDATA%\HWOverlay`）。结构：

```jsonc
{
  "version": 2,
  "canvas":  { "w": 2000, "h": 200, "padding": [12, 24] },   // OBS 源尺寸 + 内边距
  "prompt":  { "user": "...", "cmd": "...", "cursor": true, "size": 19 },
  "widgets": [ /* 部件数组，从上往下排 */ ]
}
```

部件按 `type` 注册，两处登记即可加新种类（`hwobs/widgets.py` 管校验与几何，
`monitor.html` 的 `WIDGET_TYPES` 管渲染）。当前内置：

| type | 说明 | 可调 |
|---|---|---|
| `cards` | 指标卡片网格：标题 + 进度条 + 次要行 + 迷你曲线 | `cols` `gap` `item_height`，每张卡的标题/进度条/曲线/主值/次要行 |
| `chips` | 底部小指标行 | `font` `margin_top` `fit`，逐项勾选 |
| `text` | 自定义文本行，`{cpu.usage}` 占位符插值，缺失显示 `--` | `text` `size` `margin_top` |

校验是写盘前强制的：内容预估高超出 `canvas.h`、引用不存在的指标、卡片 key 重复
都会被拒绝 —— 不会再出现"底部被静默裁掉"这类事。几何（高度、字号、内边距）
全部来自配置本身，改了就生效，校验器不会说谎。

## 管理页 `/admin`

- **开始使用**：三步向导。检测 AIDA64 是否连着、导出清单和版式是否一致、OBS 怎么填。
  中间那步会列出"要加哪几个传感器、可减哪几个、预算从多少变到多少"，
  勾选确认后才写入（**这一步会关闭并重启 AIDA64**）。
- **数据源 / 导出预算 / 版式校验**：当前状态与所有已知问题。
- **编辑**：部件级可视化编辑 —— 画布尺寸、增删部件、每张卡片的指标槽位、
  文本行的占位符正文、chips 勾选与字号。任何改动先校验，有错误就禁用保存。
- **预览**：真实叠加层的缩放 iframe，跟随画布尺寸。
- **指标表**：每个指标的当前值、数据来源、是否被版式用到、候选传感器 ID。
  排查"这格为什么是 `--`"就看这张表。

## 接口

| 路径 | 用途 |
|---|---|
| `/` | 叠加层页面（OBS 用这个） |
| `/hw.json` | 装配好的指标值 + `sources` 来源 + `missing` 缺失清单 |
| `/overlay.json` | 当前版式配置（v2） |
| `/metrics.json` | 指标注册表（名称、单位、位数、阈值、传感器映射） |
| `/sensors` | AIDA64 当前导出的原始传感器 |
| `/api/layout-check` | GET 校验磁盘配置；POST 校验草稿（不写盘） |
| `/api/aida/status` `plan` `apply` | AIDA64 状态、导出清单差异、应用（需 `confirm`） |
| `PUT /api/config` | 写版式配置：校验不过不落盘，落盘前备份、原子替换、回读确认；v1 入参自动升级 v2 |
| `POST /api/config/rollback` | 从 `.bak` 还原 |

## 三个必须知道的限制

1. **AIDA64 的共享内存固定 4096 字节**，只包含 `HWMonExtAppItems` 列出的传感器，
   约 **最坏 36 个 / 典型 47 个**。写满后末尾条目被**静默截断，不报错**。
   所以选指标本质是在分配字节，管理页的预算条就是干这个的。
2. **传感器 ID 因机器而异**：活动网卡可能是 `SNIC5*` 而不是 `SNIC1*`，
   `TCPU` 在不少主板上是空脚恒为 0。软件按候选列表 + 实采判定处理，
   温度类读到 0 一律当"无数据"而不是 0°C。
3. **速率类传感器不带单位**（AIDA64 导出的是自动换算后的显示值）。
   用 `python -m hwobs.calibrate --long` 与 Windows 网卡计数器对拍标定；
   流量不足时它会明确说"区分不开"，而不是硬给一个数。

## 测试

```bash
for t in tests/test_*.py tests/compare_snapshot.py; do python "$t"; done
```

`compare_snapshot.py` 拿 `tests/fixtures/legacy_hw_server.py`（M1 拆分前实现的冻结副本）
当**活 oracle**，在同一瞬间各读一次共享内存做逐字段对比 —— 用活 oracle 而不是冻结的
输出快照，是因为传感器集合会在会话中途被改动，快照会误报。
schema v2 重构后复跑结论：**行为零变化**（matched/missing 一致、无非数值差异）。

## 目录

```
hwobs/
  sources/     数据源：aida64 共享内存 / winapi 兜底 / mock
  registry/    指标注册表（单位、位数、阈值、传感器映射、聚合方式）
  aida/        aida64.ini 定点读写 + 导出清单状态机
  web/         管理页
  refs.py      版式树引用收集（全项目唯一的遍历实现）
  widgets.py   部件注册表：默认几何、高度计算、结构校验
  overlay.py   装配 /hw.json    config.py 版式读写+迁移    layout.py 版式校验
  budget.py    4096 字节预算    calibrate.py 速率标定   paths.py 资源与配置定位
monitor.html   叠加层渲染器（部件工厂注册表，与 widgets.py 以 type 为契约）
overlays/monitor.json   版式配置（v2）
docs/commit-convention.md  提交约定
```
