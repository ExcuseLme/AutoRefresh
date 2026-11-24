# 02 · 架构与技术栈

## 1. 技术栈（Q1 已确认）

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 构建 | **WXT**（MV3，`@wxt-dev/module-react`） | ARP 本身就是 WXT 打包（`chunks/bg-*.js` 里出现 `wxt/storage`、`wxt/browser`、"This script should only be loaded in a browser extension" 都是 WXT 运行时特征）；对齐后行为语义、热重载、`entrypoints/` 约定一致，省去自建 manifest 流水线 |
| UI | **React 19 + TypeScript** | 面板有分段控件、开关、下拉、瞬时输入校验，状态多；同时 `@wxt-dev/storage` 有强类型封装 |
| 样式 | **Tailwind CSS v4**（`@theme` + CSS 变量 token） | 直接复用 ARP popup 的 `:root` token（已提取，见 `04` §6） |
| 状态 | 轻量本地 store（`useSyncExternalStore` 或 `zustand`） | 面板只读全局 `options` + 当前 tab 会话；不需要重量级方案 |
| 测试 | `vitest`（纯函数/引擎）+ 手工验收清单（`09`） | 引擎的间隔算法、上限、重定向分支是纯逻辑，必须单测 |

> 用户已确认：保留 ARP 的多语言**机制**（`_locales` + `browser.i18n`），但**只维护中文**。
> 实现细节见 `06`。

## 2. 目录结构

```
AutoRefresh/
├─ wxt.config.ts                # manifest 声明、权限、i18n、tailwind
├─ package.json
├─ tsconfig.json
├─ docs/                        # 本设计文档集
├─ assets/                      # 源资产（图标源）
├─ public/icon/                 # 16/32/48/96/128（沿用 ARP 图标可替换为自制）
└─ src/
   ├─ entrypoints/
   │  ├─ background.ts          # SW：消息路由、调度驱动、tab 生命周期
   │  ├─ popup/
   │  │  ├─ index.html
   │  │  ├─ main.tsx
   │  │  └─ App.tsx             # 单屏滚动面板
   │  ├─ offscreen/
   │  │  ├─ index.html          # 精确计时宿主（见 ADR-004）
   │  │  └─ main.ts
   │  └─ content.ts             # 内容脚本（交互上报 + XHR 自动点击 + keep-active 自愈）
   ├─ lib/
   │  ├─ storage.ts             # options 定义/读写/迁移（03）
   │  ├─ interval.ts            # 间隔取值算法（05 §3）
   │  ├─ session.ts             # 每 tab 会话状态机（05 §2）
   │  ├─ refresh.ts             # 刷新流水线（05 §4/§5）
   │  ├─ keep-active.ts         # MAIN world 注入函数（字符串化，见 05 §6）
   │  ├─ xhr-refresh.ts         # XHR 模式：自动点击 + 通知内容脚本
   │  ├─ interaction.ts         # 交互消息 → 动作（05 §5）
   │  ├─ messages.ts            # 消息协议类型（§4）
   │  └─ i18n.ts                # t() 封装 + key 常量
   └─ components/               # 面板组件（04）
```

## 3. manifest 目标（`wxt.config.ts` 里声明，WXT 生成）

```jsonc
{
  "manifest_version": 3,
  "name": "AutoRefresh",
  "default_locale": "zh_CN",
  "permissions": ["tabs", "storage", "scripting", "alarms", "offscreen"],
  "host_permissions": ["<all_urls>"],       // Q2 已确认为安装即申请
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_start",
    "all_frames": false
  }]
}
```

**相对 ARP 的权限削减**（逐项列净省，便于 review）：

| ARP 权限 | 本扩展 | 原因 |
| --- | --- | --- |
| `notifications` | ✗ | 通知功能整体丢弃 |
| `unlimitedStorage` | ✗ | 只存几百字节配置 |
| `contextMenus` | ✗ | 无右键菜单需求 |
| `cookies` | ✗ | ARP 用于同步 `account.autorefresh.io` 的登录态/主题 |
| `webRequest` | ✗ | ARP 仅用于捕获 `main_frame` 错误码做"错误页检测" |
| `sidePanel` | ✗ | 侧边栏丢弃 |
| `offscreen` | **✓ 保留** | 本扩展用它托管精确计时器（ADR-004），是本项目唯一"新增"的权限用法 |
| `power` | ✗ | `power_save`（阻止系统睡眠）未在需求内 |
| `optional_host_permissions` + 运行时 `permissions` 请求 | ✗ | 改为安装即 `<all_urls>` |

> `alarms` 保留：off-screen 计时器仍需要一个兜底唤醒（`chrome.alarms` 最小粒度 1 分钟，
> 只用于"offscreen 被判定死亡后的恢复"，不作主计时手段）。见 `05` §1。

## 4. 上下文与消息协议

四个上下文：**popup** / **service worker (SW)** / **offscreen** / **content script (CS)**。
SW 是唯一可写 `chrome.storage` 与 `chrome.tabs` 的地方（popup 也可，但要避免双写者）。
**约定：popup 只发命令，SW 落库；CS 只上报事实。**

```ts
// src/lib/messages.ts
// popup  → SW
type PopupCommand =
  | { type: 'START' }                       // 对当前活跃 tab 开始刷新
  | { type: 'STOP' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'OPTIONS_PATCH'; patch: Partial<Options> }   // 开关/间隔改动，立即生效
  | { type: 'GET_STATE' };                   // 拉当前 tab 会话 + 全局 options

// SW → offscreen
type TimerCommand =
  | { type: 'ARM'; tabId: number; token: string; delayMs: number }
  | { type: 'DISARM'; tabId?: number; token?: string }
  | { type: 'PING' };
// offscreen → SW
type TimerEvent =
  | { type: 'TICK_DONE'; tabId: number; token: string }  // 到期，SW 执行这一轮刷新
  | { type: 'TICK_PROGRESS'; tabId: number; elapsedMs: number; totalMs: number }; // 面板显示用，可节流

// SW → content script
type CsCommand =
  | { type: 'KEEP_ACTIVE'; enabled: boolean; ttlMs: number }   // 续期 __arp_keep_active
  | { type: 'AUTOCLICK'; selector: string }                     // XHR 模式触发
  | { type: 'ENABLE_INTERACTION'; enabled: boolean };

// content script → SW（CS 只报事实）
type CsEvent =
  | { type: 'INTERACTION'; isInput: boolean }
  | { type: 'PAGE_INTERACTION_HEARTBEAT' };  // 可选，见 05 §5.4
```

命名建议：以 `AR:` 前缀避免与页面自身 `runtime.onMessage` 冲突（ARP 用的是"裸 `type`"，容易被页面库干扰）。

## 5. 会话归属与多标签页

- 会话以 **`tabId`** 为键，存于 SW 内存 `Map`（`sessionStore`），并镜像到 `chrome.storage.session`
  以保证 SW 被回收后可恢复（ARP 也这么做：`persist_refresh_sessions` + `storage.session` 的 `ready` 键）。
- 同一 tab 只允许一个会话；`START` 时若已有会话先 `STOP` 再建（ARP: `Rx` 开头就 `$b(n,{isStart:true})`）。
- tab 关闭：`chrome.tabs.onRemoved` → 清会话 + `DISARM` 定时器。
- tab 被浏览器丢弃/冻结：`tabs.onUpdated` 里 `discarded`/`frozen` 时标记 `isFrozen`，
  刷新退化为 `tabs.reload`（ARP: `dx` 中 `if(X(e)?.isFrozen) return ux(e,t)`）。

## 6. 与 ARP 的上下文差异（实现须知）

| 关注点 | ARP | 本扩展 |
| --- | --- | --- |
| 定时 | SW 内 `setTimeout` 链（`dS()` 自递归、`performance.now()` 计时）+ CS 每秒 `refreshKeepAlive` 心跳把 SW 拉活 | SW **不持有长定时器**：交给 offscreen 用 `setTimeout`/`setInterval` 计时，到期消息 SW 执行（ADR-004） |
| 计时器精度 | 1s 内拣选（`Math.min(1000, ...)`） | 精确到 `setTimeout` 自然精度 + 到期后 `tabs.get` 校验 |
| 停止语 | `stopRefresh`/`resetRefresh`/`pauseRefresh`/`resumeRefresh` 多套 | 统一为 `STOP/PAUSE/RESUME` 三态 + `START` 重置 |
| 状态持久 | `local:refresh_sessions`（主体）+ `storage.session.ready` | `storage.session`（会话）+ `local:options`（全局配置），见 `03` |
