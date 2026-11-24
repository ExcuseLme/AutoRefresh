# 03 · 存储与状态模型

## 1. 全局配置（唯一持久配置，`chrome.storage.local`）

有两个键：`options`（全局配置）与 `pageSelectors`（按页面隔离的 XHR selector，ADR-022）。**不再有** `domain_config` / `site_scopes` / `custom` / `duration` 等 ARP 的多作用域结构。

```ts
// src/lib/options.ts
export type IntervalMode = 'fixed' | 'random';          // v2：'custom' 已删除（ADR-021）
export type ClickAction = 'single' | 'double';          // XHR 点击方式（ADR-020）

export type Options = {
  schemaVersion: 3;            // v1 → v2（ADR-021）→ v3（ADR-022）

  // 间隔
  intervalMode: IntervalMode;
  fixedSeconds: number;        // 固定档**唯一**数据源：−/+ ∓1、chip 上屏、手动输入都写它
  randomMinSeconds: number;    // 闭区间下界（B4）
  randomMaxSeconds: number;    // 闭区间上界
  avoidRepeatRandom: boolean;  // 是否避免连续两轮取到同一个值（ADR-006）

  // 刷新类型（原「监控」tab 的刷新类型，搬到「间隔」）
  refreshType: 'full' | 'xhr';
  // 注意：XHR 的 autoClickSelector / autoClickAction **不在这里**（ADR-022 起按页面存）

  // 通用开关（A1–A7）
  hardRefresh: boolean;        // A1
  keepActive: boolean;         // A2
  refreshLimitEnabled: boolean;// A3 开关
  refreshLimitCount: number;   // A3 次数，≥1 整数
  interactions: boolean;       // A4/A7 总开关
  interactionAction: 'pause' | 'stop' | 'restart';
  interactionRestartWait: number; // 秒，≥0，仅 restart 时生效
  ignoreInputField: boolean;   // A6，默认 true
  redirection: 'follow' | 'canonical'; // A5
};

export const DEFAULT_OPTIONS: Options = {
  schemaVersion: 2,
  intervalMode: 'fixed',
  fixedSeconds: 10,
  randomMinSeconds: 5,
  randomMaxSeconds: 30,
  avoidRepeatRandom: true,

  refreshType: 'full',

  hardRefresh: false,
  keepActive: false,
  refreshLimitEnabled: false,
  refreshLimitCount: 10,
  interactions: false,
  interactionAction: 'stop',
  interactionRestartWait: 5,
  ignoreInputField: true,
  redirection: 'follow',
};
```

### 设计取舍

- **固定档只有一个 `fixedSeconds`（ADR-021）**：v1 曾把 `fixedSeconds` / `customSeconds` / `fixedPreset`
  分存，用 `fixedPreset` 显式记录"值相等但意图不同"（自定义输入 5 到底该选中"5秒"chip 还是"自定义"chip）。
  用户实测后明确要求**放弃这种消歧**：−/+、chip、手动输入三者写同一个数字，
  **值就是意图**（输 5 时"5秒"chip 自然高亮，这是正确的）。因此 v2 删掉 `customSeconds` 与 `fixedPreset`，
  `intervalMode` 也从 `'fixed' | 'random' | 'custom'` 收成 `'fixed' | 'random'`。
- **所有时间单位统一为"秒"，且一律为整数（OQ-5 结论）**：ARP 内部秒/毫秒混用
  （`custom_interval` 秒、`nextRefresh` 毫秒、`randomMin/Max` 秒），本扩展在边界处一次性换算，
  内部只传毫秒。用户明确要求"不要小数, 整数就够用了"，因此 `fixedSeconds` /
  `randomMinSeconds` / `randomMaxSeconds` / `interactionRestartWait` 全部是整数，
  且**拒绝小数输入**（不能用 `Number.parseInt`，它会把 `2.5` 悄悄截成 `2`）。
- **`autoClickAction` 已按页面隔离（ADR-022）**：`'single' | 'double'`，与 selector 一起存于 `pageSelectors`，只影响点击时派发几次按下序列，
  不改变选择器语义。脏值回落 `'single'`（与其它枚举一致，不拒绝整条 patch）。

### v1 → v2 迁移（ADR-021 / R20）

| v1 状态 | v2 结果 |
| --- | --- |
| `intervalMode='custom'` + `customSeconds=7` | `intervalMode='fixed'` + `fixedSeconds=7`（**保值，不丢用户设置**） |
| `intervalMode='fixed'` + `fixedSeconds=60` | 不变 |
| `intervalMode='random'` | 不变（`customSeconds` / `fixedPreset` 删除） |
| 只有 `fixedPreset` 没有 `fixedSeconds`（脏数据） | `fixedSeconds = fixedPreset` |
| `customSeconds` 非法（如 `2.5`） | 不动 `fixedSeconds`，保留原值 |

迁移是**纯形状改写**（`migrateV1ToV2`），之后才走统一校验（ADR-007）。
顺序不能反：先校验的话，v1 的 `'custom'` 在 v2 枚举里不存在，会被 `pickEnum` 静默变成 `'fixed'`，
用户的 `customSeconds` 就丢了 —— 这正是 `migrate()` 里"先迁移再校验"的原因。
`getOptions()` 在首读时把迁移结果**回写一次**，避免每次读取都重跑、也避免 storage 里长期留旧 schema。


### 1.1 `pageSelectors` 键（per-URL，ADR-022）

```ts
// chrome.storage.local，与 options 并列
pageSelectors: {
  [pageKey: string]: {
    selector: string;      // 该页面的自动点击目标
    action: 'single' | 'double';  // 触发方式（与 selector 一起按页面存）
    updatedAt: number;     // LRU 淘汰用
  }
}

// pageKey = 协议//主机/路径（忽略 query 与 #hash）
//   'https://mail.google.com/mail/u/0'     ← #inbox / #sent 共用
//   'https://mail.163.com/js6/main.jsp'    ← ?sid=xxx 变了仍有效
//   'https://mail.google.com/mail/u/1'     ← 不同页面，互不影响（不是域名级）
```

- 与 `options` 分键存的理由：改一个页面的 selector **不触发全局配置广播**，
  且 `options` 体积不随访问页面数增长。
- 容量上限 `MAX_PAGES = 300`，超出按 `updatedAt` 淘汰最旧的。
- `sanitizePageSelectors` 逐条校验：**坏条目丢弃、好条目保留**（不是整份作废）。
- 无法解析的 URL（`chrome://` / `file://` / 空）→ `pageKeyOf` 返回 `null`，
  调用方视为"该页面没配置"，**绝不回落到别的页面**（否则又变成共享了）。
- 运行中的会话用 `Session.pageKey`（START 时记录后**永不改写**）取配置，
  这样 follow 模式下页面跳走了也不会突然改去点新页面的元素。
## 2. 不变式（写入时校验，写入失败不落库）

| 字段 | 规则 | 违反时 |
| --- | --- | --- |
| `fixedSeconds` | 整数 `>= 1`；`<= 86400`（1 天，防手滑） | 拒绝 + 内联错误（`err_not_integer` / `err_interval_positive` / `err_interval_max`） |
| `randomMinSeconds` | 整数 `>= 1`；`<= 86400` | 同上 |
| `randomMaxSeconds` | 整数 `>= randomMinSeconds`；`<= 86400` | 同上（跨字段报 `err_random_range`） |
| `refreshLimitCount` | 整数 `>= 1` | 同上（`err_limit_count`） |
| `interactionRestartWait` | 整数 `>= 0`，`<= 3600` | 同上（`err_restart_wait`） |
| `autoClickSelector` | **已移出 options**（ADR-022 按页面存于 `pageSelectors`）；运行时无效则跳过点击，不清空值 | 运行时降级 |
| `autoClickAction` | **已移出 options**（ADR-022）；`sanitizePageSelectors` 里脏值回落 `'single'` | 逐条清洗，不整份作废 |

> 与 ARP 的差异：ARP 会把非法值静默回落到默认（`Kg`：非有限/≤0 ⇒ 12000ms）。
> 本扩展改为**显式拒绝**，避免"用户以为设了 0.5 秒实际是 12 秒"的错觉。详见 ADR-007。

## 3. 会话状态（每 tab，`chrome.storage.session` 镜像）

```ts
export type SessionStatus = 'stop' | 'start' | 'pause' | 'wait';

export type Session = {
  tabId: number;
  status: SessionStatus;
  tabUrl: string;            // 启动时 URL（canonical 用）
  canonicalUrl: string;      // 启动/每次刷新时记录，供 redirection='canonical'
  count: number;             // 已完成刷新轮次
  timerToken: string;        // 每轮唯一，防止旧定时器过期消息污染新会话
  armedAt: number;           // 本轮开始时间（Date.now）
  delayMs: number;           // 本轮等待毫秒
  prevDelayMs: number;       // 上一轮（avoidRepeatRandom 用）
  waitReason?: 'interaction' | 'error';
  lastError?: string;
};
```

状态机（与 ARP 的 `start/countdown/wait/pause/stop/complete` 对齐并简化掉 `countdown`/`complete`）：

```
              START
                │
                ▼
   ┌────────► start ──(delay 到期)──► [执行刷新] ──► start（count++）
   │            │  ▲                        │
   │       PAUSE│  │RESUME                  │ 达到上限 / 用户 STOP
   │            ▼  │                        ▼
   │          pause └───────────────►      stop
   │            │
   │       (交互 restart) ──► wait ──(wait 到期)──► start
   └────────────────────────────────────────────────┘
```

- `wait` 只有一个用途：**交互触发 restart 时的延迟**（`waitReason='interaction'`）。
  ARP 还有 `waitContentLoad`（等页面加载完再扫）——我们不做监控，故无非用。
- 状态变迁必须**带 `timerToken`**：offscreen 发出的 `TICK_DONE` 若 token 与当前不一致，直接丢弃
  （这是 MV3 下最常见的一类陈旧回调 bug）。

## 4. 持久化策略

| 数据 | 存放 | 理由 |
| --- | --- | --- |
| `options` | `chrome.storage.local` | 跨重启保留；`storage.onChanged` 让所有上下文即时同步 |
| `sessions` | SW 内存 + `chrome.storage.session` | SW 被回收后恢复（session 存储不落盘，符合"刷新任务是本会话内的事"） |
| offscreen 计时器 | 不持久 | 恢复由 SW 依据 `session.armedAt + delayMs` 重建（见 `05` §1.3） |

> ARP 用 `local` 存会话（`local:refresh_sessions`），意味着浏览器重启后仍会"接着刷"。
> 本扩展**故意降级为 session**：重启浏览器后不自动恢复刷新（更可预期，也避免"忘了关"）。

## 5. 迁移与兼容

- 首个版本 `schemaVersion = 1`，写入 `options.__v`。
- 读取时 `migrate(raw)`：`__v` 缺失 ⇒ 按默认值补全未知字段、丢弃未知键（不抛错）。
- **不读取 ARP 的存储**（键名与结构完全不同，且 ARP 的 `domain_config` 语义本扩展不支持）。
  若将来要提供"从 ARP 导入"，作为显式功能另开 ADR。

## 6. 读写纪律

1. 只在 SW 写 `options`（popup 发 `OPTIONS_PATCH`）。popup 自身读 `storage.local` 以获得即时渲染
   （`storage.onChanged` 会广播，所以读是安全的）。
2. `OPTIONS_PATCH` 需做 **字段级合并 + 校验后再落库**；任何字段非法则整条 patch 拒绝并返回错误。
3. 会话写操作全部经 `sessionStore` 单点，禁止直接 `storage.session.set`（防止并发写覆盖）。