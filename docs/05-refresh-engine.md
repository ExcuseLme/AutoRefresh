# 05 · 刷新引擎

本章是本项目的技术核心。ARP 的引擎大量依赖"SW 里长 `setTimeout` + 内容脚本每秒心跳保活"，
在 MV3 的 SW 30s 空闲回收规则下并不稳（ARP 是靠 `content-scripts/script.js` 每秒
`refreshKeepAlive` 消息把 SW 一直拉活，见 `background.js` 的 `q('refreshKeepAlive', ...)`）。
本扩展改用 **offscreen 文档托管计时器**（ADR-004），SW 只在到期时被唤醒执行。

## 1. 定时器宿主（offscreen）

### 1.1 结构

`entrypoints/offscreen/index.html` 载入一个 `main.ts`，它维护：

```ts
type Armed = { tabId: number; token: string; dueAt: number; timer: number };
const timers = new Map<number, Armed>();   // key = tabId
```

- `ARM {tabId, token, delayMs}`：清掉该 tab 已有 timer，`dueAt = performance.now() + delayMs`，
  `setTimeout` 到 `dueAt` 发 `TICK_DONE{tabId, token}` 给 SW；同时每 1s 发一次
  `TICK_PROGRESS{tabId, elapsedMs, totalMs}`（节流到 1s，够面板显示用，也充当"宿主还活着"的证明）。
- `DISARM {tabId}` / `DISARM {token}`：清 timer。
- `PING`：SW 用来确认 offscreen 存活。

### 1.2 SW 侧的四个守卫

| 守卫 | 实现 | 解决的失败模式 |
| --- | --- | --- |
| **token 校验** | `TICK_DONE` 的 token ≠ `session.timerToken` ⇒ 丢弃 | 旧轮次回调污染新会话（改间隔/暂停后立即重启时最常见） |
| **offscreen 存活** | 每 60s `PING`，超时（无响应）⇒ 重建 offscreen 文档 + 按 `armedAt+delayMs` 重算剩余时间重发 `ARM` | offscreen 被系统回收 |
| **alarms 兜底** | `chrome.alarms` 每 1 分钟检查：会话 `status==='start'` 且 `now > armedAt+delayMs+30s` ⇒ 说明 tick 丢了，直接执行该轮刷新并重新 `ARM` | offscreen 与 SW 同时失效（极少） |
| **tab 校验** | 执行前 `tabs.get(tabId)`；不存在 ⇒ 清会话；`discarded/frozen` ⇒ 走冻结分支 | tab 已关闭/被丢弃 |

> `alarms` 的 1 分钟粒度不足以做主计时（最小 30s，实际 1min），因此只作兜底；主计时必须是 offscreen。

### 1.3 SW 重启后的恢复

`chrome.runtime.onStartup` 与 SW 首次激活时：从 `storage.session` 读 `sessions`，
对每个 `status==='start'` 的会话计算 `remain = max(0, armedAt + delayMs - Date.now())`，
若 `remain === 0` 立即刷新，否则 `ARM` 剩余值。这替代 ARP 的 `Vx()`（`resume persisted refresh sessions`）。

## 2. 间隔取值算法（`src/lib/interval.ts`）

```ts
export function nextDelayMs(opt: Options, prevDelayMs: number): number {
  if (opt.intervalMode === 'fixed') return clampSeconds(opt.fixedSeconds) * 1000;
  if (opt.intervalMode === 'random') {
    const min = Math.max(1, Math.floor(opt.randomMinSeconds));
    const max = Math.max(min, Math.floor(opt.randomMaxSeconds));
    if (min === max) return min * 1000;
    const span = max - min + 1;                       // 闭区间 ⇒ +1
    let v = min + Math.floor(Math.random() * span);
    if (opt.avoidRepeatRandom) {
      for (let i = 0; i < 10 && v * 1000 === prevDelayMs; i++) {
        v = min + Math.floor(Math.random() * span);
      }                                                 // 最多 10 次，仍相同就接受
    }
    return v * 1000;
  }
  return clampSeconds(opt.customSeconds) * 1000;
}
```

对照 ARP（`qg()`，`background.js`）：

```js
if (n === `rand`) {
  let t = Number(e.randomMin), n = Number(e.randomMax),
      r = Number.isInteger(t),            // min 是整数 ⇒ 用整数模式
      i = r ? n - t + 1 : n - t,          // 整数 ⇒ 闭区间 (+1)
      a = Math.random() * i + t;
  return Kg(r ? Math.floor(a) * 1e3 : Math.floor(a * 1e3));
}
```

同款点：**整数 min ⇒ 闭区间（`max` 可能被取到）；非整数 ⇒ 半开区间**。
本扩展固定要求 min/max 为整数（`03` 的不变式），因此统一是闭区间，比 ARP 更可预期。

ARP 的"避免连续相同"（`$_()`）：

```js
let r = qg(n, { asRand: true }), i = X(e)?.nextRefresh;
return n.randomMin === n.randomMax || n.randomMin > n.randomMax
  ? r
  : t >= 10 ? r : r === i ? $_(e, t + 1) : r;
```

同款点：`min===max` 或 `min>max` 时不做去重；重试上限 10 次。本扩展保留并开关化（ADR-006）。

## 3. 一轮刷新的时间轴（ADR-005）

```
START ──► [首轮立即刷新] ──► delay = nextDelayMs() ──ARM──►
   ▲                                                        │ TICK_DONE
   └──────────── [执行刷新] ◄───────────────────────────────┘
```

ARP 的时间轴是：`start`（扫描）→ `dS()` 起等待 → 到期 `aT()` → `tT/Jx`（刷新）→ 又回 `start`。
关键差异：**ARP 在 `Ix()` 里"发 `startRefresh` 给内容脚本做扫描"，页面重载是把扫描结果送回来后的动作**，
所以它的"刷新"其实是"重载页面 → 页面加载完 → 内容脚本再扫"。
本扩展没有扫描，所以把"等待 → 重载"直接连起来，周期缩短，语义更明确。

### 3.1 执行顺序（`refresh.ts` 的 `runRefresh(session)`）

1. `tabs.get(tabId)`；不存在 → 清会话；`frozen/discarded` → `tabs.reload` 后进入下一轮（不走上限判定）。
2. 取 `options` 快照（一次读，避免流水中途配置变化导致半新半旧）。
3. **XHR 模式？**（`refreshType === 'xhr'`）
   - `true`：不 reload；若 `autoClickSelector` 有效 → `sendMessage(tabId, {type:'AUTOCLICK', selector})`；
     内容脚本 `document.querySelector(selector)?.click()`。然后**直接** `count++` 并进入下一轮等待。
   - `false`：走 §3.2 完整刷新。
4. `count = count + 1`（在**动作发起后、下一轮 ARM 前**记，与 ARP 的 `c = count + 1; J(e,{count:c,status:'start'})` 同位置）。
5. 上限判定：`refreshLimitEnabled && count >= refreshLimitCount` ⇒ `STOP`（不发下一轮）。
   > ARP 是 `if(o && l>0 && c>l) return $b(t)`，即"已完成的轮次 **大于** 上限才停"（比上限多刷一轮）。
   > 本扩展改为 `>=`，更符合"设置刷新 10 次就刷 10 次"的直觉（ADR-010）。
6. 计算下一轮 `delayMs`，写会话，`ARM`。

### 3.2 完整刷新（照 ARP 的 `lx()` 分支）

```
const cur = await tabs.get(tabId);
const targetUrl = pickTargetUrl(cur.url);      // §4 重定向
if (targetUrl !== cur.url) {
   await tabs.update(tabId, { url: targetUrl, autoDiscardable: false });
   if (hardRefresh) { await waitComplete(tabId); await tabs.reload(tabId, {bypassCache:true}); }
} else {
   await tabs.reload(tabId, { bypassCache: hardRefresh });
}
```

- **keep-active 续期必须在本轮刷新前完成**（ARP 在 `lx()` 里 `o && await rb(i,!0)`，即先续期再 reload），
  否则 reload 期间页面可能被判后台。本扩展顺序：`ensureKeepActive()` → reload。
- reload 后不等待 `complete`，直接进入下一轮等待（与 ARP 不一致点：ARP 等页面加载完才 `start` 下一轮扫描）。
  **理由**：无扫描即无"加载完"的必要；等待时间由用户配置，若页面加载慢于间隔，刷新会被浏览器合并（可接受）。
  这是 ADR-008 的第二部分，需要在 `09` 的验收里明确写清（避免验收者按 ARP 预期）。

## 4. 重定向（A5）

```ts
function pickTargetUrl(opts, session, currentUrl) {
  return opts.redirection === 'canonical' ? session.canonicalUrl : null; // null = 跟随当前 URL
}
```

- `follow`（跟随所有重定向）：`targetUrl = null` ⇒ 不强制改 URL，`tabs.reload` 刷新"当下这个 URL"
  （若页面自己 302 到别处，刷新后自然停在重定向目标上，与 ARP `follow` 一致）。
- `canonical`（跟随规范 URL）：`targetUrl = session.canonicalUrl`（`START` 时记录）。
  若与当前 URL 不同 ⇒ 先 `tabs.update` 回规范 URL 再 reload（ARP `lx()` 的同款分支）。
- 每次成功 reload 后刷新 `canonicalUrl`：
  ARP 在 `redirectionBehavior==='canonical'` 时**不更新** `canonicalUrl`（`m = d===CANONICAL ? canonicalUrl : undefined`）。
  本扩展保持一致：`canonical` 模式下不改写 `canonicalUrl`；`follow` 模式下每轮写当前 URL。

## 5. 交互行为（A4 / A6 / A7）

### 5.1 内容脚本侧（照 ARP 的 `script.js`）

```js
// 捕获阶段，忽略 click 到扩展自身 UI 的情况（ARP: `!g(e.target) && e.isTrusted`）
document.addEventListener('click', (e) => {
  if (!e.isTrusted || isOurUi(e.target)) return;
  const ae = document.activeElement;
  send({ type: 'INTERACTION', isInput: ae?.tagName === 'INPUT' || ae?.tagName === 'TEXTAREA' });
}, true);

// 键盘：忽略 Ctrl/Alt/Meta 组合键（ARP: `if(e.ctrlKey||e.altKey||e.metaKey||g(e.target)) return;`）
document.addEventListener('keydown', (e) => { ...同上, isInput 判断... });
```

ARP 的两个细节必须保留：

1. `e.isTrusted` 过滤 —— 防止我们自己的 `AUTOCLICK` 注入点击或第三方脚本合成事件误触发交互行为。
2. `activeElement` 判 `isInput` —— 不是看 event.target，而是看**当前焦点元素**
   （ARP 原代码：`let e=document.activeElement; Ld('interaction',{isInput:e.tagName==='INPUT'||e.tagName==='TEXTAREA'})`）。

### 5.2 SW 侧决策（照 ARP 的 `xN`）

```ts
function onInteraction(tabId, isInput) {
  const s = sessions.get(tabId); if (!s || !['start','wait','pause'].includes(s.status)) return;
  const o = options;
  if (!o.interactions) return;                    // 总开关
  if (isInput && o.ignoreInputField) return;      // A6
  switch (o.interactionAction) {
    case 'pause':   return pause(tabId);
    case 'restart': return waitThenStart(tabId, o.interactionRestartWait);
    default:        return stop(tabId, { markRecentlyStopped: true });
  }
}
```

ARP 对应实现（`background.js`）：

```js
if (!(!n?.status || t?.isInput && i.ignoreInputField) && Gh(n.status) && r?.domainOptions.interactions) {
  let t = r.domainOptions.interactionAction ?? `stop`;
  switch (t) {
    case `pause`: mS(e.id); break;
    case `restart`: pS(e.id, r.domainOptions.interactionRestartWait); break;
    default: $b(e.id, {markRecentlyStopped: true}); break;
  }
}
```

- `restart`：`pS(tabId, waitSeconds)` ⇒ `status='wait'`、`waitReason='interaction'`、`delayMs=waitSeconds*1000`，
  到期后 `status='start'` 并立即刷新一轮（ARP: `waitRestartInteraction` → `Yx(e)` → `J(status:'start')` + `dS`）。
- `pause`：保留 `count`，`prevStatus` 记录，`RESUME` 时回到原状态（ARP `mS`/`hS`/`gS`）。
- `stop`：清会话（ARP 还会 `markRecentlyStopped` 以便"最近停止"列表，本扩展不需要该列表，故只清理）。

### 5.3 只在"刷新进行中"生效

`Gh(status)` 在 ARP 里是 `['start','wait','countdown'].includes(status)`。
本扩展对应：只在 `start` / `wait` 状态响应交互；`stop`/`pause` 状态忽略
（`pause` 时用户又在页面里点了一下，不应把 `pause` 改成 `stop` —— 与 ARP 一致，因为 `Gh(`pause`)===false`）。

### 5.4 交互保活（ARP 的 `refreshKeepAlive`）

ARP 内容脚本每秒 `refreshKeepAlive` 帮 SW 保活。本扩展不需要（计时在 offscreen），
但**保留一个弱化的心跳**：会话 `status==='start'` 时内容脚本每 5s 上报一次 `PAGE_INTERACTION_HEARTBEAT`，
SW 用于（a）确认内容脚本还活着（b）检测 tab 是否已被导航到别的页面（`sender.tab.url !== session.tabUrl`）。
不是必须项，可放到 M3 之后。

## 6. 让页面在后台保持活动（A2）

三层机制，缺一不可：

### 6.1 注入 MAIN world 的"反隐藏"补丁

照 ARP 的 `Qy()`（`background.js` 内联函数，也是 `keep-active.js` 的内容）：

```js
function keepActivePatch() {
  if (window.__arKEEP) return; window.__arKEEP = true;
  const def = (k, get) => Object.defineProperty(Document.prototype, k, { configurable: true, get });
  def('visibilityState', () => 'visible');
  def('hidden', () => false);
  def('webkitVisibilityState', () => 'visible');
  def('webkitHidden', () => false);
  const hasFocus = Document.prototype.hasFocus;
  try { Document.prototype.hasFocus = () => true; } catch {}
  const stop = (e) => e.stopImmediatePropagation();
  ['visibilitychange', 'webkitvisibilitychange', 'freeze']
    .forEach(t => window.addEventListener(t, stop, true));
  window.addEventListener('blur', (e) => { if (!(e.target instanceof Node)) e.stopImmediatePropagation(); }, true);
  setInterval(() => {                       // 45s 一次伪活动，防"长时间无输入被判空闲"
    const el = document.documentElement; if (!el || hasFocus.call(document)) return;
    const init = { bubbles: true, clientX: 1, clientY: 1 };
    el.dispatchEvent(new MouseEvent('mousemove', init));
    if (typeof PointerEvent === 'function') el.dispatchEvent(new PointerEvent('pointermove', init));
  }, 45000);
}
```

调用方式（ARP 同款）：`chrome.scripting.executeScript({target:{tabId}, world:'MAIN', func: keepActivePatch})`。
`world:'MAIN'` 是必须的 —— 页面自身的 `document.hidden` 检查来自页面上下文，ISOLATED world 的改写页面看不到。

### 6.2 sessionStorage TTL 自愈（`document_start` 的 protect 脚本）

ARP 用 `sessionStorage.__arp_keep_active`（值 = 过期毫秒时间戳，TTL 60s），
由 `keep-active.js`（`run_at: document_start`, `world: MAIN`）在**地址变化/重载后**重新打补丁：

```js
if (Number(sessionStorage.getItem('__arKeepActive')) > Date.now()) patch();
```

本扩展保留该机制，但：

- 键名改为 `__ar_keep_active`（前缀 `__ar` 而不是 ARP 的 `__arp`，避免与"装了原扩展"的环境冲突）。
- TTL 从 60s 提到 **5 分钟**，并在**每轮刷新前**显式续期（ARP 只在 `lx()` 续期 60s）。
  理由：ARP 的 60s 太短，用户如果把间隔设成 5 分钟以上，"保持活动"会在两次刷新之间失效。
  这是有意偏离 ARP 的一处（记录在 ADR-003），代价是会话存储里留一个极小的键。

### 6.3 `tab.autoDiscardable = false`

ARP 在 `lx()` 里 `tabs.update(tabId, {autoDiscardable:false})`，并在停止时恢复 `autoDiscardable:true`（`Zb()`）。
本扩展同款：`START` 时置 `false`，`STOP` 时恢复 `true`。这是"后台标签页不被 Chrome 丢弃"的必要条件。

## 7. XHR 刷新（C2）

ARP 的真相：**XHR 模式根本不重载页面**，它靠"自动点击一个页面元素"来让页面自己发 AJAX。
证据链（`background.js`）：

```js
// 是否 XHR 模式
let Fx = async (e) => {
  let t = HS(e); if (!t) return false;
  let n = await G(`xhr`);                      // premium 门禁
  return t?.pmOptions.refresh === Ux.XHR_REFRESH && n;
};
// XHR 模式下的"刷新"动作
Q_ = async (e) => {
  let t = Y(e); if (!t?.domainOptions || t.session.isFrozen) return;
  let { domainOptions: n } = t;
  if (await G(`xhr`) && n?.pmOptions.refresh === `2` && n.autoclick)
    try { await vh(`autoClick`, { selector: n.autoclick, hints: n.selectorHints }, e); } catch {}
};
// 内容脚本侧
G('autoClick', async ({data:e}) => {
  let { selector: t, hints: n } = typeof e === 'string' ? { selector: e, hints: void 0 } : e,
      r = Vd(t, n);                              // 选择器解析
  r && Tp(r);                                    // 点击
});
```

因此本扩展的 XHR 实现（用户已确认保留选择器输入）：

```ts
// SW 侧 runRefresh
if (opts.refreshType === 'xhr') {
  if (opts.autoClickSelector.trim()) {
    await chrome.tabs.sendMessage(tabId, { type: 'AUTOCLICK', selector: opts.autoClickSelector })
      .catch(() => {/* 内容脚本不在（页面未注入）时静默 */});
  } else {
    // 没有选择器：XHR 模式什么都不做（等价于空转一轮）
    // UI 在状态摘要里给弱提示：'XHR 刷新需要先设置自动点击选择器'
  }
  // 不 reload、不 update URL
}
```

- **premium 门禁去掉**（需求要求移除付费能力）。
- ARP 还有 `selectorHints`（用户手动 pick 的元素提示）——丢弃；只支持标准 CSS 选择器字符串。
- 选择器解析：`document.querySelector` 失败时，**不抛错**，只把失败写入会话 `lastError`（面板可显示）。
- 与 keep-active 的关系：XHR 模式不 reload ⇒ 不需要重打补丁，但仍需 `autoDiscardable=false`。

### 7.1 XHR 模式下的"刷新次数"与重定向

- XHR 不改变 URL ⇒ `canonical`/`follow` 在 XHR 模式下**无差别**（UI 上可把该行置灰，但保留用户选择）。
- 次数上限照常生效。

## 8. 时序图（完整刷新）

```
popup        SW                 offscreen        tabs          content
  │ START ───►│                    │              │               │
  │           │── session=start ──►│              │               │
  │           │── autoDiscardable=false, ensureKeepActive ───────►│(MAIN patch)
  │           │── reload ────────────────────────►│               │
  │           │── count=1, delay=nextDelay ──────►│ ARM           │
  │◄── state ─│                    │              │               │
  │           │                    │ (~8s)        │               │
  │           │◄── TICK_DONE(token)│              │               │
  │           │── reload ────────────────────────►│               │
  │           │── count=2 ...      │              │               │
  │           │  (count>=limit ? STOP : ARM)      │               │
```

## 9. 引擎可测点（`vitest`）

| 单元 | 用例 |
| --- | --- |
| `nextDelayMs` | fixed/random/custom 三模式；`min===max` 退化；闭区间能取到 max；`avoidRepeat` 不返回上一轮值；非法输入被 clamp |
| `pickTargetUrl` | follow/canonical × URL 相同/不同 |
| 上限判定 | `count=limit-1` 继续；`count=limit` 停；开关关闭时永不停 |
| 状态机 | START→PAUSE→RESUME 保留 count；交互 restart 进 `wait` 后回 `start` 并刷新；token 变更丢弃旧 tick |
| keep-active 补丁 | 对一个假 `document` 断言 `hidden===false`、事件被吞、45s 派发被触发（用假 timer） |
