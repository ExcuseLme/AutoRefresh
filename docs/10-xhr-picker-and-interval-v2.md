# 10 · XHR 拾取器 + 间隔交互改版（设计方案）

> 状态：**设计稿，未实施**。实施时按本文改代码，并同步回 `03`/`04`/`05`/`06`/`07`/`09`。
> 本文编号自成一个 ADR 批次（ADR-018…ADR-021），决策摘要登记在 `08` §1。
>
> 需求来源：2026-11-24 用户提出两组需求（元素拾取 + 单击/双击；间隔交互简化）。

---

## 0. 先回答：上一轮把「点击」改成了什么

上一轮（提交 `11fc6b0`）把 XHR 模式的"点一下"从**单一合成 click** 改成**完整 pointer/mouse 序列**。

### 0.1 改动前

```ts
// content.ts（旧）
(el as HTMLElement).click();
```

`el.click()` 只派发一个 `MouseEvent('click')`，`isTrusted` 为 `false`，且**没有** `pointerdown` /
`mousedown` 前置事件。

### 0.2 改动后

```ts
// src/lib/dom-click.ts
export const CLICK_SEQUENCE = [
  'pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove',
  'pointerdown',  'mousedown',      'pointerup',   'mouseup',      'click',
] as const;
```

`simulateClick(el)` 按上表逐个 `dispatchEvent`：

- 全部带 `bubbles: true, cancelable: true, view: window`（框架常把监听挂在容器上、
  也可能读 `view` 判断来源）
- `pointerdown` / `mousedown` 带 `buttons: 1`，`pointerup` / `mouseup` 带 `buttons: 0`
  （写错会被部分框架判为无效手势）
- 先 `scrollIntoView({ block: 'center' })`，不可见元素可能不响应
- 环境没有 `PointerEvent` 构造函数时静默跳过 pointer 系列，mouse 系列照发

### 0.3 为什么必须这么改（实测依据）

2026-11-24 在真实浏览器里对两个站点做对照，每轮先 `performance.clearResourceTimings()`，
再用 `XMLHttpRequest.prototype.send` / `window.fetch` 计数器交叉验证：

| 点击方式 | Gmail 收件箱「刷新」 | 网易邮箱「刷新」 |
| --- | --- | --- |
| `el.click()` | **0 次** `/sync/u/0/i/s` | **0 次** `mbox:listMessages` |
| 完整序列（改动后） | 每轮 **1 次** | 每轮 **1 次** |

结论：这类 SPA（Gmail NUI、网易 js6、大量 React/Vue 后台）把交互逻辑挂在
`pointerdown` / `mousedown` 上，`click` 只是结果。合成 `click` 进不去它们的判定。

### 0.4 能力上限（必须如实说明）

合成事件的 `isTrusted` **恒为 `false`，无法伪造**。对绝大多数页面够用；
把 `isTrusted` 当硬性门槛的极少数页面（需要真实用户手势才能触发的 API）绕不过去。
这是浏览器安全模型的边界，不是扩展缺陷。失败时面板会红字显示「本轮未刷新」
（`05` §7.3 / ADR-016），不会再假装成功。

---

## 1. 需求一（A）：面板内「选择元素」拾取器

### 1.1 目标

XHR 模式下，选择器输入框右侧增加 `选择元素` 按钮。点击后进入"元素选择模式"
（类似 DevTools `Ctrl+Shift+C`），在页面上点选目标元素，自动生成并回填
唯一、稳定、尽量简短的选择器。

### 1.2 为什么不用浏览器原生方案（关键技术结论）

用户的直觉是对的：确实"有原生方案"，但都要付出不可接受的代价。三种候选都评估过：

| 方案 | 可行性 | 否决理由 |
| --- | --- | --- |
| `chrome.devtools.inspectedWindow.eval` | ❌ | 只在 **devtools 页面**可用（要求用户先按 F12 打开 DevTools）。面板（popup）根本调不到这个 API |
| `chrome.debugger` + CDP `Overlay.setInspectMode({ mode: 'searchForNode' })` | ⚠️ 技术上可以 | 这是 DevTools 原生高亮 UI 的底层 API。但：① 要申请 `debugger` 权限（安装横幅多一条"调试其他应用"的重警告）；② 每次使用都会在浏览器顶部常驻一条「AutoRefresh 正在调试此浏览器」提示条；③ 与用户已打开的 DevTools **互斥**（调试器同一 tab 只能有一个 attach）；④ 页面跳转后会话易断。<br>对一个"只保留一个轻量面板"的自用扩展，代价远大于收益 |
| **内容脚本自建覆盖层**（采用） | ✅ | 无额外权限、无横幅、不影响 DevTools；纯 DOM 实现，样式用 Shadow DOM 隔离；**所有主流"选择器拾取"扩展都是这个做法** |

> 结论：**ADR-018 — 自建覆盖层拾取器**。不引入 `debugger` 权限。

### 1.3 架构与消息流

新增 4 条消息（`src/lib/messages.ts`）：

```ts
// popup → SW
| { type: 'PICKER_START'; tabId: number }
// SW → content（tabs.sendMessage）
| { type: 'PICKER_START' }
| { type: 'PICKER_STOP' }
// content → SW（runtime.sendMessage）
| { type: 'PICKER_RESULT'; selector: string; cancelled?: false }
| { type: 'PICKER_CANCELLED' }
```

时序：

```
popup            SW                     content(ISOLATED)          页面
  │ 选择元素 ────►│                            │                    │
  │              │── scripting.executeScript? 不需要（已注入）──►    │
  │              │── PICKER_START ────────────►│                    │
  │  (popup 被点页面动作关闭)                  │── 挂 overlay ─────►│
  │                                        │── mousemove 监听 ──►│
  │                                        │◄── elementFromPoint │
  │                                        │  实时生成 selector  │
  │                                        │◄── 用户点击 ────────│
  │                                        │── PICKER_RESULT ──►│
  │              │◄── PICKER_RESULT ──────────│                    │
  │              │  applyPatch({autoClickSelector}) → 持久化        │
  │              │  chrome.action.openPopup()（尽力而为）            │
  │◄── 重新弹出的面板显示已选中的 selector ────│                    │
```

### 1.4 「popup 会被关闭」这个坑怎么处理

点击页面元素**必然会关闭 popup**（点面板外部即关闭，这是浏览器行为，无法阻止）。
所以拾取结果不能只靠 popup 回填。三层兜底：

1. **页内即时反馈**（主路径）：拾取器自己的悬浮卡片实时显示当前 hover 的 selector，
   确认后原地显示「已保存到自动点击元素选择器」+ 生成的 selector 文本。
   用户即使 popup 关了也知道结果。
2. **`chrome.action.openPopup()` 自动重新打开面板**（Chrome 127+ 对所有扩展开放，
   当前浏览器 Chrome 158，实测 `chrome.action.openPopup` 存在且 `length === 0`）。
   必须在 SW 收到 `PICKER_RESULT` 后调用（在用户手势的调用链内，成功率高）。
   调用失败（被策略拦/无手势上下文）时静默跳过，靠第 1、3 层。
3. **徽章闪烁**：`✓` 显示 2 秒后恢复原状态（`●`/`II`/空）。用户在别的标签页也能看到。

另外：`PICKER_RESULT` **必须**经 SW 的 `applyPatch` 落库（不能由 content 直接写
`chrome.storage`），保证校验逻辑集中在一处（`03` §6 的读写纪律）。

### 1.5 覆盖层实现细节

```
<div id="ar-picker-host">            ← appendChild 到 document.documentElement
  #shadow-root (mode: 'closed')      ← 样式完全隔离，页面 CSS 影响不到
    <div class="outline">            ← 目标元素的高亮框（position: fixed）
    <div class="tip">                ← 跟随鼠标的卡片：标签名 + 实时 selector + 操作提示
```

- host 样式：`position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;`
  （**`pointer-events: none` 是关键**：否则 `elementFromPoint` 会命中我们自己，拾取器自我劫持）
- 高亮框位置：`target.getBoundingClientRect()` → `left/top/width/height`；
  盒子模型可加 `padding/border` 区分（对齐 DevTools 的四色框属于锦上添花，可选）
- 事件监听全部挂 **`window` + capture 阶段** + `{ passive: false }`：
  | 事件 | 处理 |
  | --- | --- |
  | `mousemove` / `pointermove` | `elementFromPoint(clientX, clientY)` 命中目标；用 `requestAnimationFrame` 节流 |
  | `mousedown` / `pointerdown` | `preventDefault()` + `stopImmediatePropagation()`，**避免触发页面自身动作**（否则点选会变成真的点击） |
  | `click` | 同上 + 确认选中 |
  | `dblclick` | 同上（避免误触发页面双击逻辑） |
  | `keydown` | `Esc` 取消；其余按键放行 |
  | `contextmenu` | `preventDefault()` + 取消（与 DevTools 一致） |
  | `pagehide` / `visibilitychange` | 清理（页面被导航走/切走时不残留） |
- 目标过滤：跳过 `html`、`body`；跳过我们自己的宿主（`#ar-picker-host` 及其子树）；
  跳过 `display:none` / `0×0` 元素（无法高亮，选它没意义）
- 清理函数必须幂等：移除 host、移除所有监听、清 rAF。SW 侧 `PICKER_STOP`
  和 `tabs.onUpdated`/`onRemoved` 都要能触发清理（防止用户中途在别的标签页乱点）
- **iframe**：内容脚本当前 `allFrames: false`，所以只能选主文档里的元素。
  跨 iframe 拾取需要 `allFrames: true` + 按 frameId 聚合结果，**本期不做**（记为 R13）

### 1.6 选择器生成算法（核心）

用户指定的优先级是「结构 > id > class > 普通」，并确认**语义属性（aria-label 等）
排在结构之前**（实测 Gmail 的「刷新」按钮只有图标没文字，`[aria-label="刷新"]`
比任何结构路径都稳）。

最终 5 个层级，**每一层都必须产出"唯一命中该元素"的 selector，否则降到下一层**：

| 层 | 内容 | 例 |
| --- | --- | --- |
| **T0 语义属性** | `aria-label` / `data-tooltip` / `title` / `name` / `alt` / `placeholder` | `[aria-label="刷新"]` |
| **T1 结构路径** | 纯 tag + `:nth-of-type()` 链，可从 body 起，也可锚定在**稳定 id 祖先** | `body > div:nth-of-type(2) > header > div:nth-of-type(5) > div` |
| **T2 id** | 裸 id，且 id 通过稳定性启发式 | `#dvContainer` |
| **T3 class** | 稳定 class，最多 2 个组合 | `.js-component-button.nui-btn`（命中多个则降级） |
| **T4 兜底** | tag + 稳定 class + 属性 + `:nth-of-type` 的组合；允许较长 | `div[role="button"].T-I-ax7:nth-of-type(2)` |

#### 1.6.1 唯一性判定（所有层级共用）

```ts
function isUniqueFor(sel: string, el: Element): boolean {
  try {
    const nodes = document.querySelectorAll(sel);
    return nodes.length === 1 && nodes[0] === el;
  } catch {
    return false; // 语法非法
  }
}
```

#### 1.6.2 稳定性启发式（id / class 共用）

**不可用**的 id / class（出现即跳过，不参与生成）：

| 规则 | 例 |
| --- | --- |
| 含 3 位以上连续数字 | `_mail_button_228_1148`、`_mail_toolbar_7_997`、`1795508820124_Header` |
| 哈希后缀 | `Card__abc123`、`Button-root-1a2b3c`、`css-1a2b3c`、`sc-bdVaJa` |
| 框架/构建产物前缀 | `css-`, `sc-`, `emotion-`, `bx-`, `v-`, `data-v-` |
| tailwind-ish 转义类名 | `text-\[13px\]`, `w-\[120px\]` |
| 状态后缀 | `active`/`current`/`selected`/`hover`/`focus`/`focused`/`loading`/`disabled`/`hidden`/`visible`/`open`/`expanded`/`checked`（整词匹配 `^(x|.*-x)$`） |
| 过长 | 长度 > 40 |
| 含 `:` `.` `#` 空格 等需转义字符 | （直接排除，避免转义漏点） |

**可用**的例：`dvContainer`、`frame-main-cont-head`、`js-component-button`、`nui-btn`、`T-I-ax7`。

> 启发式只是"降低踩坑概率"，不是保证。所以**最终仍以 `isUniqueFor` 实测为准**；
> 且把命中的 selector 在拾取卡片里展示给用户看一眼（透明胜过假装聪明）。

#### 1.6.3 T1 结构路径的构造与最小化

```ts
// 1) 从目标向上爬到 body，每层生成一个片段
function segment(el) {
  if (hasStableId(el)) return `#${el.id}`;          // 稳定 id 当作锚点，停止继续上爬
  const cls = firstStableClass(el);
  const base = cls ? `${tag}.${cls}` : tag;
  const k = nthOfTypeIndex(el);                      // 同 tag 兄弟中的序号（1-based）
  return k > 1 || needIndex ? `${base}:nth-of-type(${k})` : base;
}
// 2) 拼成绝对路径 body > … > target
// 3) 最小化：从最外层开始逐段删，删完仍 unique 就保留删除
```

- `nth-of-type` 而不是 `nth-child`：不同 tag 混排时前者更稳（不会因为插入一个 `<span>` 而错位）
- 若某层有稳定 class，就用 `tag.class` 代替 `:nth-of-type()` —— 更短且更能扛兄弟节点增删
- **最小化**很重要：`body > div:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(2) > div`
  这种 4 层路径，删到 2 层往往还唯一，必须删

#### 1.6.4 边界情况

| 情况 | 处理 |
| --- | --- |
| 所有层级都产不出唯一 selector | 用 T1 的**完整**绝对路径（按构造必然唯一），并在卡片上标注「⚠ 选择器较长，页面结构变化后可能失效」 |
| 目标在 Shadow DOM 内 | `document.querySelector` 穿不透 shadow 边界。检测到 `el.getRootNode()` 不是 document 时，卡片提示「该元素在 Shadow DOM 内，暂不支持」，并允许用户仍取外部可见祖先 |
| 目标是富文本/伪元素（`::before`） | 不支持（CSS 无法选中伪元素），回落到其宿主元素 |
| 选择器在多个 iframe 中同名不同义 | 明确提示"只支持当前页面（主文档）" |

### 1.7 不做「指纹兜底」（OQ-7 已关闭）

曾考虑过给选择器配一份指纹（`{ text, tag, cls[], attrs }`），selector 失效时用它重新定位。
**已否决**（用户结论："这属于该页面自身的特殊行为，本扩展只管正常地生成 selector 和使用 selector"）。

理由：

- 网易邮箱的「刷新」按钮无 `aria-label`/`title`、id 动态、class 命中 12 个，
  唯一区分点是文本 `刷 新` —— 这是**该页面自身的特殊行为**，
  为该个例在扩展里维护一套指纹匹配引擎，属于把页面缺陷当框架需求。
- 指纹匹配必然引入启发式（文本前缀、class 集合容差、序号挑选），
  这些"猜"的逻辑一旦失手会点到**错误的元素**——比"本轮未刷新"危险得多。
- 扩展的职责边界清晰：**生成一个合法、唯一、尽量稳定的 CSS selector，然后严格使用它**。
  selector 因页面改版而失效时，如实报失败（红字 + 徽章，`05` §7.3 / ADR-016），
  用户重新拾取一次即可。

因此 `autoClickHint` 字段**不加入 schema**，点击链路保持"一条 selector 直达"的简单形态。

> 唯一残留的复杂度：拾取器仍需在 T0–T4 五层里挑出**能唯一命中**的那个 selector。
> 若五层都产不出唯一结果（极端情况），回落到 T1 的完整绝对路径并标注「较长」。

### 1.8 UI 规格（XHR 区改版后）

```
┌──────────────────────────────────────────────────┐
│ 刷新类型                                          │
│ ┌──────────────┬──────────────┐                  │
│ │ 完整页面刷新   │  XHR 刷新  ✓  │                  │
│ └──────────────┴──────────────┘                  │
│ 不重新加载页面，点击指定元素以触发页面自身的请求      │
│ ─────────────────────────────────────────────── │
│ 自动点击元素选择器            [ 选择元素 ] [ 测试 ] │
│ ┌──────────────────────────────────────────────┐ │
│ │ [aria-label="刷新"]                          │ │
│ └──────────────────────────────────────────────┘ │
│ 命中 1 个元素：<div> “刷新”                        │
│                                                  │
│ 触发方式    ┌──────────┬──────────┐              │
│             │  单击  ✓  │  双击    │              │
│             └──────────┴──────────┘              │
└──────────────────────────────────────────────────┘
```

- `选择元素` 与已有 `测试选择器` 并排（前者改变值，后者只读回显）
- 拾取中：按钮文案变 `选择中…（Esc 取消）`，并且**面板可以被关闭**（见 §1.4）
- `触发方式` 只在 `refreshType === 'xhr'` 时出现（整页刷新没有"点哪儿"的问题）

---

## 2. 需求一（B）：单击 / 双击

### 2.1 数据模型

```ts
export type ClickAction = 'single' | 'double';
autoClickAction: ClickAction;   // 默认 'single'
```

### 2.2 事件序列

**单击**：即 §0.2 的 10 事件序列，`click` 的 `detail: 1`。

**双击**：浏览器真实的双击序列是（不含 over/enter/move 的重复）：

```
# 第一按
pointerdown(buttons:1) → mousedown(buttons:1) → pointerup(buttons:0) → mouseup → click(detail:1)
# 第二按
pointerdown(buttons:1) → mousedown(buttons:1) → pointerup(buttons:0) → mouseup → click(detail:2)
# 收尾
dblclick(detail:2)
```

所以 `simulateClick(el, { action: 'double' })`：

1. 派发 `pointerover → pointerenter → mouseover → mouseenter → mousemove`（仅一次）
2. 派发第一按全序列（`click.detail = 1`）
3. 派发第二按全序列（`click.detail = 2`）
4. 追加 `dblclick`（`detail = 2`）
5. **不重复** over/enter/move（浏览器也不会在第二按时重发）

### 2.3 两次按键之间要不要延时？

**不加延时，同步派发。** 理由：

- 真实浏览器的双击判定窗口是 ~400ms；同步派发等价于"0ms 间隔双击"，任何
  基于"两次点击时间差 < 阈值"的判定都会通过
- 加 `setTimeout` 会引入异步：页面可能在两次 click 之间重渲染，第二次打到已脱离文档的元素，
  反而更容易失败
- 需要"两次单击各自生效"的页面（用 `click` 计数、不看 `detail`）也得到了两次 click，
  行为与"快速双击"一致

能力上限同 §0.4：`isTrusted` 恒 false。

### 2.4 风险

| # | 风险 |
| --- | --- |
| R17 | 页面把双击做了**去抖**（如 300ms 内两次 click 只算一次）→ 那就是页面自身逻辑，本扩展无法绕，行为与真人双击一致即可 |
| R18 | 页面要求 `event.detail` 递增才认双击 → 已按 1→2→`dblclick` 派发，覆盖该判定 |

---

## 3. 需求二：间隔交互改版

### 3.1 目标（逐条对应用户诉求）

| # | 诉求 | 落地 |
| --- | --- | --- |
| 2.1 | 移除「自定义」tab，融入「固定」 | `intervalMode` 从 3 段变 **2 段**（固定 / 随机），`'custom'` 枚举值删除 |
| 2.2 | 固定 tab 里出现两个数字输入框是多余的 | 只保留**一个** `NumberStepper`，删掉 chip 触发展开的第二个输入框 |
| 2.3 | −/+ 在预设间跳转是错的 | −/+ = 对**同一个数字**做 `∓1`；预设 chip = 把数字**上屏**；手动输入 = 直接改数字。三者写同一个字段 |

### 3.2 数据模型（schemaVersion 1 → 2）

```ts
export type IntervalMode = 'fixed' | 'random';   // 'custom' 删除

export type Options = {
  schemaVersion: 2;
  intervalMode: IntervalMode;
  fixedSeconds: number;        // 1..86400 整数；固定档的**唯一数据源**
  randomMinSeconds: number;
  randomMaxSeconds: number;
  avoidRepeatRandom: boolean;
  // …其余字段不变
};
```

**删除**：`customSeconds`、`fixedPreset`（以及 `FixedPreset` 类型、`FIXED_PRESETS` 的
"选中态"语义 —— `FIXED_PRESETS` 数组本身保留，仅作为 UI 的快捷数字）。

> 为什么 `fixedPreset` 可以删：它存在的唯一理由是"消解"值相等但意图不同"的歧义
> （`03` §1 原设计）。现在用户要求**只有一个数据来源**，也就是**主动放弃**这种歧义区分：
> 值就是意图。当前值恰好等于某个预设时，对应 chip 自然高亮；否则全部不高亮。
> 这是需求带来的简化，不是妥协。

### 3.3 迁移（v1 → v2）

```ts
function migrateV1ToV2(raw: Raw): Raw {
  const mode = raw.intervalMode;
  const next = { ...raw };
  if (mode === 'custom') {
    next.intervalMode = 'fixed';
    // 保住用户的自定义值，不静默丢成 10 秒
    const custom = clampInt(raw.customSeconds, 1, 86400);
    if (custom !== null) next.fixedSeconds = custom;
  }
  delete next.customSeconds;
  delete next.fixedPreset;
  next.schemaVersion = 2;
  return next;
}
```

- `migrate()` 入口增加 `if (raw.schemaVersion !== 2) raw = migrateV1ToV2(raw)`
- `fixedSeconds` 仍是 1..86400 的整数校验；非法→拒绝或回默认（沿用 ADR-007）
- 单测：`intervalMode='custom'` + `customSeconds=7` → `fixed` + `fixedSeconds=7`；
  `fixed` + `fixedSeconds=60` → 不变；脏数据 → 默认 10

### 3.4 UI 规格

```
┌─────────── 间隔 ────────────┐
│ ┌─────────────┬───────────┐ │
│ │   固定  ✓   │    随机    │ │   ← 2 段（不再有"自定义"）
│ └─────────────┴───────────┘ │
│ ┌─────────────────────────┐ │
│ │ 间隔              秒     │ │
│ │  −      [  10  ]     +  │ │   ← 唯一数据源（可点数字直接输入）
│ ├─────────────────────────┤ │
│ │ [3秒] [5秒] [10秒] [60秒] │ │   ← 点击 = 把该数字上屏
│ └─────────────────────────┘ │
│ 每 10 秒刷新                 │   ← 摘要行（可选保留）
└─────────────────────────────┘
```

交互细则：

| 操作 | 行为 | 落库 |
| --- | --- | --- |
| 点 chip `3秒` | `fixedSeconds = 3` | 立即 `OPTIONS_PATCH({ fixedSeconds: 3 })` |
| 点 `−` | `fixedSeconds = max(1, v-1)` | 立即 |
| 点 `+` | `fixedSeconds = min(86400, v+1)` | 立即 |
| 点数字框并输入 | 失焦/回车提交；非整数或越界 → 回滚显示，不落库（沿用 `parseStrictInt`） | 立即 |
| chip 高亮 | 仅当 `fixedSeconds === preset` | — |
| 切换「固定/随机」 | 只改 `intervalMode`，不重置 `fixedSeconds` | 立即 |

**删掉的东西**：

- `自定义` 分段；`自定义` chip；chip 展开的第二个输入框；`customOpen` 本地状态
  （它是"一个操作要在 tab 间跳转"的根源）
- `nextPresetUp / nextPresetDown`（−/+ 不再遍历预设）

### 3.5 运行中改间隔的影响

保持现有语义（`05` §3.1）：改 `fixedSeconds` **只影响下一轮**的等待时间；
当前正等待的那一轮不重排（避免"改一下数字就立刻刷新"的意外）。这是刻意的，
不需要改。

### 3.6 i18n 变化（`06`）

| 动作 | key |
| --- | --- |
| 删除 | `interval_custom`(分段标签)、`interval_custom_chip`、`interval_custom_value`、`interval_custom_summary` |
| 保留 | `interval_fixed`、`interval_random`、`interval_preset_seconds`、`interval_seconds_label` |
| 新增 | `interval_every_seconds`（`每 $1 秒刷新`） |
| 新增（拾取器/点击） | `click_action`（`触发方式`）、`click_single`（`单击`）、`click_double`（`双击`）、`pick_element`（`选择元素`）、`pick_element_active`（`选择中…（Esc 取消）`）、`pick_hint_title`（`点击页面上的目标元素`）、`pick_hint_cancel`（`Esc 取消`）、`pick_saved`（`已保存到自动点击元素选择器`）、`pick_not_unique`（`选择器较长，页面结构变化后可能失效`）、`pick_shadow_dom`（`该元素在 Shadow DOM 内，暂不支持`） |

> key 命名规则不变：只允许 `[a-zA-Z0-9_]`（ADR-017）。

---

## 4. 影响面清单（实施时逐项核对）

| 文件 | 改动 |
| --- | --- |
| `src/lib/options.ts` | `IntervalMode` 去 custom；删 `customSeconds`/`fixedPreset`/`FixedPreset`；加 `autoClickAction`；`schemaVersion: 2` |
| `src/lib/validate.ts` | 删两字段校验；加 `autoClickAction` 枚举；`migrateV1ToV2` |
| `src/lib/interval.ts` | `nextDelayMs` 去掉 `custom` 分支与 `customSeconds` |
| `src/lib/session.ts` | 无改动（`lastError` 已就位） |
| `src/lib/messages.ts` | 加 `PICKER_*` 消息、`ClickAction` 类型 |
| `src/lib/dom-click.ts` | `simulateClick(el, { action })` 支持 double |
| `src/lib/selector.ts`（**新增**） | 5 层生成算法 + 稳定性启发式 + `isUniqueFor` |
| `src/lib/refresh.ts` | 传 `action` 给 content |
| `src/entrypoints/content.ts` | 加 picker 的 mount/cleanup；`AUTOCLICK` 带 action |
| `src/entrypoints/background.ts` | 路由 `PICKER_START` / `PICKER_RESULT` / `PICKER_CANCELLED`；`openPopup` 兜底；徽章闪烁 |
| `src/components/IntervalSection.tsx` | 重写为 2 段 + 单输入 + 4 chip |
| `src/components/RefreshTypeSection.tsx` | 加「选择元素」按钮 + 单击/双击分段 |
| `src/components/ui/index.tsx` | `NumberStepper` 支持 `onStep` 回调（区分"点 −/+ "与"手动输入"可选） |
| `public/_locales/zh_CN/messages.json` | 按 §3.6 |
| `tests/` | 新增 `selector.test.ts`（生成算法）、`migrate-v2.test.ts`（迁移）、`dom-click` 扩双击用例；改 `interval`/`validate` 相关断言 |
| `docs/03/04/05/06/07/09` | 同步 schema、UI 规格、拾取器章节、文案表、追踪矩阵、验收用例 |
| `scripts/check-scope.mjs` | 无需改（不含被丢弃功能的特征串） |

---

## 5. 验收用例（新增，编号接 `09` §4）

### 5.1 元素拾取器

| ID | 用例 | 预期 |
| --- | --- | --- |
| T-60 | XHR 模式点「选择元素」，鼠标在页面上移动 | 目标元素被高亮框圈住，悬浮卡片实时显示 selector |
| T-61 | 点选 Gmail「刷新」按钮 | 得到 `[aria-label="刷新"]`（T0 语义属性命中） |
| T-62 | 点选一个语义属性命中多个的元素 | 自动降级到结构路径，且仍是唯一命中 |
| T-63 | 点选网易邮箱「刷新」按钮 | 得到结构路径（该按钮无 aria-label/稳定 id，需人工确认可用） |
| T-64 | 拾取中按 `Esc` | 取消，不改动现有选择器，无残留覆盖层 |
| T-65 | 拾取中在页面上双击 / 右键 | 不触发页面自身动作，拾取器仍工作 |
| T-66 | 拾取完成后重新打开面板 | 输入框里已有新选择器（已落库） |
| T-67 | 拾取时面板被关闭 | 页内卡片显示「已保存」；`chrome.action.openPopup` 成功时面板自动回来 |
| T-68 | 拾取中途页面导航走 | 覆盖层与监听被清理，无内存泄漏、无报错 |
| T-69 | 生成的选择器在同一页面重复拾取同一元素 | 结果稳定（幂等，不因 hover 顺序变化） |

### 5.2 单击/双击

| ID | 用例 | 预期 |
| --- | --- | --- |
| T-70 | `单击` + Gmail 刷新 | 每轮 1 次 `/sync` 请求（回归 §0.3） |
| T-71 | `双击` + Gmail 刷新 | 产生 2 次 click 事件 + 1 次 dblclick；页面按双击语义响应 |
| T-72 | `双击` 时用页面探针统计事件 | `click` 的 `detail` 依次为 1、2；`dblclick.detail === 2` |
| T-73 | 切到「完整页面刷新」 | 单击/双击分段**不显示**（整页刷新无此语义） |

### 5.3 间隔改版

| ID | 用例 | 预期 |
| --- | --- | --- |
| T-80 | 面板只有「固定 / 随机」两段 | 不存在「自定义」 |
| T-81 | 固定档点 `60秒` chip | 数字框变 60，chip 高亮，落库 |
| T-82 | 固定档点 `+` 三次 | 数字 +3（10→13），落库，且**没有** chip 高亮（13 不在预设集） |
| T-83 | 固定档点 `−` 到 1 再点一次 | 停在 1（下限），落库 |
| T-84 | 固定档手动输入 `7` 回车 | 变 7，落库，无 chip 高亮 |
| T-85 | 固定档输入 `2.5` | 拒绝，回滚原值（T-47 回归） |
| T-86 | 固定档**只有一个**数字输入框 | 不存在第二个输入框、不需要切 tab |
| T-87 | v1 存档 `intervalMode='custom'` + `customSeconds=7` | 迁移后 `fixed` + `fixedSeconds=7` |
| T-88 | v1 存档 `fixedSeconds=60` | 迁移后不变 |
| T-89 | 面板窄屏（480px）× 高 600px | 单屏可滚，无横向溢出 |

---

## 6. 新增风险（登记进 `08` §3）

| # | 风险 | 可能性 | 影响 | 缓解 |
| --- | --- | --- | --- | --- |
| R13 | 拾取器无法选 iframe 内元素（`allFrames:false`） | 高 | 中 | 明确提示"只支持当前页面主文档"；后续可改 `allFrames:true` + 聚合 |
| R14 | 拾取时 popup 必被关闭，用户误以为失败 | 高 | 中 | 页内卡片给结果 + `openPopup` 自动回开 + 徽章闪烁 |
| R15 | 页面有极高 z-index 元素压住拾取器 | 低 | 低 | 用 `z-index: 2147483647`（CSS 上限） |
| R16 | 页面 `stopImmediatePropagation` 挡住我们的 capture 监听 | 低 | 中 | 挂在 `window` 的 capture 阶段（早于目标元素监听） |
| R19 | 生成的 selector 在页面改版后失效 | 高 | 中 | 失败时红字 + 徽章红点（ADR-016）；OQ-7 的指纹兜底可进一步缓解 |
| R20 | schema 迁移丢失用户的自定义间隔 | 低 | 中 | 迁移规则显式保留 `customSeconds` → `fixedSeconds`，并有单测 |

---

## 7. 原型验证结论（本轮已在真实浏览器跑过）

设计里的三个关键假设都**先验证再落笔**，不是纸面推演：

### 7.1 覆盖层 `pointer-events:none` 能让 `elementFromPoint` 穿透

在真实站点（`http://10.25.150.155:8080/ms/index`）实测：

```
overlayAttached: true
elementFromPointPassesThrough: true      ← 命中的是页面真实元素，不是我们的 host
hitIsOurHost: false
cleanedUp: true                          ← 移除 host 后无残留
```

结论：§1.5 的做法成立，拾取器不会自我劫持。顺带发现该页面中心点是一个
`<iframe>` —— 恰好印证 R13（跨 iframe 拾取本期不做，需明确提示）。

### 7.2 选择器生成算法的实际输出

用 §1.6 的算法在同站点跑原型（`selector-proto.js`），6 个样本全部
`roundTrip === true`（生成的 selector 反查命中且仅命中该元素）：

| 样本 | 层级 | 生成的 selector |
| --- | --- | --- |
| logo 图片 | **T0** | `[alt="咪咕音乐"]` |
| 表格里的「增加」按钮 | T1 | `div.ivu-tabs-nav-right:nth-of-type(1) > button.ivu-btn:nth-of-type(1)` |
| 下拉里的 `<a>` | T1 | `div.ivu-dropdown-rel:nth-of-type(1) > a` |
| 页面标题 `<h1>` | T1 | `div.ivu-tabs-tabpane:nth-of-type(1) > div.srcollStyle:nth-of-type(1) > div > div.home-content:nth-of-type(1) > div.home-content-border:nth-of-type(1) > h1` |
| 第 41 个 `<div>` | T1 | `div.layout-indexs-child:nth-of-type(4)` |

两个实现细节由这轮原型确认：

1. **T1 的每一段优先用"稳定 class + tag"，其次才是 `:nth-of-type`**。
   这是让路径变短的关键（`div.layout-indexs-child:nth-of-type(4)` 就是删到只剩一段的结果）。
   严格"纯结构"会得到更长的纯 `:nth-of-type` 链，反而更脆。
2. **最小化是"贪心逐段删"**（删掉某段后仍唯一就保留删除，从头再来），
   已验证能把 `body > …` 前缀整段删掉。但像上面 `<h1>` 那种 6 段路径是**真正的最小值**
   —— 少任何一段都会匹配到多个元素。这类结果必须在卡片上标注「较长，可能随改版失效」。

### 7.3 双击的事件序列

在同页面上手动派发 §2.2 的序列，页面监听捕获到：

```
pointerdown, mousedown, pointerup, mouseup, click@1,
pointerdown, mousedown, pointerup, mouseup, click@2,
dblclick@2
```

即 `click` 的 `detail` 依次为 1、2，末尾 `dblclick.detail === 2` —— 与 ADR-020 的
设计一致，覆盖"靠 `detail` 递增判双击"的页面。同步派发（无 `setTimeout`）已验证可行。

### 7.4 `chrome.action.openPopup` 的可用性

当前浏览器 Chrome **158**，扩展页里实测 `chrome.action.openPopup` 存在且 `length === 0`
（即新版签名 `openPopup(options?)`）。官方文档确认自 [Chrome 127 起对所有扩展开放](https://developer.chrome.com/blog/extension-news-july-2024)。
所以 §1.4 的第 2 层兜底可用（仍需 try/catch，失败时靠页内卡片 + 徽章）。

### 7.5 为什么坚持不用 `chrome.debugger`

除 §1.2 的四条代价外，再补一条实测相关的事实：CDP 的 `Overlay.setInspectMode
{mode:'searchForNode'}` 确实是 DevTools 元素选择模式的底层实现
（VS Code 的 element picker 就是直接发这条命令，见 [vscode@0e2919b](https://github.com/microsoft/vscode/commit/0e2919b574bdebb5ebf056e858c74403ebab37c3)），
且需要先 `Overlay.enable`。但 attach 期间浏览器顶部横条与 DevTools 互斥这两点，
对自用轻量扩展仍是不可接受的代价 —— 这正是 ADR-018 的结论。

## 8. 实施顺序建议（下一轮）

1. **间隔改版**（改动小、无新概念）：schema v2 + 迁移 + 单输入 UI + i18n
2. **单击/双击**（`dom-click` 里加分支 + 面板分段）
3. **拾取器**（最复杂：selector 生成器 → 覆盖层 → 消息路由 → openPopup 兜底）
4. 文档回写 + 验收实测（Gmail / 网易邮箱两个真实站点）
