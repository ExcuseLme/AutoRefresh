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


### ADR-022 · XHR 的 selector 与触发方式按页面（URL）隔离

- **背景**：v2 里 `autoClickSelector` / `autoClickAction` 是 `options` 的全局字段
  （ADR-002 丢弃了 ARP 的 `domain_config` 多作用域结构，连"按域名"都没了）。
  用户实测发现：**在 B 页选元素会把 A 页正在跑的会话目标一起改掉** ——
  两边共享同一个可变单元格。用户明确要求按 **URL 级别**隔离，不是域名级。
- **决策**（用户已确认三项）：
  1. `pageKey = 协议//主机/路径`，**忽略 query 与 #hash**。
     hash 忽略 ⇒ Gmail 切文件夹共用；query 忽略 ⇒ 网易邮箱 `?sid` 变了仍有效；
     但不同路径是不同页面 ⇒ **不是域名级**。
  2. `autoClickAction` **跟 selector 一起按页面存**（它本来就是"该页面那个元素的属性"）。
  3. 运行中的会话**锁定启动时那个页面的配置**（`Session.pageKey` 记录后永不改写）。
- **存储**：从 `options` 移到独立键 `pageSelectors`（`chrome.storage.local`）。
  分开的好处：改一个页面的 selector 不触发全局配置广播、`options` 体积不随页面数增长。
- **后果**：schema v2 → v3；`migrateV2ToV3` 删掉两个全局字段且**不把旧值写到任何页面**
  （迁移时无从得知它属于哪个 URL，猜错会在错误页面上点错元素 ——
  比"让用户重选一次"危险）。容量上限 300 页（LRU 淘汰）。见 `11`。

### ADR-023 · 面板改为紧凑布局，不再对齐 ARP 的松散视觉

- **背景**：用户明确反馈"原扩展这个布局风格过于松散，边距巨大，我极其厌恶这种浪费空间的
  宽松布局"，要求改成极其紧凑的布局（但保留必要的换行与一点边距，不做强行挤压）。
  原实现是照 ARP 截图对齐的（`min-width: 480px`、卡片 `p-3`、区块 `gap-4`），
  首屏只能看到约 2 个段落。
- **决策**：视觉基线从"对齐 ARP"切换为"信息密度优先"。具体量化：

  | 维度 | 改前 | 改后 |
  | --- | --- | --- |
  | 面板宽度 | 480px | **400px** |
  | 内边距（页面级） | `px-4 py-3` | **`px-2 py-2`** |
  | 区块间距 | `gap-4` (16px) | **`gap-2` (8px)** |
  | 卡片内边距 | `p-3` / `px-4 py-3` | **`px-2.5 py-1.5`** |
  | 圆角 | `rounded-xl` | **`rounded-lg` / `rounded-md`** |
  | 正文 | 14px (`text-sm`) | **12–12.5px** |
  | 辅助文字 | 11px | **10.5px** |
  | 分段控件 | `py-2` + 14px | **`py-1` + 11px**，外壳 `p-0.5` |
  | 数字输入 −/+ | `h-9 w-9` | **`h-7 w-7`**；数字 30px → **20px** |
  | 开关 | `h-5 w-9` | **`h-[18px] w-8`** |
  | 选项行图标 | `h-8 w-8` | **`h-5 w-5`**，内 SVG 16→12px |
  | 折叠面板高度上限 | 600px | **560px** |

- **结构性压缩**（比调数值更有效）：
  1. 间隔档：摘要行不再独占一行，与数字同一行右对齐；chip 独占第二行
  2. 刷新类型：标题与说明合并成一行（说明右侧灰字），省掉整段说明占位
  3. XHR 区：选择器输入框上方那行与两个按钮同行；«仅对当前页面生效» 等辅助信息
     压进一行小字（`truncate` + `title` 悬浮看全文）
  4. 触发方式：分段控件与说明同一行
  5. 重定向：从三行（标题+下拉+说明各自成行）压到两行
- **代价 / 边界**：长文本（如很长的 pageKey URL）在单行内会被 `truncate` 截断，
  靠 `title` 属性悬浮看全文。这是刻意的取舍：用户明确厌恶"浪费空间"，
  比"必须完整显示但占三行"更符合诉求。
- **后果**：首屏可见段落从 ~2 个增加到 ~3 个（`scrollHeight 623 / clientHeight 518`，
  滚动量从 1141 降到 623）；`04` §7 的"沿用 ARP 宽度"描述已被本节取代。

### ADR-024 · 固定档预设 chip 与数字输入同行，预设 5 秒改 6 秒

- **背景**：ADR-023 紧凑化后，固定档卡片右上角出现大片空白：stepper 占 168px、
  单位"秒"占一点，右侧剩下约 230px 全空，而 4 个 chip 却排在第二行。
  用户指出"它的右侧空荡荡的，空余空间似乎能刚好容纳下这几个档位元素"。
  同时用户要求把预设 [5] 改成 [6]。
- **决策**：
  1. **chip 移入数字同一行右侧**（`ml-auto`），卡片从两行变一行。
     stepper 宽度从 168px 收到 **128px**（−/+ 仍 28px，数字仍 20px，只是中间留白变少）。
     实测：4 个 chip 全部落在同一行，最右 chip 右边缘 = 卡片右边缘（`fitsInCard: true`）。
  2. **`FIXED_PRESETS` 从 `[3, 5, 10, 60]` 改为 `[3, 6, 10, 60]`**。
  3. **删掉 `interval_every_seconds`**（`每 $1 秒刷新`）摘要行 ——
     chip 上行后没有第三行容它，而"数字本身就在左边显示着，再写一遍是重复信息"。
     卡片高度从 106px → **74px**，内容区 `scrollHeight` 623 → **591**。
- **后果**：固定档只剩一行，是面板里最紧的一块。删 key 不影响其它文案
  （`interval_random_summary` 保留，随机档仍需要"每 5–30 秒"这种区间表达）。

### ADR-025 · 面板宽度写死 400px，超长文本截断 + title 悬浮

- **背景**：用户反馈"整个扩展面板的宽度会被 `仅对当前页面生效：` 这行动态显示的当前 url 撑开，
  在不同 url 长度的页面中扩展面板的宽度不一致，导致在不同页面间来回使用本扩展时
  打开看到的扩展面板宽度来回变化体验极差"。
- **根因**：ADR-023 只写了 `min-width: 400px`。Chrome popup 的宽度按内容自动计算，
  `min-width` 只给下限、不给上限 ⇒ 内容里只要有一行超长文本（典型就是长 URL），
  整个面板就被撑宽。`truncate` 类只对**有宽度约束的块级元素**生效，
  而 `#root` / `body` 本身没有上限，所以内容照样把容器顶开。
- **决策**：
  1. `body` / `#root` 三个属性一起写死：`width: 400px` + `min-width: 400px` + `max-width: 400px`，
     再加 `overflow-x: hidden` 兜底。这样无论内容多长，面板宽度恒为 400px。
  2. 所有可能超长的文本行都 `truncate`（`overflow: hidden` + `text-overflow: ellipsis` +
     `white-space: nowrap`）并挂 `title` 属性：
     - `仅对当前页面生效：<pageKey>`
     - 会话属于别的页面的提示
     - 选择器探测结果（`命中 N 个元素：<preview>`）
  3. `title` 用的是浏览器**原生 tooltip**，由浏览器在页面之上绘制，
     不参与布局、不影响 popup 宽度 —— 用户担心的"tooltip 太长把面板撑开"不会发生。
- **验证**（真实浏览器逐个场景注入超长内容，面板宽度始终 400）：
  | 场景 | `root.scrollWidth` |
  | --- | --- |
  | 基线 | 400 |
  | 注入 500 字符 pageKey | 400 |
  | Header 状态行塞 40 遍长文案 | 400 |
  | 选择器输入框塞 300 字符 selector | 400 |
  | 注入 400 字符 URL（截图留档） | 400，文本 `scrollW 2268 / clientW 347` 说明确实被截断 |
- **后果**：不再有"宽度随页面跳动"。代价是长 URL 只能看到前约 40 个字符
  （400px 面板下），完整内容靠鼠标悬浮。这与 ADR-023 的密度优先一致。

### ADR-026 · 「重新开始前等待」在固定档直接用当前间隔，只有随机档才给输入框

- **背景**：`用户交互时的刷新行为` 开启并选「重新开始」时，面板会让用户填一个
  「重新开始前等待 [N] 秒」。用户要求：**固定档不要让人再填**，直接复用当前固定刷新间隔；
  **只有随机档**才提供那个自定义数字输入框。
- **理由**：固定档只有一个明确的"当前间隔"数值，再单独填一个等待秒数属于重复配置，
  且很容易配成两个不一致的数（间隔 30s、等待 5s，用户看到"5 秒后重新开始"会以为间隔变了）。
  随机档没有单一数值（在 min..max 之间取），必须有一个独立值。
- **决策**：
  1. 数据层 `restartWaitSeconds(opt, fallback)`：
     `intervalMode === 'fixed'` ⇒ 取 `opt.fixedSeconds`；否则取 `interactionRestartWait`。
     `decideInteraction` 改用它，因此**运行期行为**也跟着变了，不只是 UI。
  2. 面板：固定档显示只读提示 `按当前刷新间隔等待（N 秒）`（新 key `act_restart_wait_fixed`），
     不渲染输入框；随机档保留原来的「重新开始前等待 [N] 秒」。
  3. `interactionRestartWait` 字段**保留**（随机档仍要用，也避免又升 schema）。
- **后果**：固定档下 `interactionRestartWait` 变成"只在随机档生效"的字段。
  验收：固定档 `fixedSeconds=6` + `interactionRestartWait=5` ⇒ 实际等待 **6 秒**（不是 5）；
  随机档 ⇒ 仍取自定义值。

### ADR-027 · 交互「触发范围」三档 + 视觉分组 + 头部按钮语义重排

用户提出两件事，合并为一条决策记录。

**(A) 交互触发范围**

- **问题**：原来的交互开关在"任何交互"上都触发（点一下页面、滚一下鼠标都会暂停/停止刷新），
  用户希望有一个「只在输入框内点击或打字时才触发」的档位，普通点击与滚动不影响刷新倒计时。
- **决策**：把触发范围做成**三档**，由两个子开关组合决定，且 `interactionInputOnly` 优先：

  | interactionInputOnly | ignoreInputField | 生效档位 | 谁会触发 |
  | --- | --- | --- | --- |
  | false | false | `all` | 任何交互 |
  | false | true | `outside-input` | 只有输入框**外**的交互（默认） |
  | true | — | `inside-input-only` | 只有输入框**内**的点击/打字 |

  为什么 `interactionInputOnly` 要优先：如果两者同时为真且都生效，就是"任何交互都不触发"的
  死状态，用户会以为功能坏了。优先级保证状态总是可解释的。
- **互斥规则是单向的**（`exclusiveScopePatch`）：
  - 开「仅输入框内」⇒ **不动** `ignoreInputField`，这样关掉它能自动回到原来那一档
  - 开「忽略输入框交互」⇒ 必须同时关掉 `interactionInputOnly`，否则点下去看起来没反应
  - 两项都**不置灰**：置灰会导致"开了 A 就没法直接切到 B，得先回去关 A"，多一步且容易卡住
- **可发现性**：缩进块里加一行实时状态文案 `当前：…`，避免"两个开关看不懂哪个在生效"。

**(B) 视觉分组**

- **问题**：`忽略输入框交互` 原来与 `用户交互时的刷新行为` 是**平级的独立卡片**，
  视觉上看不出从属关系，用户难以理解这两个选项是什么意思；`刷新类型` 也与上面的
  数字选择器是分离的两张卡片。
- **决策**：用**同一张卡片 + 左侧竖线缩进**表达从属，而不是做成需要展开/折叠的子树 ——
  用户明确说"这样会导致多出一个展开/折叠操作，将操作复杂化了"。
  - 两个触发范围开关 → 收进「用户交互时的刷新行为」卡片内部，`border-l-2` + `pl-2` 缩进
  - `IntervalSection` 与 `RefreshTypeSection` 都新增 `fused` 模式：自身不画边框/圆角/背景，
    由 `App.tsx` 用一张外层卡片包住，中间加一条分隔线
- **代价**：`IntervalSection` / `RefreshTypeSection` 各自多了一个 `fused` 分支（约 3 行）。

**(C) 头部按钮语义重排**

- **问题**：原实现的三个按钮会**互换内容**（点暂停后左侧变「停止」、右侧变「继续」），
  停止按钮可能出现在左也可能在右，用户反馈"位置极其诡异"。
- **决策**：位置与职责**固定**，不再互换：

  | 状态 | 左侧副按钮 | 右侧主按钮 |
  | --- | --- | --- |
  | 未运行 | （不渲染） | **开始** |
  | 运行中 | **暂停** | **停止** |
  | 已暂停 | **继续** | **停止** |

  右侧永远是「开始」或「停止」，左侧只会在开始之后出现、只可能是「暂停」或「继续」。
- **实现**：`Header` 的 `active = session !== null`，主按钮按它二选一；
  副按钮只在 `active` 时渲染。暂停态点右侧「停止」也能直接停（不必先「继续」）。

### ADR-028 · 触发范围改为三段 SegmentedControl；修掉 flex 子项被压缩导致内容被裁的 bug

本条修正 ADR-027 的两个遗留问题。

**(A) 两个开关 ⇒ 三段枚举**

- **问题**（用户提出）："'仅输入框内触发'和'忽略输入框交互'两个开关是不是应该互斥？"
  —— 应该，但 ADR-027 的实现只做到了**行为上互斥**，数据里仍能出现
  `{interactionInputOnly:true, ignoreInputField:true}` 这个冗余组合。
- **根因**：想要的其实是三段互斥状态，却用 2 个布尔表达 ⇒ 4 种组合里 3 种合法、1 种非法。
  ADR-027 为此打了三个补丁（优先级 / 强制关另一个 / 置灰），每个都有副作用，
  属于"掩盖非法态"而不是"消除非法态"。
- **决策**：改成三档 `SegmentedControl`（`任何交互` / `仅框外` / `仅框内`）。
  互斥由枚举本身保证，没有非法态、不需要优先级、不需要"记住上一档"。
  **不改 schema**：仍存两个布尔，由 `scopePatch(scope)` / `triggerScope(opt)` 双向映射，
  老数据（`{true,true}`）读出来是 `inside-input-only`，行为与之前一致，无需迁移。
- **代价**：UI 从"两个开关"变成"一个分段控件"，与 ADR-027 里用户要求的形态不同；
  但用户已确认按此方案执行。

**(B) flex 子项被压缩 ⇒ 「刷新类型」整块被裁掉**

- **问题**（用户提出）："`刷新类型 重新加载整个页面` 这行字只露出了上半截，
  后面的内容被藏入该分组卡片下方不可视区域内了，同样的 xhr 刷新和整页刷新这个交互组件也被藏进去看不见了"。
- **根因**：内容滚动容器是 `flex flex-col ... overflow-y-auto`。
  在 `flex-col` 容器里，直接子项默认 `flex-shrink: 1`，当总内容高度超过容器时，
  **子项会被压扁**（而不是让容器滚动）。压扁后子项自身的高度小于内容高度，
  内层 `overflow-hidden` 再把超出部分裁掉 ⇒ 表现为"文字只露上半截、后面的组件消失"。
- **证据**（修复前实测）：`fused 卡片 h=96 但 scrollHeight=136`，且 `overflow: hidden` ⇒ 被裁 40px。
- **决策**：滚动容器加 `[&>*]:shrink-0`，所有直接子项不参与收缩，让容器自己滚动。
- **验证**（修复后）：`fused 卡片 h=138 / scrollHeight=136`（不再裁切），
  三个 section 的 `scrollHeight === clientHeight`，XHR 模式下
  「选择元素」「测试选择器」按钮、"示例 #refresh-btn…" 输入框、「触发方式」行
  `inView` 全为 `true`（确实在可视区内）。
- **这是一类通用陷阱**：任何 `flex-col + overflow-auto` 的滚动容器都要给子项加 `shrink-0`，
  否则内容多时会被压扁而不是滚动。

### ADR-029 · 版本号单一真源 + 面板显示版本号

- **背景**（用户质问）："改了这么久了，你从未更新扩展的版本号，是故意的还是疏漏？"
  —— 是疏漏。`version: '0.1.0'` 在初始提交时设定，之后 15 个提交（6 feat / 4 fix / 5 other）
  全都沿用未动。`docs/09` 的里程碑检查项里**根本没有"更新版本号"这一条**，
  所以每轮都只遵守了那四项（build / test / 07 矩阵 / README 一行）。
- **次因**：版本号在 `package.json` 和 `wxt.config.ts` **各写了一份**，
  重复的真源必然漂移（这里表现为"两处都没更新"，但同样可能只更新一处）。
- **再一个次因**：`docs/04` 第 55 行写着"**不显示版本号**"（那是对齐 ARP 时的决定），
  造成了"版本号无关紧要"的错觉 —— 但"面板不显示"与"manifest 版本要递增"是两件事。
- **决策**：
  1. **单一真源 = `package.json` 的 `version`**。删掉 `wxt.config.ts` 里硬写的 `version`，
     WXT 构建时自动从 package.json 读取并写入 manifest（已验证：改 package.json ⇒ 产物 manifest 同步）。
  2. **面板头部显示版本号** `v{manifest.version}`，通过 `chrome.runtime.getManifest().version`
     读取**运行中扩展的**版本 —— 这样它就成为一个"是否重载成功"的指示器：
     重载后数字变了 = 新构建生效；没变 = 还在跑旧产物。
     这正是用户提出该需求的动机（"方便我观察扩展是否重载成功了"）。
  3. **`docs/09` 里程碑检查项新增一条**：`package.json` 的 `version` 已递增。
  4. **约定**：以后每次改动都递增版本号。功能增量用 minor（`0.2.0`、`0.3.0`…），
     纯修复用 patch；不逐个补历史 15 个提交（历史已压平，补不出真实语义）。
- **编号起点**：`0.1.0`（M0-M3 骨架，初始提交）→ **`0.2.0`**（累计 6 个 feat 的成果）。
- **与 ARP 的差异**：ARP 那行是 `v9.3.0 / Updated`（版本 + 更新日期，属于发布信息）；
  本扩展只显示版本号，不带更新日期。
- **风险**（R24）：版本号靠人工递增，仍可能漏。
  但有面板可见的指示器 + 检查项后，漏掉的概率大幅下降；真要根治可做脚本校验（暂不必要）。

### ADR-030 · 拾取器"选中手势"不得穿透到页面（sweep 阶段）

- **背景**（用户 bug 报告）："`选择元素`功能有个 bug，在我使用该功能对一个元素点击表示
  '我想对这个元素触发 xhr 刷新'时，这次点击会直接触发对该元素的点击事件，
  但这次点击只应该用于元素选择不应该穿透到真实页面"。
- **根因**：拾取器在 `pointerdown` 里就判定"选中"并**立刻 `teardown()`**（把监听全摘掉）。
  但一次左键点击的事件序列是：
  ```
  pointerdown → mousedown → pointerup → mouseup → click
  ```
  `pointerdown` 上 `preventDefault()` 只抑制"默认动作"，**不会阻止后续事件继续派发**。
  所以 `onPickDown` 里 `teardown()` 之后，紧随其后的 `mousedown`/`pointerup`/`mouseup`/`click`
  都没有监听拦截了，全部落到真实页面 —— 用户看到的就是"选元素那一下把页面按钮点了"。
- **决策**：把拾取器生命周期拆成三段，新增 **sweep 阶段**：
  | 阶段 | 含义 | 监听 |
  | --- | --- | --- |
  | `hover` | 高亮跟随鼠标，等待用户点 | mousemove/mousedown/pointerdown/click/dblclick/contextmenu/keydown/blur/pagehide |
  | `sweep` | **已选中**，本次手势剩余事件还没发完 | pointerdown/mousedown/pointerup/mouseup/click/dblclick/auxclick（全部 swallow） |
  | `torn` | 已拆干净 | 无 |
  - 选中时**先**把 hover 的监听换成 sweep 的监听（而不是直接 `teardown()`），
    并把高亮/十字准星/宿主节点立即撤掉（用户已经选完，不该再看到"还在选"）。
  - sweep 持续到**吞掉 `click`** 为止（click 是这串事件的最后一个），然后才真正 teardown。
  - 兜底：`setTimeout(endSweep, 400)` —— 按下后拖走导致 click 永远不来时也要能收尾。
  - `mousedown`/`pointerdown` 也必须在 sweep 列表里：`pointerdown` 的 `preventDefault()`
    **不会**抑制兼容性的 `mousedown`，而 beginSweep 刚把 hover 的 pointerdown 监听摘掉了，
    不补回来就会漏到页面（有些页面就是靠 `mousedown` 做事的）。
- **验证**：
  - 单测 `tests/picker-sweep.test.ts`（4 例）：选中后完整的
    `pointerdown→mousedown→pointerup→mouseup→click` 序列，页面监听计数**必须全为 0**；
    sweep 结束后拾取器退出、页面点击恢复正常生效；hover 阶段的 click 也不穿透；
    未命中元素时不确认且继续停留 hover。
  - 真实浏览器（本地测试页，按钮上挂了五种事件的计数器）：
    拾取模式下点该按钮 ⇒ `clicks=0 pointerdown=0 mousedown=0 pointerup=0 mouseup=0 click=0`，
    同时 `pageSelectors` 正确写入 `#btn`；拾取结束后再点 ⇒ 正常计数 5/5。
- **代价**：拾取器多了一个状态与一个 400ms 定时器；`activeCleanup` 在 sweep 期间仍然有效，
  所以"强制停止"（导航走 / SW 要求停止）依旧能立即拆干净。

### ADR-031 · 「测试选择器」滚动+呼吸高亮；扩展图标实时倒计时

用户提两件事，合并为一条记录。

**(A) 测试选择器时滚动 + 呼吸高亮**

- **需求**：点「测试选择器」时，把页面滚动到目标元素可见，并让该元素**呼吸高亮**一下，
  方便用户确认自己选中的到底是哪个元素。
- **实现**（`src/lib/highlight.ts`）：
  - `scrollIntoView({ block: 'center', behavior: 'auto' })` 先滚动到居中。
    **用 instant 而不是 smooth**：平滑滚动的中间帧会让高亮框"追着跑"，反而看不清；
    instant 到位后再高亮，语义更明确。
  - 高亮框画在独立的 shadow DOM 宿主（`#ar-highlight-host`，`pointer-events: none`，
    `z-index` 极高）里，CSS 动画 `ar-breath` 做 3 次呼吸（每次 800ms，共 2400ms）。
  - 盒子位置用 `requestAnimationFrame` 逐帧跟随 `getBoundingClientRect()` —— 兼容页面上
    同时发生的布局变化，也避免"滚动后盒子留在原位置"。
  - 元素被移出文档（`width===0 && height===0`）时提前收尾。
  - 同时显示一个小标签（元素摘要，或「N 个命中（第 1 个）」）贴在元素上方。
  - **只在第一个命中元素上高亮**：选择器可能命中多个，第一个是"典型目标"。
  - 只对**命中**时高亮；`not-found` / `invalid` 不做任何页内动作。
- **实测**：目标元素初始 `top=2248`（在屏幕外）⇒ 触发测试后 `scrollY=1889`、
  `targetTop=359`、`inViewport=true`；高亮宿主存在 2400ms 后被移除（MutationObserver 计时）。

**(B) 扩展图标实时倒计时**

- **需求**（原话）："在 chrome 的扩展图标栏中…实时显示当前页面的倒计时…倒计时仅显示剩余总秒数，
  如果大于等于60秒则显示为截断的分钟数，[60<=剩余时间<120]秒时显示为'1m'，
  剩余[120<=剩余时间<180]秒时显示为'2m'，扩展图标每秒刷新一次（仅在当前页面开启自动刷新时）"。
- **实现**（`src/lib/badge.ts`）：
  - `countdownText(remainingMs)`：`>= 60s` ⇒ `{floor(sec/60)}m`；否则秒数。
    **截断而非四舍五入**（240–299s 全是 `4m`，到 300s 才跳 `5m`）。
    剩余秒用 `Math.ceil`，避免最后一秒出现"显示 0 但还没刷新"。
  - `badgeAppearance(session, now)`：无会话 ⇒ **空**（正常图标，不显示倒计时）；
    失败 ⇒ `!` 红；暂停 ⇒ `II` 黄；`start`/`wait` ⇒ 倒计时数字。
  - 拾取态 `⊕` 优先：进入拾取时 `stopBadgeWatch()`，否则 offscreen 的 tick 会把 ⊕ 覆盖成秒数。
- **架构选择（踩坑后修正）**：最初想让 **offscreen 文档自己调 `chrome.action`** 每秒写徽章
  （理由是 SW 空闲 30s 会被回收，而 offscreen 在计时期间本来活着）。
  **实测失败**：`chrome.action` 在 offscreen 里不存在（offscreen 只能用一小撮 API），
  调用直接抛异常，徽章纹丝不动（采样全是空串）。
  - 改为：offscreen 每秒发一条 `BADGE_TICK` 给 SW，由 SW 用 `chrome.action` 去写。
  - 代价：会话运行期间 SW 每秒被唤醒，不会进入 30s 空闲休眠。
    这是"图标上要有秒级倒计时"的必然成本；换成 SW 内部 `setInterval` 也不行
    （SW 会被回收，定时器中断后徽章冻结在最后一个值）。
  - 短于 1s 的间隔不启动 watch（没有秒级刷新的意义，SW 画一次静态数字即可）。
- **实测**：
  | 场景 | 采样结果 |
  | --- | --- |
  | 10s 间隔 | `10 9 8 7 7 5 4 3 2 1 (空) 9 8 7` —— 每秒递减，到点后重新起算 |
  | 120s 间隔 | `1m 1m 1m 1m 1m 1m` —— 整分钟区间稳定显示 `1m` |
  | 300s 间隔 | `4m 4m 4m 4m` —— 首轮刷新后剩 ~290s ⇒ `4m`（截断正确） |
  | 停止刷新 | 徽章清空（`''`） |
  | 页面导航 | 徽章被重设（不会停留在旧值） |

### ADR-032 · 交互只保留两档语义（稳定刷新 / 输入框占用时暂停），schema v3 → v4

- **用户原话**：
  > "`用户交互时的刷新行为` 的 `仅框内` 似乎没意义了，我只有两种需求
  > `无视输入框输入状态始终稳定的倒计时刷新` 和
  > `光标在输入框内或输入框内有任何内容时持续打断刷新直到光标不在任何输入框内且所有输入框内没有内容时才恢复自动倒计时刷新`，
  > 分别对应 `任何交互` 和 `仅框内`，只需要这两个就够了"
- **两个语义上的重大修正**（这不是"减一个档位"，而是把交互从**事件**改成**状态**）：

  | | 旧实现（ADR-027/028） | 新实现（ADR-032） |
  | --- | --- | --- |
  | 触发单位 | 一次 `click` / `keydown` **事件** | 输入框**占用状态**（持续） |
  | 效果 | 每次交互触发一次 stop/pause/restart 动作 | 占用**整段时间**都不刷新，解除后恢复 |
  | 档位 | 三档（任何 / 仅框外 / 仅框内） | **两档**（`stable` / `hold-input`） |
  | 动作 | 三选一 + 重启等待秒数 | **无**（两档里都不需要） |

  用户说"分别对应任何交互和仅框内"是对的：`stable` = 旧「任何交互」（无视输入框、倒计时稳定），
  `hold-input` = 旧「仅框内」（但语义从"框内点击触发一次"升级成"占用期间持续暂停"）。
  中间的「仅框外」被判定为无意义并删除。

- **删除的字段**（schema v4）：`interactions`（总开关，两档枚举自含"关"的语义，不需要单独开关）、
  `interactionAction`、`interactionRestartWait`、`interactionInputOnly`、`ignoreInputField`。
  新增 `interactionMode: 'stable' | 'hold-input'`（默认 `hold-input`）。
  同时删除 i18n 15 个 key（三选一动作、重启等待、三档标签/说明）。

- **"占用"的判定**（`src/lib/input-hold.ts` 的 `computeInputHold(doc)`）：
  成立条件（任一）
  1. `document.activeElement` 是 input / textarea / contenteditable（且非 disabled / readOnly）
  2. 任意文本类 input（text/search/email/url/tel/password/number）或 textarea 的 `value.trim()` 非空
  3. 任意 contenteditable 区块的 `textContent.trim()` 非空

  刻意排除：`checkbox` / `radio` / `file` / `range` 等——它们的 "value" 不是用户可清空的文本，
  算进去会让倒计时**永远**暂停。`disabled` 输入框也排除。扫描上限 5000 节点防超大表单卡顿。

- **状态监视的三条腿**（`content.ts`）：
  1. `focusin` / `focusout` —— 光标进出（覆盖 Tab、程序化 focus）
  2. `input` / `change` —— 内容变化（覆盖粘贴、脚本赋值、自动填充）
  3. **1s 兜底轮询** —— 覆盖不派发上述事件的场景（脚本直接改 `value`）
  只在状态**变化**时上报，避免每秒打 SW。`stable` 档内容脚本**不启动**监视器（省开销）。

- **SW 侧**（`onInputHold`）：
  - `held=true` ⇒ `status='pause'` + `waitReason='input-hold'` + disarm timer
  - `held=false` ⇒ 只有 `waitReason==='input-hold'` 的会话才 `confirmStarted(新一轮间隔)`
  - 恢复时**重新计一整轮**而不是补剩余：用户刚离开输入框、页面还没稳定就刷新，观感很差
  - 用户**手动暂停**会清掉 `waitReason` ⇒ 占用解除也不会把它自动恢复（区分两种暂停）

- **迁移**（`migrateV3ToV4`）：旧「仅框内」(`interactionInputOnly===true`) ⇒ `hold-input`；
  其余有 v3 交互数据的 ⇒ `stable`；**空/脏存档** ⇒ 默认值（避免"空存档"与"全新安装"行为不一致）。

- **实测**（本地页面含 2 input + 1 textarea + 1 contenteditable，间隔设 120s 避免刷新干扰）：

  | 场景 | session.status | waitReason | badge |
  | --- | --- | --- | --- |
  | 全部清空、无焦点 | `start` | null | `1m` |
  | focus 到 input A | `pause` | `input-hold` | `II` |
  | blur（内容为空） | `start` | null | `1m` |
  | input B 有内容、无焦点 | `pause` | `input-hold` | `II` |
  | 清空 B | `start` | null | `1m` |
  | `stable` 档 + 焦点 + 有内容 | `start` | null | `1m`（**不暂停**） |

  单测 `tests/input-hold.test.ts`（12 例）+ `tests/interaction-scope.test.ts`（4 例）。
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
| R19 | 生成的 selector 在页面改版后失效 | 高 | 中 | 失败时红字 + 徽章红点（ADR-016）；用户重新拾取一次即可。**不做指纹兜底**（OQ-7 已关闭，`10` §1.7） |
| R20 | schema v2 迁移丢失用户原来的自定义间隔 | 低 | 中 | 迁移显式保留 `customSeconds` → `fixedSeconds`，并有单测（`10` §3.3 / T-87） |
| R21 | **升级到 v3 后用户旧的全局面板 selector 丢失**（需重选一次） | 确定发生 | 低 | 迁移刻意丢弃（猜 URL 会点错元素，比重选危险）；面板显示"当前页面还没有选择器"作为引导。见 `11` §3.2 |
| R23 | 紧凑布局下长文本被 `truncate` 截断（如长 pageKey URL） | 中 | 低 | 关键长文本都挂了 `title` 悬浮可看全文；用户明确要求密度优先于完整展示（ADR-023） |
| R24 | 版本号靠人工递增，仍可能漏更新 | 中 | 低 | 面板头部显示 manifest 版本号作为"是否重载成功"的指示器；`09` 里程碑检查项已加一条；真要根治可加脚本校验（暂不必要，ADR-029） |
| R22 | 同一路径靠 query/hash 分流内容的站点，配置会被合并 | 中 | 低 | 用户已确认忽略 query/hash 的取舍（`11` §2.1）；若真遇到该类站点，可后续加"包含 query"开关 |

## 4. 变更记录

| 日期 | 变更 | 作者 |
| --- | --- | --- |
| 2026-11-24 | 初版：13 条 ADR、6 个开放问题、10 项风险 | lead |
| 2026-11-24 | OQ-1..OQ-6 全部关闭（OQ-5 改为「只要整数」）；新增 R11/R12；风险缓解措施标注实测结论 | lead |
| 2026-11-24 | 补 ADR-014（内容脚本按需注入）、ADR-015（完整点击序列）、ADR-016（失败不计次数）、ADR-017（i18n key 字符集） | lead |
| 2026-11-24 | **设计稿轮次**（未实施）：新增 ADR-018（拾取器自建覆盖层，不申请 `debugger`）、ADR-019（选择器 5 层降级，语义属性优先）、ADR-020（双击同步派发）、ADR-021（间隔单一数据源 / schema v2）；新增 R13–R20；OQ-7 结论为「不做指纹兜底」。详细设计见 `10` | lead |
| 2026-11-24 | ADR-022（selector 按页面隔离 / schema v3）+ R21/R22 | lead |
| 2026-11-25 | **ADR-023**（面板紧凑布局，不再对齐 ARP 的松散视觉）+ R23 | lead |
| 2026-11-25 | **ADR-024**（固定档 chip 与数字同行、预设 5→6 秒） | lead |
| 2026-11-25 | **ADR-025**（面板宽度写死 400px，超长文本截断 + 原生 title） | lead |
| 2026-11-25 | **ADR-026**（固定档「重新开始前等待」直接用当前间隔） | lead |
| 2026-11-25 | **ADR-027**（交互触发范围三档 + 视觉分组 + 头部按钮语义重排） | lead |
| 2026-11-25 | **ADR-028**（触发范围改三段 SegmentedControl；修 flex 子项被压缩的裁切 bug） | lead |
| 2026-11-25 | **ADR-029**（版本号单一真源 + 面板显示版本号；v0.1.0 → v0.2.0） | lead |
| 2026-11-25 | **ADR-030**（拾取器 sweep 阶段：选中手势不穿透页面；v0.2.0 → v0.2.1） | lead |
| 2026-11-25 | **ADR-031**（测试选择器滚动+呼吸高亮；图标实时倒计时；v0.2.1 → v0.3.0） | lead |
| 2026-11-25 | **ADR-032**（交互只留两档：稳定刷新 / 输入框占用时暂停；schema v3→v4；v0.3.0 → v0.4.0） | lead |
