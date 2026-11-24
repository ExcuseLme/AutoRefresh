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

## 实现落盘位置（上手速查）

```
src/
├── entrypoints/
│   ├── background.ts       SW：会话状态机、消息路由、alarms 兜底、刷新流水线
│   ├── content.ts          CS：交互上报 / AUTOCLICK / keep-active 自愈
│   ├── offscreen/          HTML 入口：唯一的 setTimeout 宿主（ADR-004）
│   └── popup/              React 面板（main.tsx + App.tsx）
├── components/             Header / IntervalSection / RefreshTypeSection / OptionsSection / ui
├── lib/                    options / validate / interval / url / session / storage / refresh / …
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
- `2026-11-24` 本轮：M4 收尾 —— 整数输入严格校验（OQ-5）、输入框 `name` 属性、
  图标调色板压缩（体积 319KB → 297KB）、`status_loading` 首屏占位、
  keep-active TTL 续期合并进伪活动定时器、i18n 占位符改为 Chrome 的 `$1` 语法、
  截图留档 `docs/assets/reference/impl-*.png`、README 关闭全部 OQ。
