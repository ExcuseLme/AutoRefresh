/**
 * offscreen 计时器宿主。设计依据 docs/05-refresh-engine.md §1（ADR-004）
 *
 * 两件事：
 * 1. 按 SW 的 ARM 指令 `setTimeout`，到期发 `TICK_DONE`；
 * 2. 按 `BADGE_WATCH` 指令，**每秒**刷新该标签页图标上的倒计时（ADR-031）。
 *
 * 为什么徽章倒计时由 offscreen 而不是 SW 驱动：
 * SW 空闲约 30s 就被回收。为了让图标每秒更新而去唤醒 SW，等于持续阻止它休眠，
 * 既费电又可能触发 Chrome 的 SW 过度唤醒限制。offscreen 文档在计时期间本来就是活的
 * （它持有 setTimeout），可以稳定地每秒发一次 tick。
 *
 * 不做刷新、不读配置、不做决策 —— 决策全在 SW，保证"过期 tick 用 token 丢弃"逻辑集中在一处。
 */
import type { TimerCommand } from '@/lib/messages';


type Armed = { tabId: number; token: string; dueAt: number; timer: number };

const timers = new Map<number, Armed>();

/** tabId → { dueAt, interval }：正在被每秒刷新的倒计时 */
type BadgeWatch = { dueAt: number; interval: number };
const badgeWatches = new Map<number, BadgeWatch>();

function disarm(tabId: number): void {
  const cur = timers.get(tabId);
  if (!cur) return;
  clearTimeout(cur.timer);
  timers.delete(tabId);
}

function disarmAll(): void {
  for (const id of [...timers.keys()]) disarm(id);
}

function reportDone(tabId: number, token: string): void {
  try {
    void chrome.runtime.sendMessage({ type: 'TICK_DONE', tabId, token }).catch(() => {
      /* SW 正在唤醒中，消息可能短暂失败；由 SW 的 alarms 兜底 */
    });
  } catch {
    /* 忽略 */
  }
}

// ────────────────────────────────────────────── 徽章倒计时
//
// 注意（ADR-031 实测）：**offscreen 文档里没有 `chrome.action`**。
// offscreen 只能访问一小撮 API（runtime / storage / i18n 等），`chrome.action` 不在其中，
// 直接调用会抛异常。所以这里不自己画徽章，而是**每秒给 SW 发一条 `BADGE_TICK`**，
// 由 SW 用 `chrome.action` 去写。
//
// 代价：会话运行期间 SW 每秒被唤醒一次，因此不会进入 30s 空闲休眠。
// 这是"图标上要有秒级倒计时"的必然成本 —— 换成 SW 自己 setInterval 也不行：
// SW 空闲 30s 会被回收，定时器随之中断，徽章会冻结在最后一个值。

function tickBadge(tabId: number): void {
  if (!badgeWatches.has(tabId)) return;
  try {
    void chrome.runtime.sendMessage({ type: 'BADGE_TICK', tabId }).catch(() => {
      /* SW 正在唤醒/已回收：忽略，下一次 tick 会重试 */
    });
  } catch {
    /* 忽略 */
  }
}

function unwatchBadge(tabId?: number): void {
  const ids = typeof tabId === 'number' ? [tabId] : [...badgeWatches.keys()];
  for (const id of ids) {
    const w = badgeWatches.get(id);
    if (w) {
      clearInterval(w.interval);
      badgeWatches.delete(id);
    }
  }
}

function watchBadge(tabId: number, dueAt: number): void {
  unwatchBadge(tabId);
  // 立即 tick 一次，避免"开了刷新但图标还停留在上一个状态"的一秒空窗
  const interval = window.setInterval(() => tickBadge(tabId), 1000);
  badgeWatches.set(tabId, { dueAt, interval });
  tickBadge(tabId);
}

// ────────────────────────────────────────────── 路由

chrome.runtime.onMessage.addListener((msg: TimerCommand & { to?: string }, _sender, sendResponse) => {
  if (msg?.to !== 'offscreen') return false;

  switch (msg.type) {
    case 'ARM': {
      disarm(msg.tabId);
      const delay = Math.max(0, Math.floor(msg.delayMs));
      const timer = window.setTimeout(() => {
        timers.delete(msg.tabId);
        reportDone(msg.tabId, msg.token);
      }, delay);
      timers.set(msg.tabId, {
        tabId: msg.tabId,
        token: msg.token,
        dueAt: performance.now() + delay,
        timer: timer as unknown as number,
      });
      sendResponse({ ok: true });
      return false;
    }
    case 'DISARM': {
      if (typeof msg.tabId === 'number') disarm(msg.tabId);
      else disarmAll();
      sendResponse({ ok: true });
      return false;
    }
    case 'BADGE_WATCH': {
      watchBadge(msg.tabId, msg.dueAt);
      sendResponse({ ok: true });
      return false;
    }
    case 'BADGE_UNWATCH': {
      unwatchBadge(msg.tabId);
      sendResponse({ ok: true });
      return false;
    }
    case 'PING': {
      sendResponse({ type: 'PONG', armed: timers.size, watching: badgeWatches.size });
      return false;
    }
    default:
      return false;
  }
});
