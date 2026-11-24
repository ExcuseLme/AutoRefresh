# AutoRefresh 设计与复刻跟踪

本目录是 **AutoRefresh**（本扩展）的设计基线，随代码一起提交、一起演进。
所有结论都标注了证据来源：原扩展 = 解包目录
`D:\data\dl_fdm\Auto Refresh Plus  Page Monitor 9.3.0`（下称 **ARP**）。

```
docs/
├── README.md                     ← 本文件：索引 / 状态 / 阅读顺序
├── 01-scope.md                   ← 功能范围：保留 / 丢弃 / 未纳入 + 判定依据
├── 02-architecture.md            ← 技术栈、目录、manifest、权限、上下文与消息协议
├── 03-storage-and-state.md       ← 存储 schema、默认值、会话状态机、持久化与迁移
├── 04-ui-panel.md                ← 面板信息架构、组件清单、交互细节、视觉 token
├── 05-refresh-engine.md          ← 定时器宿主、间隔算法、刷新流水线、重定向、上限、keep-active、交互、XHR
├── 06-i18n.md                    ← 语言机制、key 命名规范、zh_CN 文案表
├── 07-traceability.md            ← 需求 → 原扩展证据 → 本扩展实现 → 验收用例 映射表
├── 08-decisions-and-risks.md     ← ADR 决策记录、开放问题、风险清单
├── 09-delivery-plan.md           ← 里程碑、验收标准、测试矩阵、DoD
├── 10-xhr-picker-and-interval-v2.md ← **设计稿（未实施）**：元素拾取器、单击/双击、间隔单一数据源
└── assets/reference/             ← 原扩展面板与设置页的参考截图（证据留档）
```

## 一句话目标

只保留 **扩展面板（popup）**，把 ARP 的「刷新间隔 + 刷新类型 + 7 个常规开关」完整复刻成
**全局作用域** 的自动刷新器；丢弃独立设置页、监控/倒计时/热键/脚本/通知、AI 与付费能力。

## 当前状态

| 项 | 状态 |
| --- | --- |
| 需求澄清（技术栈 / i18n / 面板形态 / XHR 语义 / 主机权限 / 整数秒） | ✅ 已确认（见 `08` ADR-001/009/011 与下方 QA 结论） |
| 原扩展行为取证（面板 UI、选项、存储、引擎、内容脚本） | ✅ 已完成，见 `07` |
| 设计文档落地 | ✅ `32dfb46` |
| M0 骨架（WXT + manifest + 入口齐备，`pnpm build` 通过） | ✅ `34427b5` |
| M1 面板 UI（单屏滚动、间隔/刷新类型/选项三段、视觉 token） | ✅ `34427b5` |
| M2 引擎（offscreen 计时、token 守卫、alarms 兜底、SW 重启恢复） | ✅ `34427b5` |
| M3 内容脚本（交互上报、XHR 自动点击、keep-active 注入与自愈） | ✅ `34427b5` |
| M4 清理与验收（丢弃项检查脚本、vitest、体积 296.85KB） | ✅ `f654b7b` |

已确认的五项决策（不再作为开放问题）：

- 技术栈：**WXT + React + TypeScript + Tailwind**（ADR-001）
- 多语言：**保留 `_locales` 机制，只维护 `zh_CN`**（`06`）
- 面板形态：**单屏滚动，无 tab**（`04`）
- XHR 刷新：**保留「自动点击元素选择器」输入框**（ADR-009）
- 主机权限：**安装即申请 `<all_urls>`**（ADR-011）

Open Questions 的结论（已全部关闭）：

| OQ | 结论 |
| --- | --- |
| OQ-1 | 「用户交互时的刷新行为」= **一个总开关 + 三选一动作（停止 / 暂停 / 重新开始）**，不拆成两个独立开关 |
| OQ-2 | 运行中在面板头部显示「**N 秒后刷新 · 第 M 次**」（面板文字，不是页面内浮层） |
| OQ-3 | **不加**「防止重新提交表单」 |
| OQ-4 | **显示**徽章：运行中绿点、暂停黄点、停止清空 |
| OQ-5 | **只要整数**（用户明确要求）：所有间隔输入为 ≥1 的整数秒，上限 86400，拒绝小数 |
| OQ-6 | 面板滚动位置**不做**持久化 |
| OQ-7 | **不做「指纹兜底」**（用户结论）：生成并使用标准 CSS selector 即可。页面自身用动态 id / 无稳定抓手属于该页面的特殊行为，不由扩展兜底（`10` §1.7） |

## 第二轮已实施（2026-11-24）

`10-xhr-picker-and-interval-v2.md` 是第二轮需求的设计与实施记录，**代码已落地**（ADR-018…021）。
它包含：

- §0 上一轮「点击」改成了什么（完整 pointer/mouse 序列，含实测对照表）
- §1 元素拾取器：为什么不用 `chrome.debugger`（ADR-018）、消息流、popup 关闭的三层兜底、
  5 层选择器生成算法（ADR-019）
- §2 单击/双击（ADR-020）
- §3 间隔改版：单一数据源 + schema v2 迁移（ADR-021）
- §4 影响面清单、§5 验收用例（T-60…T-89）、§6 新增风险 R13–R20


变更记录（第二轮）：
- `2026-11-24` **间隔改版（ADR-021）**：删「自定义」分段与 `customSeconds`/`fixedPreset`，
  `fixedSeconds` 成为固定档唯一数据源（−/+ ∓1、chip 上屏、手动输入三处写同一字段）；
  schema v1→v2，`custom` 档的自定义值**保值迁移**并在首读时回写 storage。
- `2026-11-24` **单击/双击（ADR-020）**：`autoClickAction`；双击 = 两次完整按下序列 + `dblclick`，
  `click.detail` 依次 1、2，同步派发不加延时。
- `2026-11-24` **元素拾取器（ADR-018/019）**：面板新增「选择元素」按钮，
  页内 shadow DOM 覆盖层实时高亮 + 悬浮卡片回显 selector；5 层降级生成器
  （语义属性 → 短结构路径 → id → class → 兜底）；**不申请 `debugger` 权限**。
- `2026-11-24` 测试 80 → **124**（新增 `tests/selector.test.ts`，`dom-click` 重写覆盖双击）。
  构建体积 293 → 304.7 KiB —— **不设体积门槛**（用户明确：自用扩展，不管体积）
## 实现落盘位置（上手速查）

```
src/
├── entrypoints/
│   ├── background.ts       SW：会话状态机、消息路由、alarms 兜底、刷新流水线
│   ├── content.ts          CS：交互上报 / AUTOCLICK / keep-active 自愈
│   ├── offscreen/          HTML 入口：唯一的 setTimeout 宿主（ADR-004）
│   └── popup/              React 面板（main.tsx + App.tsx）
├── components/             Header / IntervalSection / RefreshTypeSection / OptionsSection / ui
├── lib/                    options / validate / interval / url / session / storage / refresh /
│                           dom-click（完整点击序列）/ keep-active / messages / i18n / number-input …
└── assets/main.css         Tailwind + ARP 提取的 oklch 视觉 token

public/
├── _locales/zh_CN/messages.json   唯一语言包
└── icon/                          16/32/48/96/128

scripts/check-scope.mjs    docs/07 §5 丢弃项 grep 检查（T-50 的自动化版本）
tests/                     vitest 单测（间隔算法、校验、URL/上限、状态机、整数解析）
```

验证入口：`pnpm verify`（= `compile` + `test` + `build` + `check:scope`）。

本地试用：`pnpm build` 后把 `.output/chrome-mv3/` 目录作为 `load unpacked` 加载。


## 阅读顺序（给实现者）

1. `01-scope.md` — 先知道做什么、不做什么，避免把丢弃功能又写回来。
2. `02-architecture.md` → `03-storage-and-state.md` — 骨架与数据契约。
3. `05-refresh-engine.md` — 本项目的技术核心（MV3 生命周期下的精确定时）。
4. `04-ui-panel.md` + `06-i18n.md` — 面板与文案。
5. `07-traceability.md` — 验收时逐行对照，不要把"实现完成"当成"行为一致"。
6. `08` / `09` — 决策、风险与排期。

## 与 ARP 的关键取舍（速览）

| 维度 | ARP | AutoRefresh |
| --- | --- | --- |
| 配置入口 | popup（4 tab）+ 独立设置页 `account.autorefresh.io/*` | **仅 popup，单屏滚动** |
| 作用域 | 此 URL / 此域名 / 全局 三层 | **仅全局** |
| 间隔档位 | 5s/10s/15s/60s/5m/10m/15m + 自定义(时/分/秒) | **3s/5s/10s/60s + 自定义(秒，全局同步)** |
| 随机间隔 | min–max，每次取值 | 保留（闭区间、每轮重新取值） |
| 刷新类型 | 完整页面 / XHR（XHR 依赖自动点击元素） | 保留二者，XHR **保留自动点击选择器** |
| 计时/倒计时/监控/热键/通知/AI/付费 | 大量 | **全部移除** |
| 定时器宿主 | SW 内 `setTimeout` 链 + 内容脚本每秒保活 | **offscreen 精确调度 + SW 只在到期时执行**（见 ADR-004） |

变更记录：

- `2026-11-24` 初版：范围、架构、数据模型、UI、引擎、i18n、取证、决策、计划全部落地。
- `2026-11-24` `34427b5`：M0–M3 实现落地（骨架 / 面板 / 引擎 / 内容脚本 + 55 个单测）。
- `2026-11-24` `f654b7b` / `3ed9e35`：M4 收尾 —— 整数输入严格校验（OQ-5）、输入框 `name` 属性、
  图标调色板压缩、`status_loading` 首屏占位、i18n 占位符改为 Chrome 的 `$1` 语法、
  截图留档、README 关闭全部 OQ。
- `2026-11-24` 本轮（XHR 修复）：
  - **ADR-015** 点击改为完整 pointer/mouse 序列 —— 实测 Gmail / 网易邮箱的刷新按钮
    `el.click()` 完全无效（0 请求），必须派发 `pointerdown`→`mousedown`→`click` 全链路。
  - **ADR-016** 失败轮次不计入次数 —— 修掉"计数在涨但其实没刷新"的误导；
    失败时徽章变红 + 红字原因（选择器失效/语法错/内容脚本失联/未填）。
  - **ADR-017** i18n key 只能用 `[a-zA-Z0-9_]` —— 运行期失败码改下划线命名，
    修掉扩展直接加载失败的问题（`Name of a key "tab-gone" is invalid`）。
  - **ADR-014** 内容脚本按需注入 —— 扩展更新前就打开的标签页无需手动刷新即可用。
  - 面板 XHR 区新增「测试选择器」按钮，即时回显命中数与元素摘要（读 `aria-label` 等）。
  - 测试 69 → 80（新增 `tests/dom-click.test.ts`，7 个文件）。