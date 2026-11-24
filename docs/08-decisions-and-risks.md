# 08 · 决策记录（ADR）、开放问题与风险

## 1. ADR（架构决策记录）

> 格式：`ADR-nnn · 标题` / 背景 / 决策 / 备选 / 后果。所有决策都可回滚，但回滚要新开 ADR。

### ADR-001 · 技术栈选 WXT + React + TS + Tailwind

- **背景**：仓库只有 LICENSE，从零起架；ARP 本身是 WXT 构建（`chunks/bg-*.js` 里可见 `wxt/storage`、`wxt/browser` 运行时）。
- **决策**：`wxt` + `@wxt-dev/module-react` + Tailwind v4 + TypeScript strict。
- **备选**：Vite 纯 MV3（配置自己写，热重载/多入口要自己拼）；原生 JS（面板状态多，手写维护成本高）。
- **后果**：`entrypoints/` 约定固定目录；`wxt build` 产物需在 `09` 里写成验收步骤（不依赖手工 zip）。

### ADR-002 · 只保留全局作用域

- **背景**：ARP 支持 `exact`(此 URL)/`domain`(此域名)/全局三层（`local:domain_config` + `local:site_scopes` + `save_scope_*`）。
- **决策**：删除三层，`options` 只有一份；面板不出现"当前站点/此域名"字样。
- **后果**：无法在同一浏览器为 A 站和 B 站设不同间隔（用户已接受）。实现更简单：会话只读全局配置。

### ADR-003 · keep-active 的会话 TTL 从 60s 提到 5min（有意偏离 ARP）

- **背景**：ARP `rb(tabId, on)` 写入 `sessionStorage.__arp_keep_active = Date.now()+60000`；
  `keep-active.js` 每 45s 派发伪活动，但 **TTL 只在 `lx()`（每轮刷新前）续期一次 60s**。
  若用户把间隔设为 5 分钟以上，"保持活动"在两次刷新之间会因 TTL 过期而失效
  （页面重载后 `keep-active.js` 判断 `TTL > now` 为假 ⇒ 不再打补丁 ⇒ `document.hidden` 恢复真实值）。
- **决策**：TTL = 5 分钟，且每轮刷新前续期；另外内容脚本在 `visibilitychange` 被拦下时也续期（双保险）。
- **备选**：完全照抄 60s（更"忠实"，但长间隔下是已知失效点）。
- **后果**：`sessionStorage` 里多一个键；对本扩展的"后台保持活动"可靠性是净收益。**这是唯一一处刻意偏离 ARP 行为语义的地方，验收时不要按 ARP 判错。**

### ADR-004 · 计时器托管在 offscreen 文档，SW 只做执行

- **背景**：ARP 在 SW 里跑 `dS()` 的自递归 `setTimeout`（`performance.now()` 计时，1s 拣选），
  并用内容脚本每秒 `refreshKeepAlive` 把 SW 一直唤醒。这是与 MV3 生命周期对抗的做法：
  SW 一旦被回收（内存压力、浏览器重启 SW、扩展更新），定时链断掉，只能靠 `persist_refresh_sessions` 恢复
  （ARP 的 `Vx()`）——恢复时点会偏移。
- **决策**：
  - `offscreen` 文档持有 `setTimeout`（离屏文档不会被"空闲回收"，只有关标签/浏览器才消失）；
  - 到期消息带 `timerToken`，SW 校验后执行；
  - 60s `PING` 存活探测 + `alarms` 1min 兜底。
- **备选 A**：照抄 ARP（SW 内 `setTimeout` + CS 心跳）——实现最省事，但"心跳把 SW 拉活"在 Chrome 上属于
  官方明确不建议的模式（会持续占用资源、且 `setInterval` 消息在 SW 冷藏后可能直接丢失）。
- **备选 B**：`chrome.alarms` 主计时——最小粒度 1 分钟，无法支持 3s/5s 间隔，**直接否决**。
- **后果**：manifest 需要 `offscreen` 权限（本项目唯一相对 ARP "新增"的权限，ARP 也有 `offscreen`，只是用途不同：它用来播提示音）；
  离屏文档的生命周期需要自己管（`06 §1.2` 的四个守卫）。

### ADR-005 · 周期定义：等待 → 刷新 → 计数 → 再等待（首轮立即刷新）

- **背景**：ARP 的周期是「扫描（内容脚本）→ 等待 → 刷新（重载）」。它靠扫描发现变化才重载。
  本扩展无扫描，"先扫后刷"没有意义。
- **决策**：`START` 立即执行一轮刷新 → 计算 delay → ARM → 到期再刷新。周期 = 间隔 + 刷新动作耗时。
- **后果**：与 ARP 的时间轴不同（ARP 首轮是"扫描"而不是"重载"）。验收按本扩展口径：**点开始后页面立刻刷一次**。

### ADR-006 · 保留"随机间隔避免连续两轮相同"，并做成开关

- **背景**：ARP `$_()` 明确避免 `nextRefresh === 上一轮`（`r === i ? $_(e,t+1) : r`，上限重试 10 次；`min===max` 或 `min>max` 时不启用）。
- **决策**：保留为默认开启的 `avoidRepeatRandom`，UI 里**不暴露**（保持面板精简），但配置项存在且可改（调试/将来）。
  若用户觉得"随机值偶尔被改写"不可接受，可关掉。
- **后果**：`min..max` 跨度极小时（如 5..6），"避免重复"会退化成强制交替（5,6,5,6）。这是 ARP 的既有行为，非 bug。

### ADR-007 · 非法输入一律拒绝，不静默回落

- **背景**：ARP `Kg(e)`：`Number.isFinite(t)&&t>0 ? t : 12000`（自定义间隔非法就变成 12 秒）；
  `f(e,t)=>{let n=Math.max(e,0); ...}`（随机范围负数被抬到 0）。
  用户看到的是"我填了 0.5，却每 12 秒刷一次"。
- **决策**：面板侧即时校验，非法值不落库、显示内联错误（`06` 的 `err_*` 文案）。
- **后果**：比 ARP 严格；迁移/导入非法值时需 clamp 到默认（`03` §5 `migrate`）。

### ADR-008 · 刷新后不等页面 `complete` 就进入下一轮等待

- **背景**：ARP 在 `tabs.onUpdated` 收到 `status:'complete'` 后才 `Jw()`（起下一轮）。
  因此 ARP 的实际间隔 = 间隔 + 页面加载时间。
- **决策**：`tabs.reload` 发出即视为本轮到点，立刻 ARM 下一轮。
- **备选**：等 `complete`（更"忠实"，但慢页面会把间隔拉长，用户设 5s 却 30s 才刷一次）。
- **后果**：页面加载慢于间隔时，浏览器会合并/中断 reload，实际刷新变慢——这是用户配置本身的结果。
  **若用户反馈"要等加载完"，改用备选只需在 `refresh.ts` 里加一个 `waitComplete`（1 处改动）。**

### ADR-009 · XHR 刷新保留"自动点击选择器"输入框（已获用户确认）

- **背景**：ARP 的 XHR 模式并不重放请求，而是点击页面元素让页面自己发 AJAX（`Q_()` → `vh('autoClick')`）。
  在砍掉监控与自动化之后，若做成"捕获并重放页面请求"，那是新增的高风险能力（要 hook `fetch`/`XHR`、要处理鉴权头、
  要防重放到错误 endpoint）。
- **决策**：忠实 ARP —— 保留选择器输入 + 点击。无选择器时该轮跳过点击（等价空转），并在状态摘要给弱提示。
- **后果**：XHR 模式的可用性依赖用户填对选择器；比"静默无动作"更可解释。

### ADR-010 · 刷新次数用 `>=` 而非 ARP 的 `>`

- **背景**：ARP：`if (o && l>0 && c>l) return $b(t)`，`c` 是**已完成**轮次，因此用户设 10 次实际会刷 11 次。
- **决策**：`count >= refreshLimitCount` 时停，设 10 次就刷 10 次。
- **后果**：与 ARP 差 1 次。`07` 的 T-12 按本扩展口径验收。

### ADR-011 · 主机权限安装即申请 `<all_urls>`

- **背景**：需要向任意页面注入内容脚本（交互上报 + XHR 点击 + keep-active MAIN 补丁）。
  ARP 用 `optional_host_permissions` + 运行时 `permissions.request`（`permissions.html`）。
- **决策**（用户已确认）：`host_permissions: ["<all_urls>"]`。
- **后果**：安装时提示"读取所有网站数据"；换来自用场景零摩擦。**不接受**该提示的发布场景需改回按需授权（另开 ADR）。

### ADR-012 · 不读取、不迁移 ARP 的存储

- **背景**：ARP 的键（`options`、`domain_config`、`site_scopes`、`refresh_sessions`…）+ schema 与本扩展不同。
- **决策**：`local:options` 用自己的 schema（`03` §1），首版 `__v:1`；完全不碰 ARP 键名。
- **后果**：装了 ARP 的浏览器里两者互不干扰。若用户要"从 ARP 导入"，作为显式功能单独立项。

### ADR-013 · 文档与代码同仓、随提交演进

- **决策**：`/docs` 进 git；每个里程碑在 `README` 的变更记录里加一行，`07` 的矩阵随实现补充"落点"列。
- **后果**：review 时先看 `07` 有没有新增未登记的偏离。

### ADR-014 · 内容脚本按需注入（补历史标签页）

- **背景**：扩展安装/更新之前就打开的标签页，浏览器不会补注入 content script；
  `chrome.tabs.sendMessage` 抛 `Could not establish connection`，早期实现直接判失败，
  用户体验是"必须刷新一次页面扩展才能用"。
- **决策**：`sendToContent` 首次失败后 `chrome.scripting.executeScript({files:['content-scripts/content.js']})`
  再重试一次。失败才注入，成功路径零开销。
- **后果**：`scripting` 权限的用途扩大一处（本来就为 keep-active 的 MAIN world 注入申请了）。
  重复注入是安全的 —— content script 的 `chrome.runtime.onMessage.addListener` 会重复注册，
  但因为每份实例都在独立执行上下文里持有自己的 `interactionEnabled`，行为无副作用；
  自愈脚本里的 `__arKeepActivePatched` 标记也保证补丁不重复安装。

### ADR-015 · XHR 的"点击"必须是完整 pointer/mouse 序列

- **背景**（实测，不是推测）：2026-11-24 用真实浏览器对照测量，
  对 Gmail 收件箱刷新按钮与网易邮箱刷新按钮：
  `el.click()` → **0 次**网络请求；完整 pointer/mouse 序列 → **每轮 1 次**。
  原因是这类 SPA 把交互逻辑挂在 `pointerdown` / `mousedown` 上。
- **决策**：`src/lib/dom-click.ts` 按浏览器真实顺序派发
  `pointerover → pointerenter → mouseover → mouseenter → mousemove → pointerdown → mousedown → pointerup → mouseup → click`，
  down 阶段 `buttons: 1`、up 阶段 `buttons: 0`，全部 `bubbles+cancelable+view`，并先 `scrollIntoView`。
- **后果**：不再依赖 `el.click()` 的"事件合成捷径"。**能力上限**：`isTrusted` 恒为 false，
  无法绕过需要真实用户手势的页面 —— 这是浏览器安全模型边界，不是缺陷。
  `tests/dom-click.test.ts` 用 happy-dom 断言序列与冒泡行为。

### ADR-016 · 失败轮次不计入刷新次数

- **背景**：用户实测踩到"面板计数在涨但页面一次都没刷新"的误导。
  根因是把"尝试过一轮"当成了"刷新了一轮"。
- **决策**：`executeRound` 中**只有 `outcome.ok` 才 `count += 1`**；
  失败时记 `lastError`（`RefreshFailureCode`）、累加 `failedRounds`、徽章变红，
  但仍按原间隔重试（用户改正选择器即可自愈）。
- **后果**：`count` 的语义从"尝试次数"收紧为"**成功次数**"，与用户直觉一致；
  与 ARP 的计数口径不同（ARP 不区分成功失败），`07` 的 T-12/T-31 按本扩展口径验收。

### ADR-017 · i18n key 必须只用 `[a-zA-Z0-9_]`

- **背景**：实现期把运行期失败 code 写成 `xhr-not-found` 并直接作为 `_locales` 的 key，
  导致**扩展加载直接失败**：`Name of a key "tab-gone" is invalid.
  Only ASCII [a-z], [A-Z], [0-9] and "_" are allowed.`
- **决策**：所有 `ErrorCode` / `RefreshFailureCode` 同时作为 locale key，
  因此统一用下划线命名（`xhr_not_found`、`tab_gone`…）。
  `tests/i18n.test.ts` 增加一条断言把这类错误挡在构建前。
- **后果**：错误码不再能写连字符；`RefreshFailureCode` 与 locale key 一一对应，
  面板可以直接 `t(session.lastError)`。

### ADR-018 · 元素拾取器用内容脚本自建覆盖层，不申请 `debugger` 权限

- **背景**：需求要"类似 DevTools `Ctrl+Shift+C` 的元素选择模式"。原生可选方案有：
  `chrome.devtools.inspectedWindow`（只在 devtools 页可用，popup 调不到）、
  `chrome.debugger` + CDP `Overlay.setInspectMode`（能拿到 DevTools 原生高亮）。
- **决策**：自建覆盖层。`debugger` 方案的技术代价：① 多一条"调试其他应用"重警告权限；
  ② 每次使用浏览器顶部常驻"正在调试此浏览器"横条；③ 与用户自己的 DevTools 互斥
  （同一 tab 只能 attach 一个调试器）；④ 页面导航后会话易断。
  对一个刻意收成"只有一个轻量面板"的自用扩展，这些代价远大于收益。
- **后果**：拾取器 UI 需要自己实现（高亮框 + 悬浮卡片 + 事件拦截），
  但零额外权限、无横幅、不干扰 DevTools。这也是所有主流选择器类扩展的做法。
  实现细节见 `10` §1.5。

### ADR-019 · 选择器生成采用 5 层降级，语义属性优先于结构路径

- **背景**：用户要求的优先级是「结构 > id > class > 普通」，并提出"结构描述不依赖元素信息"的
  偏好。但实测 Gmail 的「刷新」按钮只有图标、没有文字，`[aria-label="刷新"]`
  是唯一既短又稳的抓手；纯结构路径会得到 `body > div:nth-of-type(2) > … > div`。
- **决策**（用户已确认）：**语义属性（`aria-label` / `data-tooltip` / `title` / `name` /
  `alt` / `placeholder`）排在最前**，其后才是结构路径、id、class、兜底组合。
  每层都必须产出"唯一命中该元素"的 selector（`document.querySelectorAll(sel)` 长度 === 1
  且 `[0] === el`），不唯一就降级；结构路径还要做**最小化**（逐段删，仍唯一就保留删除）。
- **后果**：稳定性优先于形式偏好。同时引入 id/class 稳定性启发式
  （跳过含 3+ 连续数字、哈希后缀、框架前缀、状态后缀、需转义的名称），
  最终以实测唯一性为准。见 `10` §1.6。

### ADR-020 · 单击/双击同步派发，不加人为延时

- **背景**：双击需要两次完整的按下-抬起序列。是否要在两次之间 `setTimeout` ~50ms
  （模拟真人）？
- **决策**：**同步派发，0ms 间隔**。理由：真实浏览器双击判定窗口约 400ms，
  0ms 间隔必然落在窗口内；加异步反而给页面机会在两次点击之间重渲染，
  第二次可能打到已脱离文档的元素。`click` 的 `detail` 依次为 1、2，
  末尾补 `dblclick`（`detail: 2`），覆盖"靠 `detail` 判双击"的页面。
- **后果**：两次单击都各自生效（用 click 计数、不看 detail 的页面也得到两次 click）。
  能力上限同 ADR-015：合成事件 `isTrusted` 恒为 false。

### ADR-021 · 间隔模型简化为"单一数据源"（schema v1 → v2）

- **背景**：用户提出三条：① 「自定义」tab 多余，一个操作要在 tab 间跳转；
  ② 固定 tab 里出现第二个数字输入框多余；③ −/+ 在预设间跳转是错的。
- **决策**（用户已确认可删字段并升级 schema）：
  - `IntervalMode` 去掉 `'custom'`，分段控件从 3 段变 2 段（固定 / 随机）
  - **删** `customSeconds`、`fixedPreset`（及 `FixedPreset` 类型）
  - `fixedSeconds` 成为固定档**唯一数据源**；−/+ 对它做 `∓1`；chip 把数字**上屏**；
    手动输入直接改它。三者写同一字段。
  - chip 高亮条件退化为纯值匹配（`fixedSeconds === preset`），
    即**主动放弃**原设计里"值相等但意图不同"的消歧 —— 值就是意图。
  - `schemaVersion` 1 → 2，迁移时 `intervalMode='custom'` 的 `customSeconds`
    **保值为 `fixedSeconds`**（不静默丢成 10 秒），并有单测覆盖。
- **后果**：`03` §1 的设计取舍段落需要重写；`nextPresetUp/Down` 删除；
  运行中改间隔仍然只影响下一轮（语义不变）。见 `10` §3。

## 2. 开放问题（**已全部关闭**，结论见下表；实现按结论落地）

| ID | 问题 | 结论（用户已确认或已采纳默认） | 落地 |
| --- | --- | --- | --- |
| **OQ-1** | 「用户交互时的刷新行为」与「用户交互时的更新行为」是**一个**功能的两处叫法（ARP 底层同写 `options.interactions`），要做成 1 个开关还是 2 个独立开关？ | ✅ **1 个开关 + 行为三选一**。底层只有一个字段，拆两个会出现"关掉一个、另一个还开着"的未定义语义 | `04` §4.3 A4/A7 合并行；`src/components/OptionsSection.tsx` |
| **OQ-2** | 运行中面板是否显示「下次刷新 N 秒」？ | ✅ **显示**，且带进度「N 秒后刷新 · 第 M 次」。需求里"不要倒计时"指的是 ARP 的倒计时 tab / 页面内浮层，面板内状态摘要不属于该类 | `src/components/Header.tsx` `statusLine()`；`status_next_in` |
| **OQ-3** | 「防止重新提交表单」（ARP 的 `preventFormResubmission`，premium）是否加回？ | ✅ **不加**（不在需求清单） | 无对应字段 |
| **OQ-4** | 是否显示扩展图标徽章（badge）表示运行中/已暂停？ | ✅ **显示**：运行中绿 `●`、暂停黄 `II`、停止清空 | `background.ts` `updateBadge()` / `clearBadge()` |
| **OQ-5** | 自定义间隔允许小数吗？最小可输入值是多少？ | ✅ **只要整数**（用户明确："不要小数, 整数就够用了"）。所有间隔输入为 ≥1 的整数秒，上限 86400，**拒绝小数**（`2.5` 不再被 `parseInt` 悄悄截成 2） | `src/lib/number-input.ts` `parseStrictInt` / `parseIntInRange`；`err_not_integer`；`tests/number-input.test.ts` |
| **OQ-6** | 是否需要「停止后恢复滚动位置」/「刷新后滚动回原位置」？ | ✅ **不做**。整页 reload 天然回到顶部 | 无对应字段 |

> OQ-5 的结论推翻了本文初版默认值（曾按 ARP 的 `0.10 Sec` 允许小数）。
> 由于要拒绝小数，引入 `parseStrictInt`：**不能用 `Number.parseInt`** ——
> 它会把 `"2.5"` 截成 `2`、`"12abc"` 截成 `12`，用户看到的是"输入被接受但值变了"。
> 这一条同时在 `07` §5.1 与 ADR-007 里交叉引用。

## 3. 风险清单

| # | 风险 | 可能性 | 影响 | 缓解 |
| --- | --- | --- | --- | --- |
| R1 | **MV3 SW 回收导致刷新任务丢失** | 中 | 高（用户以为在刷，其实停了） | ADR-004 的四重守卫；`09` T-40 专门测"重载扩展后是否自愈"（本轮已手工验证通过） |
| R2 | offscreen 被浏览器回收（低内存设备） | 低 | 高 | `PING` 探活 + 重建；`alarms` 兜底（`watchdog()` 容忍 30s 迟到） |
| R3 | **keep-active 被页面自身逻辑抵消**（页面用 `IntersectionObserver`/`requestAnimationFrame` 判活，或自己改回 `hidden`） | 中 | 中（后台标签页仍被节流） | 文档里明确"尽力而为"；补丁用 `configurable:true` 且可重复打；`09` T-11 用真实站点验证 |
| R4 | XHR 模式选择器失效（页面改版） | 高 | 中 | 失败只记 `lastError` 并弱提示（`hint_xhr_needs_selector`），不影响整页刷新路径 |
| R5 | reload 抖动：3s 间隔 + 慢页面 ⇒ 页面永远加载不完 | 中 | 中 | ADR-008 已接受（发 reload 即算本轮完成，不等 `complete`）；短间隔由用户自行选择 |
| R6 | `chrome.i18n` 缺 key 时取到空串 | 低 | 低 | `t()` 回退键名 + `tests/i18n.test.ts` 校验 key 全集与占位符语法 |
| R7 | 用户把间隔设成极小值（1s）导致刷屏/被目标站限流 | 中 | 中 | ADR-007 拒绝非法，1 是合法下限（尊重 OQ-5 的整数要求）；不做硬性上限兜底，属于用户选择 |
| R8 | 与已装的 ARP 同时运行（两扩展都改 `document.hidden`、都 reload） | 低 | 中 | 键名前缀 `__ar_` 区分；禁用 ARP 时可避免 |
| R9 | 验收把"与 ARP 有意的偏离"误判为 bug | 高 | 中 | `07` §5.1 与 ADR-003/008/010 显式列出偏离点，验收清单逐条引用 |
| R10 | `<all_urls>` 装权限导致企业策略拒装 | 低 | 中 | ADR-011；必要时切按需授权 |
| R11 | **i18n 占位符写成 `%1`**（Chrome 实际语法是 `$1`），界面出现字面 `%1秒` | 已踩到 | 中 | 本轮已修；`tests/i18n.test.ts` 增加一条"禁止 `%N`"的断言防回归 |
| R12 | 面板在小屏（<600px 高）时首屏被 `min-width:480px` 挤压 | 低 | 低 | ARP 也是 `min-width:480px`；内容区 `overflow-y-auto` 已验证 `scrollHeight 882 / clientHeight 541` 可滚 |
| R13 | **拾取器只能选主文档元素，选不到 iframe 内**（内容脚本 `allFrames:false`） | 高 | 中 | 悬浮卡片明确提示"只支持当前页面主文档"；后续可改 `allFrames:true` + 按 frameId 聚合（`10` §1.5） |
| R14 | **拾取时 popup 必被关闭**（点页面即关闭），用户误以为失败 | 高 | 中 | 三层兜底：页内卡片显示结果 + `chrome.action.openPopup()` 自动回开 + 徽章闪烁 `✓`（`10` §1.4） |
| R15 | 页面有更高 z-index 元素压住拾取器 | 低 | 低 | 用 `z-index: 2147483647`（CSS 上限） |
| R16 | 页面 `stopImmediatePropagation` 挡住拾取器监听 | 低 | 中 | 监听挂在 `window` 的**捕获阶段**（早于目标元素上的监听） |
| R17 | 页面把双击做了去抖（300ms 内两次 click 只算一次） | 中 | 中 | 页面自身逻辑，本扩展无法绕；行为与真人双击一致即可（ADR-020） |
| R18 | 页面要求 `event.detail` 递增才认双击 | 中 | 低 | 已按 1→2→`dblclick(detail:2)` 派发（ADR-020） |
| R19 | 生成的 selector 在页面改版后失效 | 高 | 中 | 失败时红字 + 徽章红点（ADR-016）；`10` §1.7 的「指纹兜底」方案可进一步缓解 |
| R20 | schema v2 迁移丢失用户原来的自定义间隔 | 低 | 中 | 迁移显式保留 `customSeconds` → `fixedSeconds`，并有单测（`10` §3.3 / T-87） |

## 4. 变更记录

| 日期 | 变更 | 作者 |
| --- | --- | --- |
| 2026-11-24 | 初版：13 条 ADR、6 个开放问题、10 项风险 | lead |
| 2026-11-24 | OQ-1..OQ-6 全部关闭（OQ-5 改为「只要整数」）；新增 R11/R12；风险缓解措施标注实测结论 | lead |
| 2026-11-24 | 补 ADR-014（内容脚本按需注入）、ADR-015（完整点击序列）、ADR-016（失败不计次数）、ADR-017（i18n key 字符集） | lead |
| 2026-11-24 | **设计稿轮次**（未实施）：新增 ADR-018（拾取器自建覆盖层，不申请 `debugger`）、ADR-019（选择器 5 层降级，语义属性优先）、ADR-020（双击同步派发）、ADR-021（间隔单一数据源 / schema v2）；新增 R13–R20 与 OQ-7。详细设计见 `10` | lead |
