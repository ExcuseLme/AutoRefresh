# 11 · XHR 自动点击配置按页面隔离（ADR-022）

> 状态：**已实施**。本文记录问题、设计、迁移与验收，代码落点为
> `src/lib/page-selectors.ts` + schema v3。

---

## 1. 问题

用户反馈：

> `自动点击元素选择器` 的配置隔离维度不对，现在它是全局共享。
> 在 A 页面中选择元素并开始 XHR 自动刷新后，在 B 页面中选择元素后会导致
> 在 A 页面中的 XHR 刷新的触发元素也变更为在 B 页面中选择的那个了，这完全不正确。
> selector 应该是 **url 级别隔离**的（注意不是域名级别，是更详细的 url 级别）。

### 1.1 根因

v2 里 `autoClickSelector` 与 `autoClickAction` 是 `options` 的字段，而 `options` 是**唯一一份全局配置**
（这是 ARP 时代的遗产：ARP 用 `domain_config` 做域名级隔离，但本扩展按 ADR-002 明确丢弃了多作用域）。

于是 `applyPickerResult` 直接把拾取结果写进这份全局配置：

```ts
// 改前（v2）
const result = applyPatch(options, { autoClickSelector: selector });
options = result.options;
await setOptions(options);
```

而 `executeRound` 每轮都从这份全局配置读：

```ts
// 改前（v2）
autoClickSelector: options.autoClickSelector,
```

⇒ A 页的会话在下一轮拿到的是 B 页刚写的 selector。**两边共享同一个可变单元格。**

### 1.2 为什么"域名级"也不够

用户明确要 **URL 级**而不是域名级。这是对的：同一个域名下的不同路径是完全不同的页面，
刷新按钮的位置/选择器也通常不同。典型反例：

- `mail.google.com/mail/u/0/`（收件箱）与 `/mail/u/1/`（第二个账号）是不同页面
- 内部管理系统 `http://10.25.150.155:8080/ms/index` 与同域其他模块各自有自己的"刷新"按钮

---

## 2. 设计（ADR-022）

### 2.1 隔离粒度：协议 + 主机 + 路径

`pageKey = 协议//主机/路径`，**忽略 query 与 #hash**。用户已确认。

| 例子 | pageKey | 说明 |
| --- | --- | --- |
| `https://mail.google.com/mail/u/0/#inbox` | `https://mail.google.com/mail/u/0` | hash 忽略 ⇒ 切文件夹共用（刷新按钮是同一个） |
| `https://mail.163.com/js6/main.jsp?sid=AAA` | `https://mail.163.com/js6/main.jsp` | query 忽略 ⇒ 重新登录 sid 变了配置仍有效 |
| `https://mail.google.com/mail/u/1/` | `https://mail.google.com/mail/u/1` | **不是域名级**，两个账号互不影响 |

实现细节（`pageKeyOf`）：

- 尾部斜杠归一（`/a` 与 `/a/` 同一页，根路径保留 `/`）
- 主机名小写归一
- 默认端口由 `new URL()` 自动去掉（`https://x:443/a` ⇒ `https://x/a`）
- **非 http(s) 或无法解析 ⇒ 返回 `null`**，调用方必须当作"这个页面没配置"，
  绝不允许回落到某个全局值 —— 那就又变成共享了

### 2.2 触发方式也按页面

`autoClickAction`（单击/双击）跟 selector **一起存**在同一条页面记录里。
理由：触发方式本身就是"那个页面上那个元素的属性"，不同页面很可能不同
（用户的实际场景：有些页面单击就刷新，有些必须双击子 tab）。用户已确认。

### 2.3 会话锁定启动时的页面

一个刷新会话进行中，页面自己跳转了（`follow` 模式），该用哪个 URL 的配置？
用户已确认：**锁定会话启动时的 URL**。

`Session.pageKey` 在 `createSession` 时由 `pageKeyOf(tabUrl)` 记录，之后**永不改写**。
`executeRound` 用它而不是当前 `tab.url` 取配置：

```ts
// 改后（v3）
const pageEntry = s.pageKey ? await getSelectorForUrl(s.pageKey) : null;
const outcome = await runRefresh(tabId, {
  autoClickSelector: pageEntry?.selector ?? '',
  autoClickAction: pageEntry?.action ?? 'single',
  // …
});
```

好处：行为可预测 —— 页面跳走了也不会突然改去点新页面上的元素；
失败原因也好解释（"这个页面没配 selector" vs "配的 selector 找不到了"）。
代价：从 A 页跳到 B 页后，会话仍在用 A 的配置（大概率失败）。
但那是用户自己选的 follow 模式 + 页面自己跳转，属于可解释行为。

### 2.4 存储：独立键 `pageSelectors`

与 `options` 分开存：

```ts
// chrome.storage.local
options:       { schemaVersion: 3, intervalMode: 'fixed', fixedSeconds: 10, … }
pageSelectors: {
  'https://mail.google.com/mail/u/0': { selector: '[aria-label="刷新"]', action: 'single', updatedAt: 1795… },
  'https://mail.163.com/js6/main.jsp': { selector: '#_mail_button_212_1083 > span', action: 'single', updatedAt: 1795… }
}
```

分开的好处：

- 改一个页面的 selector **不会触发全局配置的 `storage.onChanged` 广播**
  （否则每改一次都要所有上下文重算 options，毫无必要）
- `options` 体积不随访问页面数增长
- 两个键的生命周期不同：`options` 是用户偏好，`pageSelectors` 可被容量上限裁剪

### 2.5 容量与脏数据

| 约束 | 值 | 理由 |
| --- | --- | --- |
| `MAX_PAGES` | 300 | 超出按 `updatedAt` 淘汰最旧的（LRU）。防脏数据把 storage 撑爆 |
| `MAX_SELECTOR_LEN` | 2000 | 正常 selector 远小于此；超长基本是异常输入 |

`sanitizePageSelectors` 逐条校验：key 必须是合法 pageKey、selector 非空且不超长、
`action` 脏值回落 `single`、`updatedAt` 脏值回落 0。
**坏的条目丢弃，好的保留**（不是整份作废）。

### 2.6 消息与 UI

新增两条 popup → SW 消息（不再走 `OPTIONS_PATCH`）：

```ts
| { type: 'SELECTOR_SET'; tabId: number; selector: string }
| { type: 'CLICK_ACTION_SET'; tabId: number; action: ClickAction }
```

`GET_STATE` 的返回增加三个字段：

```ts
pageSelector: PageSelectorEntry | null;   // 当前页面的配置（无则 null）
pageKey: string | null;                   // 当前页面的 key（面板显示，也方便排查）
sessionPageKey: string | null;            // 运行中会话锁定的 key
```

面板行为：

- 输入框回显的是**当前页面**的 selector（没配过就是空）
- 下方常驻一行 `仅对当前页面生效：https://…` —— 让"隔离"这件事可见，而不是靠用户猜
- 若运行中的会话锁定的页面 ≠ 当前页面，再显示一条提示：
  `运行中的会话属于另一个页面（…），改这里不会影响它`

---

## 3. 迁移（v2 → v3）

### 3.1 形状迁移

```ts
export function migrateV2ToV3(raw) {
  const next = { ...raw };
  delete next.autoClickSelector;
  delete next.autoClickAction;
  next.schemaVersion = 3;
  return next;
}
```

`migrate()` 按 `schemaVersion` 逐版本推进（`<2` 跑 v1→v2，`<3` 跑 v2→v3），再统一校验。
顺序不能反（见 §3.3）。

### 3.2 旧值不自动写到任何页面

**这是刻意选择**：迁移时无从得知用户当初那个全局 selector 属于哪个 URL。
把全局值写到"当前打开的页面"是**猜**，猜错会在错误页面上点错元素 ——
比"让用户重选一次"危险得多。所以直接丢弃。

用户成本：升级后需要回到目标页面重新点一次「选择元素」（一次操作，几秒钟）。
这是可以解释的（面板会显示"当前页面还没有选择器"）。

### 3.3 为什么形状迁移必须先于校验

若先校验，`migrateV1ToV2` 的 `intervalMode='custom'` 在 v2 枚举里不存在，
会被 `pickEnum` 静默变成 `'fixed'`，用户的 `customSeconds` 就丢了。
同理 v2→v3 的字段删除也必须在 `validateOptions` 之前完成。
所以 `migrate()` 的结构是"先把形状推到当前版本，再校验一次"。

### 3.4 迁移表

| 存档状态 | 结果 |
| --- | --- |
| v1 + `intervalMode='custom'` + `customSeconds=7` + 全局 selector | v3；`fixedSeconds=7`；selector **丢弃**（需重选） |
| v2 + 全局 selector/action | v3；全部字段保留，selector/action **丢弃** |
| v3 | 不变 |

---

## 4. 验收

### 4.1 单测（`tests/page-selectors.test.ts`，26 例）

覆盖：pageKey 的 query/hash/尾斜杠/大小写/端口/协议/非法 URL；
读写隔离（**写 B 不影响 A**，就是用户报的 bug）；
action 跟随页面；覆盖写不新增条目；空 selector = 删除；超长截断；
容量 LRU 淘汰；脏数据逐条清洗；不修改入参。

### 4.2 真实浏览器实测

| 用例 | 结果 |
| --- | --- |
| A 页 `10.25.150.155:8080/ms/index` + B 页 `10.25.197.170:19090/…/main_frame.jsp` 各写 selector | `pageSelectors` 出现**两条独立记录**，`.btn-on-A` 与 `.btn-on-B` 互不覆盖 |
| A 页启动 XHR 会话后，去 B 页改写 selector | A 的 `pageSelector.selector` **仍是 `.btn-on-A`**；A 的 `sessionPageKey` 指向 A；`lastError='xhr_not_found'`（因为 `.btn-on-A` 在真实页面上不存在，这是预期的失败语义） |
| A 设 `double`、B 设 `single` | 两条记录 `action` 各自独立 |
| 两个同在 `/app/discover` 的标签页（仅 hash/query 不同） | 合并为**同一条**记录（符合 §2.1 的设计） |
| 面板回显 | 输入框显示 `.btn-on-A`，下方显示 `仅对当前页面生效：http://10.25.150.155:8080/ms/index`（截图 `impl-v3-per-page.png`） |

### 4.3 测试与构建

`pnpm verify` 全绿：9 个测试文件 / **154 例** / `check:scope` 0 命中。
（体积 315.54KB，用户已明确不设体积门槛。）
