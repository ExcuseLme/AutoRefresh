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
├── 10-xhr-picker-and-interval-v2.md ← 元素拾取器、单击/双击、间隔单一数据源（已实施）
├── 11-per-page-selector.md       ← XHR selector 按页面隔离、schema v3 迁移（已实施）
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
变更记录（第十四轮，ADR-033 + ADR-034）：v0.4.0 → **v0.4.1**
- **修 `输入框占用时暂停` 误判（ADR-033）**：Bitbucket PR 页面有一个 `readonly` 的
  `<input class="clone-url-input">`，value 永远是 clone 地址。原实现只排除 `disabled`
  没排除 `readOnly` ⇒ "有内容"恒为真 ⇒ 倒计时永久暂停。
  判据从"有没有值"改成"**用户能不能把它清掉**"：readOnly/disabled 一律不算占用。
- **修 暂停/继续 丢进度（ADR-034）**：暂停时没记住已数掉多少，继续时重新计一整轮**且立刻刷新**。
  现在 `Session` 加 `pausedRemainMs`，暂停记下剩余、继续从那个数字接着数（不立即刷新）；
  面板显示「已暂停 · 第 N 次 · 剩余 X 秒」。
  注意：这个字段只用于**手动**暂停 —— 输入框占用暂停仍是"解除后重新计一轮"（ADR-032 语义）。
- 新增 `tests/input-hold-readonly.test.ts`(6) + `tests/pause-resume.test.ts`(6)。
  测试 186 → **198**。
变更记录（第十三轮，ADR-032）：v0.3.0 → **v0.4.0**，schema **v3 → v4**
- **交互只保留两档**（用户明确："我只有两种需求…只需要这两个就够了"）：
  「始终稳定」无视输入框状态、倒计时不被任何输入打断；「输入框占用时暂停」
  光标在输入框内**或**任意输入框有内容时持续暂停，全部解除后恢复。
- **语义修正**：交互从**一次性事件**（每次点击/按键触发一次 stop/pause/restart）
  改为**持续状态**（占用的整段时间都不刷新）。这才是用户描述的行为。
- **删除**：三选一动作（停止/暂停/重新开始）、「重新开始前等待」秒数、旧的「仅框外」档、
  以及 `interactions` 总开关；对应 5 个字段、15 个 i18n key。
- **占用判定**（`src/lib/input-hold.ts`）：焦点在 input/textarea/contenteditable，
  或任意文本类输入框/contenteditable 有非空内容。**刻意排除** checkbox/radio/file/range
  （它们的 value 不是用户可清空的文本，算进去会让倒计时永远暂停）。
- **监视三条腿**：focusin/focusout + input/change + 1s 兜底轮询（防脚本直接改 value）。
- 新增 `tests/input-hold.test.ts`(12) + `tests/interaction-scope.test.ts`(4)；
  删除 `restart-wait.test.ts`（相关字段已不存在）。测试 199 → **186**。
变更记录（第十二轮，ADR-031）：v0.2.1 → **v0.3.0**
- **「测试选择器」现在会滚动到目标元素 + 呼吸高亮**：点一下，页面自动滚到该元素居中，
  元素上叠加一个呼吸 3 次（共 2.4s）的紫色高亮框，旁边贴一个小标签显示元素摘要
  （命中多个时显示「N 个命中（第 1 个）」）。实现在 `src/lib/highlight.ts`。
- **扩展图标显示实时倒计时**：运行中图标上显示剩余秒数；`>=60s` 显示**截断**的分钟数
  （60–119s ⇒ `1m`，120–179s ⇒ `2m`，240–299s ⇒ `4m`）；暂停 `II`、失败 `!`、
  未开启刷新时图标正常不显示数字。每秒刷新一次。
- **架构踩坑**：最初想让 offscreen 自己调 `chrome.action` 写徽章（因为 SW 30s 会被回收），
  实测**offscreen 里没有 `chrome.action`**，徽章纹丝不动。
  改为 offscreen 每秒发 `BADGE_TICK` 给 SW，由 SW 写。代价是运行期间 SW 每秒被唤醒
  （这是"图标上要秒级倒计时"的必然成本）。
- 新增 `src/lib/badge.ts` + `tests/badge.test.ts`（14 例）。测试 185 → **199**。
变更记录（第十一轮，ADR-030）：v0.2.0 → **v0.2.1**
- **修掉「选择元素」的点击穿透 bug**：用户为了选元素点的那一下，会把页面上的该元素**真的点一次**。
  根因是拾取器在 `pointerdown` 里就 `teardown()` 了，而一次点击还有
  `mousedown → pointerup → mouseup → click` 四五个事件跟在后面 —— 监听已拆，全部落到页面。
- 修法：新增 **sweep 阶段**。选中时不直接拆，而是把 hover 监听换成 sweep 监听
  （全部 `swallow`），等吞掉 `click` 才真正 teardown；另加 400ms 兜底定时器
  （按下后拖走导致 click 不来时也能收尾）。高亮/十字准星/宿主节点在选中瞬间即刻撤掉。
- 实测（本地测试页，按钮挂 5 种事件计数器）：拾取模式下点该按钮 ⇒
  `clicks=0 pointerdown=0 mousedown=0 pointerup=0 mouseup=0 click=0`，
  同时 `pageSelectors` 正确写入 `#btn`；拾取结束后再点 ⇒ 正常计数。
- 新增 `tests/picker-sweep.test.ts`（4 例）。测试 181 → **185**。
变更记录（第十轮，ADR-029）：扩展版本号 v0.1.0 → **v0.2.0**
- **版本号单一真源 = `package.json`**：删掉 `wxt.config.ts` 里硬写的 `version`，
  WXT 自动从 package.json 读取写入 manifest（已验证改一处即产物同步）。
- **面板头部显示版本号**：`页面自动刷新  v0.2.0`，读的是
  `chrome.runtime.getManifest().version` —— 即**浏览器里实际加载的那个版本**。
  重载后数字变了 = 新构建生效；没变 = 还在跑旧产物。这正是你要的"观察是否重载成功"。
- **`docs/09` 里程碑检查项新增一条**：`package.json` 的 `version` 已递增。
- **约定**：以后每次改动都递增版本号（功能增量 minor、纯修复 patch）。
- 新增 `tests/version.test.ts`（4 例）锁住三条不变式：
  合法 semver / 已从 0.1.0 递增过 / `wxt.config.ts` 不能再硬写 version /
  源码里不能出现当前版本号字面量（必须走 getManifest）。
变更记录（第九轮，ADR-028）：
- **触发范围从"两个开关"改成"三段 SegmentedControl"**：`[任何交互][仅框外][仅框内]`。
  原因：2 个布尔 = 4 种组合但只有 3 种合法，`{inputOnly:true, ignoreInput:true}` 是非法态；
  ADR-027 为掩盖它打了三个补丁（优先级/强制关另一个/置灰），各有副作用。
  改成枚举后互斥天然成立，**不改 schema**（仍存两个布尔，双向映射）。
- **修掉一个严重布局 bug**：`刷新类型` 那行字只露上半截、XHR 整块交互被裁进不可视区域。
  根因是滚动容器 `flex flex-col + overflow-y-auto` 的**直接子项默认 flex-shrink:1**，
  内容超高时子项被压扁（而不是让容器滚动），内层 `overflow-hidden` 再裁掉超出部分。
  修法：加 `[&>*]:shrink-0`。实测裁切前 `h=96/scrollHeight=136`，修复后 `h=138/scrollHeight=136`。
- 测试 176 → **177**。
变更记录（第八轮，ADR-027）：
- **交互触发范围新增「仅输入框内触发」档位**：只在输入框里点击/打字才触发暂停/停止/重新开始，
  滚动、普通点击都不影响刷新倒计时。三档由两个子开关组合（`interactionInputOnly` 优先）：
  `all`（任何交互）/ `outside-input`（输入框外，默认）/ `inside-input-only`（仅输入框内）。
- **两个子开关收进「用户交互时的刷新行为」卡片内部**（`border-l-2` 缩进），不再是平级的独立卡片，
  视觉上明确从属关系；同时加一行 `当前：…` 实时状态文案。**不做折叠子树**（避免多一步展开操作）。
- **「刷新类型」与上面的「间隔」粘成同一个视觉组**：外层一张卡片 + 中间分隔线，
  两个 Section 各加 `fused` 模式。
- **头部按钮语义重排**：位置与职责固定 —— 右侧永远是「开始」/「停止」，左侧只在开始后出现、
 只能是「暂停」/「继续」。不再出现"停止按钮跑到左边、右侧变继续"这种互换。
- 测试 160 → **176**（新增 `tests/interaction-scope.test.ts`，16 例）。
变更记录（第七轮，ADR-026）：
- **固定档「重新开始前等待」不再让用户填数字**，直接用当前固定刷新间隔；
  只有**随机档**才保留那个自定义输入框（随机档没有单一间隔值）。
- 这不只是 UI 改动：`restartWaitSeconds()` 改在**运行期**取值，
  所以固定档 `fixedSeconds=6` + `interactionRestartWait=5` 实际等待 **6 秒**（不是 5）。
- 固定档面板显示只读提示 `按当前刷新间隔等待（6 秒）`（新 key `act_restart_wait_fixed`）。
- 测试 154 → **160**（新增 `tests/restart-wait.test.ts`，覆盖固定/随机/负数/小数四种情况）。
变更记录（第六轮，ADR-025）：
- **修掉"面板宽度被 URL 撑开"的 bug**。根因是 ADR-023 只写了 `min-width: 400px` ——
  Chrome popup 按内容自动算宽，`min-width` 只有下限没有上限，所以长 URL 会把整个面板顶宽，
  导致切换页面时面板宽度来回跳。
- 现在 `body`/`#root` 三个属性一起写死：`width` + `min-width` + `max-width` 均为 400px，
  加 `overflow-x: hidden` 兜底。**面板宽度恒为 400px**。
- 所有可能超长的行都 `truncate`（省略号）并挂原生 `title`：
  `仅对当前页面生效：<pageKey>`、会话属于别的页面提示、选择器探测结果。
  原生 tooltip 在页面之上绘制，不参与布局，不会反过来撑开面板。
- 实测（逐个注入超长内容）：基线 / 500 字符 pageKey / 40 遍长状态行 / 300 字符 selector /
  400 字符 URL —— `root.scrollWidth` **全部是 400**。
变更记录（第五轮，ADR-024）：
- **固定档预设 chip 移到数字同一行右侧**（原来右侧大片空白、chip 独占第二行）。
  stepper 宽度 168→**128px**，卡片 106→**74px**，内容区 `scrollHeight` 623→**591**。
  实测 4 个 chip 同一行且右边缘正好贴卡片右边缘，无溢出。
- **预设 `5秒` 改为 `6秒`**（`FIXED_PRESETS: [3, 6, 10, 60]`）。
- **删除 `interval_every_seconds`**（`每 $1 秒刷新`）：chip 上行后没有第三行容它，
  且数字本身已在左边显示，再写一遍是重复信息。
变更记录（第四轮，ADR-023）：
- **面板改为紧凑布局**（用户明确：原 ARP 布局"过于松散、边距巨大"，要求极紧凑）。
  宽度 480→**400px**、区块间距 16→**8px**、卡片内边距 12–16→**6–10px**、
  正文字号 14→**12–12.5px**、辅助文字 11→**10.5px**、−/+ 按钮 36→**28px**、开关 20→**18px**。
- 不只是调数值，还做了结构性压缩：间隔摘要与数字同行、刷新类型说明并入标题行、
  XHR 的选择器行与两个按钮同行、触发方式与说明同行、重定向三行压成两行。
- 效果：内容区 `scrollHeight` 1141 → **623**，首屏可见段落 2 → **3**。
- 长文本（如长 pageKey URL）单行内 `truncate`，靠 `title` 悬浮看全文（R23）。
变更记录（第三轮，ADR-022）：
- **selector 与触发方式改为按页面（URL）隔离**——修掉"在 B 页选元素会把 A 页正在跑的会话目标改掉"的 bug。
  `pageKey = 协议//主机/路径`（忽略 query 与 #hash；**不是域名级**）。
- schema v2 → v3：`autoClickSelector` / `autoClickAction` 移出 `options`，
  改存独立键 `pageSelectors`（容量 300 页 LRU）。旧全局值**不自动写到任何页面**
  （迁移时猜 URL 会点错元素，比让用户重选一次危险）。
- 会话用 `Session.pageKey` **锁定启动时那个页面**，follow 模式下页面跳走也不改目标。
- 面板新增一行 `仅对当前页面生效：<pageKey>`；会话属于别的页面时额外提示。
- 测试 124 → 154（新增 `tests/page-selectors.test.ts` 26 例，含"写 B 不影响 A"）。
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

## 如何加载到 Chrome（重要：源码目录不能直接加载）

本项目用 **WXT + Vite** 构建，**源码目录里没有 `manifest.json`**
（manifest 由 `wxt.config.ts` 在构建时生成），所以
「加载已解压的扩展程序」选 `D:\data\code\co-built\AutoRefresh` 会**直接失败**。
这不是配置问题，是 MV3 扩展的加载机制决定的。

| 你想做什么 | 加载哪个目录 | 命令 |
| --- | --- | --- |
| **日常使用 / 验收**（推荐） | `.output\chrome-mv3` | `pnpm build` |
| **改代码后想自动重载** | `.output\chrome-mv3-dev` | `pnpm dev`（需保持终端运行） |

两点要注意：

1. **`pnpm dev` 的产物不是自包含的**。`chrome-mv3-dev/popup.html` 里有
   `http://localhost:3000/@vite/client` 这类引用，靠运行中的 dev server 提供代码与 HMR。
   所以它**只在 `pnpm dev` 跑着的时候能用**，关掉终端面板就白屏。
2. **不同目录 = 不同的扩展 ID = 两份独立配置**。manifest 里没有 `key` 字段时，
   Chrome 用**目录的绝对路径**派生扩展 ID。在当前环境实测：
   `.output\chrome-mv3` 与 `.output\chrome-mv3-dev` 会得到**两个不同的扩展**，
   各自有独立的 `chrome.storage.local` —— 你在一个里配的间隔，另一个看不到。
   想要"一套配置"，就固定从同一个目录加载。

推荐的日常流程：

```bash
pnpm build                          # 生成 .output/chrome-mv3
# chrome://extensions → 开发者模式 → 加载已解压 → 选 .output\chrome-mv3
# 之后每次改完代码，pnpm build 完点该扩展卡片上的「重新加载」即可（配置不丢）
```

> 顺带一个已知的坑：**扩展更新前就已打开的标签页不会自动注入 content script**
> （浏览器行为）。本扩展已用 `scripting.executeScript` 按需补注入兜底（ADR-014），
> 所以不需要手动刷新页面。但**重载扩展本身会让正在运行的会话停掉**，重启即可。



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