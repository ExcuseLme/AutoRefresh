import { decideInteraction } from '@/lib/interaction';
import { nextDelayMs } from '@/lib/interval';
import {
  clearKeepActive,
  ensureKeepActive,
  setAutoDiscardable,
} from '@/lib/keep-active-runtime';
import type { ContentEvent, PopupCommand, StateSnapshot, TimerCommand, TimerEvent } from '@/lib/messages';
import { armTimer, disarmTimer, ensureOffscreen, pingOffscreen } from '@/lib/offscreen-client';
import type { Options } from '@/lib/options';
import { probeSelector, runRefresh } from '@/lib/refresh';
import { createSession, type Session } from '@/lib/session';
import { acceptsInteraction, canPause, canResume } from '@/lib/session-machine';
import { loadSessions, saveSessions } from '@/lib/session-store';
import { getOptions, setOptions, watchOptions } from '@/lib/storage';
import { reachedLimit, isRefreshableUrl } from '@/lib/url';
import { applyPatch } from '@/lib/validate';

export default defineBackground(() => {
  // ────────────────────────────────────────────────────────────── 状态

  const sessions = new Map<number, Session>();
  let options: Options;
  let ready: Promise<void> | null = null;

  const ALARM_WATCHDOG = 'ar-watchdog';
  const WATCHDOG_PERIOD_MIN = 1;
  /** 到期后多久算"tick 丢了"（alarms 兜底阈值，docs/05 §1.2） */
  const TICK_LATE_TOLERANCE_MS = 30_000;

  function token(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function persist(): Promise<void> {
    await saveSessions(sessions);
  }

  async function ensureReady(): Promise<void> {
    if (ready) return ready;
    ready = (async () => {
      options = await getOptions();
      const restored = await loadSessions();
      for (const [tabId, s] of restored) {
        // SW 被回收后恢复：按 armedAt + delayMs 重算剩余时间（docs/05 §1.3）
        const remain = s.armedAt + s.delayMs - Date.now();
        if (remain <= 0) {
          // 已经过期：立刻执行这一轮
          sessions.set(tabId, { ...s, armedAt: Date.now(), delayMs: 0 });
        } else {
          sessions.set(tabId, s);
        }
      }
      for (const [tabId, s] of sessions) {
        if (s.status === 'start') {
          const remain = Math.max(0, s.armedAt + s.delayMs - Date.now());
          await armTimer(tabId, s.timerToken, remain);
        }
      }
      await ensureWatchdog();
    })();
    return ready;
  }

  async function ensureWatchdog(): Promise<void> {
    try {
      const existing = await chrome.alarms.get(ALARM_WATCHDOG);
      if (!existing) {
        await chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: WATCHDOG_PERIOD_MIN });
      }
    } catch {
      /* 忽略 */
    }
  }

  // ────────────────────────────────────────────────────────────── 会话动作

  async function broadcastInteraction(enabled: boolean, tabId?: number): Promise<void> {
    const targets = tabId !== undefined ? [tabId] : [...sessions.keys()];
    await Promise.all(
      targets.map(async (id) => {
        try {
          await chrome.tabs.sendMessage(id, { type: 'SET_INTERACTION', enabled });
        } catch {
          /* 内容脚本未注入时忽略 */
        }
      }),
    );
  }

  async function updateBadge(): Promise<void> {
    // OQ-4：运行中绿点、暂停黄点、失败红叹号、停止清空
    for (const [tabId, s] of sessions) {
      const failed = Boolean(s.lastError);
      const text = failed ? '!' : s.status === 'start' ? '●' : s.status === 'pause' ? 'II' : '…';
      const color = failed ? '#dc2626' : s.status === 'pause' ? '#f59e0b' : '#22c55e';
      try {
        await chrome.action.setBadgeText({ text, tabId });
        await chrome.action.setBadgeBackgroundColor({ color, tabId });
      } catch {
        /* 忽略 */
      }
    }
  }

  async function clearBadge(tabId: number): Promise<void> {
    try {
      await chrome.action.setBadgeText({ text: '', tabId });
    } catch {
      /* 忽略 */
    }
  }

  async function start(tabId: number): Promise<{ ok: true } | { ok: false; code: 'err_page_unavailable' }> {
    await ensureReady();
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !isRefreshableUrl(tab.url)) return { ok: false, code: 'err_page_unavailable' };

    if (sessions.has(tabId)) await stop(tabId);

    const firstDelay = nextDelayMs(options);
    const s = createSession(tabId, tab.url!, firstDelay, token());
    sessions.set(tabId, s);

    await setAutoDiscardable(tabId, false);
    if (options.keepActive) await ensureKeepActive(tabId);
    await broadcastInteraction(options.interactions, tabId);
    await updateBadge();

    // ADR-005：首轮立即刷新
    await executeRound(tabId);
    return { ok: true };
  }

  async function stop(tabId: number): Promise<{ ok: true }> {
    sessions.delete(tabId);
    await persist();
    await disarmTimer(tabId);
    await clearBadge(tabId);
    await clearKeepActive(tabId);
    await setAutoDiscardable(tabId, true);
    await broadcastInteraction(false, tabId);
    return { ok: true };
  }

  async function pause(tabId: number): Promise<{ ok: true }> {
    const s = sessions.get(tabId);
    if (s && canPause(s.status)) {
      s.status = 'pause';
      await persist();
      await disarmTimer(tabId);
      await updateBadge();
    }
    return { ok: true };
  }

  async function resume(tabId: number): Promise<{ ok: true }> {
    const s = sessions.get(tabId);
    if (s && canResume(s.status)) {
      confirmStarted(s, nextDelayMs(options, s.prevDelayMs));
      await executeRound(tabId);
    }
    return { ok: true };
  }

  /** 把会话置为"正在等待下一轮"（不立即刷新） */
  function confirmStarted(s: Session, delayMs: number): void {
    s.status = 'start';
    s.prevDelayMs = s.delayMs;
    s.delayMs = delayMs;
    s.armedAt = Date.now();
    s.timerToken = token();
    void persist();
    void armTimer(s.tabId, s.timerToken, delayMs);
    void updateBadge();
  }

  /**
   * 执行一轮刷新并安排下一轮。设计依据 docs/05 §3.1
   * 顺序：校验 tab → 刷新 → 成功才 count++ → 上限判定 → 计算下一轮 → ARM
   *
   * 关键语义（docs/05 §7.2）：**失败的一轮不计入次数**。
   * 否则会出现"计数在涨但其实一次都没点"的误导（用户实测踩到过）。
   */
  async function executeRound(tabId: number): Promise<void> {
    await ensureReady();
    const s = sessions.get(tabId);
    if (!s) return;

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      await stop(tabId);
      return;
    }

    const outcome = await runRefresh(tabId, {
      refreshType: options.refreshType,
      hardRefresh: options.hardRefresh,
      redirection: options.redirection,
      autoClickSelector: options.autoClickSelector,
      canonicalUrl: s.canonicalUrl,
      keepActive: options.keepActive,
      ensureKeepActive,
    });

    if (!outcome.ok) {
      // 页面/标签页已不可用：直接收摊，没有继续的意义
      if (outcome.reason === 'tab_gone') {
        await stop(tabId);
        return;
      }
      s.lastError = outcome.reason;
      s.failedRounds = (s.failedRounds ?? 0) + 1;
      await persist();
      await updateBadge();
      // 不计次数，但仍按间隔继续重试（用户可选改选择器后自愈）
      confirmStarted(s, nextDelayMs(options, s.prevDelayMs));
      return;
    }

    delete s.lastError;
    delete s.failedRounds;

    // follow 模式：每轮把当前 URL 记为下一次的基准；canonical 模式不改写（docs/05 §4）
    if (options.redirection === 'follow' && tab.url) s.tabUrl = tab.url;

    s.count += 1;

    if (reachedLimit(options, s.count)) {
      sessions.delete(tabId);
      await persist();
      await disarmTimer(tabId);
      await clearBadge(tabId);
      await clearKeepActive(tabId);
      await setAutoDiscardable(tabId, true);
      return;
    }

    confirmStarted(s, nextDelayMs(options, s.prevDelayMs));
  }

  // ────────────────────────────────────────────────────────────── 交互

  async function onInteraction(tabId: number, isInput: boolean): Promise<void> {
    await ensureReady();
    const s = sessions.get(tabId);
    if (!s || !acceptsInteraction(s.status)) return;

    const decision = decideInteraction(options, isInput);
    if (!decision) return;

    switch (decision.action) {
      case 'pause':
        await pause(tabId);
        return;
      case 'restart': {
        s.status = 'wait';
        s.waitReason = 'interaction';
        s.delayMs = Math.max(0, decision.waitSeconds) * 1000;
        s.armedAt = Date.now();
        s.timerToken = token();
        await persist();
        await armTimer(tabId, s.timerToken, s.delayMs);
        await updateBadge();
        return;
      }
      case 'stop':
      default:
        await stop(tabId);
        return;
    }
  }

  // ────────────────────────────────────────────────────────────── 定时器回调

  async function onTick(tabId: number, tickToken: string): Promise<void> {
    await ensureReady();
    const s = sessions.get(tabId);
    if (!s) return;
    // token 校验：过期 tick 直接丢弃（docs/05 §1.2 守卫 1）
    if (s.timerToken !== tickToken) return;

    if (s.status === 'wait') {
      // 交互 restart 的等待结束 ⇒ 回到 start 并立即刷新
      s.status = 'start';
      delete s.waitReason;
      await executeRound(tabId);
      return;
    }
    if (s.status === 'start') await executeRound(tabId);
  }

  /** alarms 兜底：发现"早就该 tick 了却没有"的会话，直接执行（docs/05 §1.2 守卫 3） */
  async function watchdog(): Promise<void> {
    await ensureReady();
    if (sessions.size > 0) await pingOffscreen().catch(() => false);

    for (const [tabId, s] of [...sessions]) {
      if (s.status !== 'start' && s.status !== 'wait') continue;
      if (Date.now() - (s.armedAt + s.delayMs) < TICK_LATE_TOLERANCE_MS) continue;

      if (s.status === 'wait') {
        s.status = 'start';
        delete s.waitReason;
      }
      await executeRound(tabId);
    }
  }

  // ────────────────────────────────────────────────────────────── 路由

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // offscreen → SW
    if (msg?.type === 'TICK_DONE') {
      const evt = msg as TimerEvent & { type: 'TICK_DONE' };
      void onTick(evt.tabId, evt.token);
      sendResponse({ ok: true });
      return false;
    }

    // content → SW
    if (msg?.type === 'INTERACTION') {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) void onInteraction(tabId, (msg as ContentEvent & { isInput: boolean }).isInput);
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'CONTENT_READY') {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        void (async () => {
          const s = sessions.get(tabId);
          if (s && options?.keepActive) await ensureKeepActive(tabId);
          if (s) await broadcastInteraction(options?.interactions ?? false, tabId);
        })();
      }
      sendResponse({ ok: true });
      return false;
    }

    // popup → SW
    if (msg?.type === 'GET_STATE') {
      void (async () => {
        await ensureReady();
        const tabId = (msg as PopupCommand & { tabId: number }).tabId;
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        const snapshot: StateSnapshot = {
          options,
          session: sessions.get(tabId) ?? null,
          tabUrl: tab?.url ?? '',
        };
        sendResponse(snapshot);
      })();
      return true;
    }

    if (msg?.type === 'START') {
      void (async () => {
        const res = await start((msg as PopupCommand & { tabId: number }).tabId);
        sendResponse(res);
      })();
      return true;
    }
    if (msg?.type === 'STOP') {
      void (async () => sendResponse(await stop((msg as PopupCommand & { tabId: number }).tabId)))();
      return true;
    }
    if (msg?.type === 'PAUSE') {
      void (async () => sendResponse(await pause((msg as PopupCommand & { tabId: number }).tabId)))();
      return true;
    }
    if (msg?.type === 'RESUME') {
      void (async () => sendResponse(await resume((msg as PopupCommand & { tabId: number }).tabId)))();
      return true;
    }
    if (msg?.type === 'TEST_SELECTOR') {
      void (async () => {
        const m = msg as PopupCommand & { tabId: number; selector: string };
        sendResponse(await probeSelector(m.tabId, m.selector));
      })();
      return true;
    }
    if (msg?.type === 'OPTIONS_PATCH') {
      void (async () => {
        await ensureReady();
        const patch = (msg as PopupCommand & { patch: Partial<Options> }).patch;
        const result = applyPatch(options, patch);
        if (!result.ok) {
          sendResponse({ ok: false, issues: result.issues });
          return;
        }
        options = result.options;
        await setOptions(options);
        // 开关改动即时生效：keep-active / interactions 需要同步到内容脚本
        if (patch.keepActive !== undefined || patch.interactions !== undefined) {
          for (const tabId of sessions.keys()) {
            if (options.keepActive) await ensureKeepActive(tabId);
            else await clearKeepActive(tabId);
          }
          await broadcastInteraction(options.interactions);
        }
        sendResponse({ ok: true, options });
      })();
      return true;
    }

    return false;
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_WATCHDOG) void watchdog();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (!sessions.has(tabId)) return;
    sessions.delete(tabId);
    void persist();
    void disarmTimer(tabId);
  });

  // 全局配置变化（包括 popup 之外的写入）⇒ 刷新内存快照
  watchOptions((next) => {
    options = next;
  });

  chrome.runtime.onInstalled.addListener(() => void ensureReady());
  chrome.runtime.onStartup.addListener(() => void ensureReady());
  void ensureReady();
});
