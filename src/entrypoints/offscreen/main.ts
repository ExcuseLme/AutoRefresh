/**
 * offscreen 计时器宿主。设计依据 docs/05-refresh-engine.md §1（ADR-004）
 *
 * 只做一件事：按 SW 的 ARM 指令 `setTimeout`，到期发 `TICK_DONE`。
 * 不做刷新、不读配置、不做决策 —— 决策全在 SW，保证"过期 tick 用 token 丢弃"逻辑集中在一处。
 */
import type { TimerCommand } from '@/lib/messages';

type Armed = { tabId: number; token: string; dueAt: number; timer: number };

const timers = new Map<number, Armed>();

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
    case 'PING': {
      sendResponse({ type: 'PONG', armed: timers.size });
      return false;
    }
    default:
      return false;
  }
});
