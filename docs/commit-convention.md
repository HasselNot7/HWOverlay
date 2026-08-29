# 提交约定

全部采用 [Conventional Commits](https://www.conventionalcommits.org/)。

## 格式

```
<type>: <一句话说明做了什么>

<为什么这么做、踩了什么坑、怎么验证的>
```

- **标题**：`type: 描述`，不超过 60 个字符宽度，中文写，结尾不加句号。
- **type 只用这几个**：

  | type | 用途 |
  |---|---|
  | `feat` | 新增用户可感知的能力 |
  | `fix` | 修 bug |
  | `refactor` | 不改外部行为的结构调整 |
  | `test` | 只动测试/校验 |
  | `docs` | 只动文档与注释 |
  | `perf` | 有实测数据支撑的性能改进 |
  | `chore` | 构建、依赖、仓库配置 |

- **正文必写**。这个项目的价值大半在"为什么"里 —— 哪个数是量出来的、哪条路试过并且不通、验收是怎么验的。
  只写"做了什么"的提交，一个月后没人能判断它能不能改。
- 破坏性改动在标题末尾加 `!` 并在正文以 `BREAKING CHANGE:` 开头说明。

## 本项目特有的几条

- **改了 `/hw.json` 的字段结构，必须在同一个提交里跑 `tests/compare_snapshot.py` 并在正文写出结果。**
  新增字段要显式加进该脚本的 `ALLOWED_NEW` 白名单，不许把断言放宽。
- **改了 `monitor.html` 的布局，正文要写几何量测结果**（卡宽、`body` 高、底部元素
  `getBoundingClientRect().bottom`）。截图视口只有约 1280px，看不到 2000px 的右半边，
  不可作为证据。
- **不要为了让测试通过而修改被测行为。**
- 涉及 AIDA64 的提交，正文写清实测依据而不是推测 —— 这个会话里被"看起来显然"坑过多次
  （`SNIC1*` 恒为 0、`TCPU` 是空脚、`GetIfTable` 全是伪接口行）。

## 例

```
feat: 网卡吞吐 Windows 兜底源，AIDA64 缺席时面板不再整幅判死

逐指标降级而不是整体换源：只在 AIDA64 没给值时由 Windows 计数填补，
其余指标仍如实报缺 —— 兜底不许把"没有这个传感器"糊成"读数为 0"。

弃用 iphlpapi GetIfTable 的实测依据：本机返回的 49 行全部是 TCPIP_* 伪接口行，
其中 5 行镜像同一份流量，求和重复计数约 5 倍（与 PowerShell 对拍比值 0.19 ≈ 1/5）。
测试 12/12，五套全绿；回归仅放行有意新增的 degraded 字段。
```

```
fix: 补回 M2 重写时丢失的 @keyframes blink

不存在的 animation-name 浏览器不报错，元素只是永久停在实心，
所以几何量测与数据回归都没发现它 —— 已由 tests/test_css.py 拦截这一整类退化。
```

## 本地启用模板（可选，需你自己执行）

仓库不代改 git 配置。想自动带上格式说明，自行运行：

```bash
printf '%s\n' 'type: 一句话说明' '' '为什么这么做、踩了什么坑、怎么验证的' '' \
  '# type ∈ feat | fix | refactor | test | docs | perf | chore' \
  '# 改了 /hw.json 字段结构：必须跑 tests/compare_snapshot.py 并写出结果' \
  > .git/COMMIT_TEMPLATE
git config commit.template .git/COMMIT_TEMPLATE
```
