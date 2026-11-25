import { isInputHoldMode } from '@/lib/interaction';
import { nextDelayMs } from '@/lib/interval';
import {
  clearKeepActive,
  ensureKeepActive,
  setAutoDiscardable,
} from '@/lib/keep-active-runtime';
import type { ContentCommand, ContentEvent, ErrorCode, PopupCommand, StateSnapshot, TimerCommand, TimerEvent } from '@/lib/messages';
import { armTimer, disarmTimer, ensureOffscreen, pingOffscreen, stopBadgeWatch, watchBadge } from '@/lib/offscreen-client';
import { badgeAppearance, BADGE_COLORS } from '@/lib/badge';
import { DEFAULT_CLICK_ACTION, type ClickAction, type Options } from '@/lib/options';
import {
  getSelectorForUrl,
  pageKeyOf,
  setSelectorForUrl,
} from '@/lib/page-selectors';
import { probeSelector, runRefresh, sendToContent } from '@/lib/refresh';
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

  /**
   * 告诉内容脚本是否需要监视输入框占用（ADR-032）。
   *
   * `enabled = interactionMode === 'hold-input'`：`stable` 档完全不关心输入框状态，
   * 让内容脚本关掉监视可以省掉它每秒的轮询开销。
   */
  async function broadcastInputHold(enabled: boolean, tabId?: number): Promise<void> {
    const targets = tabId !== undefined ? [tabId] : [...sessions.keys()];
    await Promise.all(
      targets.map(async (id) => {
        try {
          await chrome.tabs.sendMessage(id, { type: 'SET_INPUT_HOLD', enabled });
        } catch {
          /* 内容脚本未注入时忽略 */
        }
      }),
    );
  }

  /**
   * 刷新徽章（ADR-031）。
   *
   * 语义：运行/等待中显示**倒计时**（`>=60s` 时 `{n}m`，否则秒数），暂停 `II`、失败 `!`。
   * 每秒的跳动交给 offscreen 做（`watchBadge`），SW 自己只在状态切换时画一次。
   */
  async function updateBadge(): Promise<void> {
    for (const [tabId, s] of sessions) {
      const { text, color } = badgeAppearance(s ?? null);
      try {
        await chrome.action.setBadgeText({ text, tabId });
        await chrome.action.setBadgeBackgroundColor({ color, tabId });
      } catch {
        /* 标签页已关闭等：忽略 */
      }
      if (s.status === 'start' || s.status === 'wait') {
        // 交给 offscreen 每秒刷新；短于 1s 的间隔由 watchBadge 内部跳过
        void watchBadge(tabId, s.armedAt + s.delayMs, s.delayMs);
      } else {
        void stopBadgeWatch(tabId);
      }
    }
  }

  async function clearBadge(tabId: number): Promise<void> {
    void stopBadgeWatch(tabId);
    try {
      await chrome.action.setBadgeText({ text: '', tabId });
    } catch {
      /* 忽略 */
    }
  }

  // ────────────────────────────────────────────────────────────── 元素拾取器

  /** 当前正在拾取的标签页（同一时刻只允许一个，避免用户在两个标签页都进入拾取态） */
  let pickerTabId: number | null = null;

  async function startPicker(tabId: number): Promise<{ ok: boolean; code?: ErrorCode }> {
    await ensureReady();
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !isRefreshableUrl(tab.url)) return { ok: false, code: 'err_page_unavailable' };

    // 先撤掉别的标签页上残留的拾取器（用户可能在切换标签页后重新点按钮）
    if (pickerTabId !== null && pickerTabId !== tabId) await stopPicker(pickerTabId);

    const res = await sendToContent<{ ok: boolean }>(tabId, { type: 'PICKER_START' });
    if (!res?.ok) return { ok: false, code: 'err_page_unavailable' };

    pickerTabId = tabId;
    // 让用户知道"现在处于拾取态"：徽章显示十字/放大镜语义的字符。
    // 拾取期间暂停每秒倒计时刷新，否则 offscreen 会把 ⊕ 覆盖成秒数（ADR-031）
    void stopBadgeWatch(tabId);
    try {
      await chrome.action.setBadgeText({ text: '⊕', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.picking, tabId });
    } catch {
      /* 忽略 */
    }
    return { ok: true };
  }

  async function stopPicker(tabId: number): Promise<void> {
    await sendToContent<{ ok: boolean }>(tabId, { type: 'PICKER_STOP' });
    if (pickerTabId === tabId) pickerTabId = null;
    // 恢复该标签页原本的徽章状态（运行中 ● / 暂停 II / 失败 ! / 清空）
    await restoreBadge(tabId);
  }

  /**
   * 拾取完成后：**写入该标签页当前 URL 对应的记录** + 尽力把面板重新打开。
   *
   * ADR-022：selector 按页面隔离。这里用"拾取所在的标签页 URL"作为 key，
   * 而不是 options 里的某个全局字段 —— 这样在 B 页选元素不会影响 A 页正在跑的会话。
   */
  async function applyPickerResult(selector: string): Promise<void> {
    await ensureReady();
    const pickedTabId = pickerTabId;
    pickerTabId = null;

    if (pickedTabId !== null) {
      const tab = await chrome.tabs.get(pickedTabId).catch(() => null);
      if (tab?.url) {
        // 触发方式沿用该页面已有的设置（新页面默认 single）；
        // 用户在面板里改触发方式时也会走同一个 setSelectorForUrl，因此这里不必额外判断
        const existing = await getSelectorForUrl(tab.url);
        await setSelectorForUrl(tab.url, selector, existing?.action ?? DEFAULT_CLICK_ACTION);
      }
      await restoreBadge(pickedTabId, '✓');
    }
    await reopenPopup();
  }

  /** 面板里改 selector（手输 / 清空）：同样写当前页面 */
  async function setSelectorForTab(tabId: number, selector: string): Promise<{ ok: boolean; code?: ErrorCode }> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const key = pageKeyOf(tab?.url);
    if (!tab || !key) return { ok: false, code: 'err_page_unavailable' };
    const existing = await getSelectorForUrl(tab.url);
    const next = await setSelectorForUrl(tab.url, selector, existing?.action ?? DEFAULT_CLICK_ACTION);
    // 广播给 popup 刷新回显（storage.onChanged 也会触发，这里显式返回让调用方可立即反应）
    return next ? { ok: true } : { ok: true };
  }

  /** 面板里改触发方式：只改当前页面那条记录的 action，selector 为空时不建记录 */
  async function setClickActionForTab(
    tabId: number,
    action: ClickAction,
  ): Promise<{ ok: boolean; code?: ErrorCode }> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const key = pageKeyOf(tab?.url);
    if (!tab || !key) return { ok: false, code: 'err_page_unavailable' };
    const existing = await getSelectorForUrl(tab.url);
    if (!existing) {
      // 还没有 selector：不建空壳记录，用户的点击方式等拾取到 selector 时一并写入
      return { ok: true };
    }
    await setSelectorForUrl(tab.url, existing.selector, action);
    return { ok: true };
  }

  /**
   * 尽量把 popup 重新打开。
   *
   * 为什么需要：用户去页面点元素时 popup 一定已经被关闭（点面板外部即关闭，
   * 这是浏览器行为，无法阻止）。`chrome.action.openPopup` 自 Chrome 127 起对所有扩展开放，
   * 但要求调用处在用户手势的调用链内 —— 拾取结果的回调正好符合。
   * 失败时静默（用户已能在页内卡片上看到结果，徽章也有反馈）。
   */
  async function reopenPopup(): Promise<void> {
    try {
      await chrome.action.openPopup();
    } catch {
      /* 无手势上下文 / 被策略拦截：靠页内卡片与徽章兜底 */
    }
  }

  /** 按会话状态重设徽章；`flash` 给一个临时字符（拾取成功的 ✓） */
  async function restoreBadge(tabId: number, flash?: string): Promise<void> {
    const s = sessions.get(tabId);
    const set = async (text: string, color: string) => {
      try {
        await chrome.action.setBadgeText({ text, tabId });
        await chrome.action.setBadgeBackgroundColor({ color, tabId });
      } catch {
        /* 忽略 */
      }
    };

    if (flash) {
      await set(flash, BADGE_COLORS.running);
      await sleep(1200);
    }

    // ADR-031：与 updateBadge 同口径 —— 运行中显示倒计时，暂停 II，失败 !，无会话清空
    const { text, color } = badgeAppearance(s ?? null);
    await set(text, color);
    if (s && (s.status === 'start' || s.status === 'wait')) {
      void watchBadge(tabId, s.armedAt + s.delayMs, s.delayMs);
    } else {
      void stopBadgeWatch(tabId);
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
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
    await broadcastInputHold(isInputHoldMode(options), tabId);
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
    await broadcastInputHold(false, tabId);
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
    // 必须清掉 paused/wait 的原因，否则会话已恢复运行却还挂着 `input-hold` 标记，
    // 下次占用进入时 `s.status === 'pause'` 判断会走错分支（ADR-032）。
    delete s.waitReason;
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

    // ADR-022：XHR 的 selector / 触发方式按页面隔离，且**锁定会话启动时的页面**。
    // 用 s.pageKey（而不是当前 tab.url）⇒ follow 模式下页面自己跳走了也不会改去点新页面。
    const pageEntry = s.pageKey ? await getSelectorForUrl(s.pageKey) : null;

    const outcome = await runRefresh(tabId, {
      refreshType: options.refreshType,
      hardRefresh: options.hardRefresh,
      redirection: options.redirection,
      autoClickSelector: pageEntry?.selector ?? '',
      autoClickAction: pageEntry?.action ?? DEFAULT_CLICK_ACTION,
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

  /**
   * 输入框占用状态变化（ADR-032）。
   *
   * 语义是**持续状态**而不是一次性事件：
   *   held=true  ⇒ 暂停倒计时（不刷新、不推进），保留 count 与已过时间
   *   held=false ⇒ 从当前时刻**重新开始**一轮完整间隔
   *
   * 为什么解除后重新计时而不是恢复剩余时间：
   *   用户要的是"解除占用后恢复自动倒计时刷新"。若只补剩余 2 秒就刷新，
   *   用户刚离开输入框、页面还没稳定就刷新，观感是"刚打字完就被刷新"。
   *   重新计一整轮更符合"恢复正常的自动刷新节奏"。
   *
   * 只在 `hold-input` 档生效；`stable` 档 SW 根本不会收到 `INPUT_HOLD`
   * （内容脚本的监视器按档位开关）。
   */
  async function onInputHold(tabId: number, held: boolean): Promise<void> {
    await ensureReady();
    const s = sessions.get(tabId);
    if (!s) return;

    if (held) {
      /* 进入占用：暂停倒计时。已 pause（用户手动暂停）就不要覆盖其状态 */
      if (s.status === 'pause') return;
      s.status = 'pause';
      s.waitReason = 'input-hold';
      s.prevDelayMs = s.delayMs;
      await persist();
      await disarmTimer(tabId);
      await updateBadge();
      return;
    }

    /* 占用解除：只有"因占用而暂停"的会话才恢复；手动暂停的保持暂停 */
    if (s.status === 'pause' && s.waitReason === 'input-hold') {
      confirmStarted(s, nextDelayMs(options, s.prevDelayMs));
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
    // offscreen 每秒一次：重画该标签页的徽章倒计时（ADR-031）
    if (msg?.type === 'BADGE_TICK') {
      const evt = msg as TimerEvent & { type: 'BADGE_TICK' };
      const s = sessions.get(evt.tabId);
      if (s) {
        const { text, color } = badgeAppearance(s);
        void chrome.action
          .setBadgeText({ text, tabId: evt.tabId })
          .catch(() => undefined);
        void chrome.action
          .setBadgeBackgroundColor({ color, tabId: evt.tabId })
          .catch(() => undefined);
      }
      sendResponse({ ok: true });
      return false;
    }

    // content → SW
    if (msg?.type === 'INPUT_HOLD') {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) void onInputHold(tabId, (msg as ContentEvent & { held: boolean }).held);
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'CONTENT_READY') {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        void (async () => {
          const s = sessions.get(tabId);
          if (s && options?.keepActive) await ensureKeepActive(tabId);
          if (s) await broadcastInputHold(isInputHoldMode(options), tabId);
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
        const s = sessions.get(tabId) ?? null;
        const currentKey = pageKeyOf(tab?.url);
        const snapshot: StateSnapshot = {
          options,
          session: s,
          tabUrl: tab?.url ?? '',
          // ADR-022：当前页面的 per-page 配置（没有就 null，不回落）
          pageSelector: currentKey ? await getSelectorForUrl(currentKey) : null,
          pageKey: currentKey,
          // 会话锁定的是启动时那个页面；与当前页面不同时面板要给提示
          sessionPageKey: s?.pageKey || null,
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

    // ── 元素拾取器（ADR-018）────────────────────────────────────
    if (msg?.type === 'PICKER_START') {
      void (async () => {
        const tabId = (msg as PopupCommand & { tabId: number }).tabId;
        const started = await startPicker(tabId);
        sendResponse(started);
      })();
      return true;
    }
    if (msg?.type === 'PICKER_STOP') {
      void (async () => {
        const tabId = (msg as PopupCommand & { tabId: number }).tabId;
        await stopPicker(tabId);
        sendResponse({ ok: true });
      })();
      return true;
    }
    // 拾取结果：落库 + 尽力把面板重新打开（popup 被点页面时必然已关闭）
    if (msg?.type === 'PICKER_RESULT') {
      const evt = msg as ContentEvent & { type: 'PICKER_RESULT'; selector: string };
      void (async () => {
        await applyPickerResult(evt.selector);
      })();
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'PICKER_CANCELLED') {
      const reason = (msg as ContentEvent & { reason?: string }).reason;
      void (async () => {
        const tabId = pickerTabId;
        pickerTabId = null;
        if (tabId !== null) await restoreBadge(tabId);
        // 页面导航走时不要再抢开面板：用户已经在别处了
        if (reason !== 'navigated') await reopenPopup();
      })();
      sendResponse({ ok: true });
      return false;
    }
    // ── per-page selector（ADR-022）─────────────────────────────
    if (msg?.type === 'SELECTOR_SET') {
      void (async () => {
        const m = msg as PopupCommand & { tabId: number; selector: string };
        sendResponse(await setSelectorForTab(m.tabId, m.selector));
      })();
      return true;
    }
    if (msg?.type === 'CLICK_ACTION_SET') {
      void (async () => {
        const m = msg as PopupCommand & { tabId: number; action: ClickAction };
        sendResponse(await setClickActionForTab(m.tabId, m.action));
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
        // 开关改动即时生效：keep-active / 输入框占用监视 需要同步到内容脚本
        if (patch.keepActive !== undefined || patch.interactionMode !== undefined) {
          for (const tabId of sessions.keys()) {
            if (options.keepActive) await ensureKeepActive(tabId);
            else await clearKeepActive(tabId);
          }
          await broadcastInputHold(isInputHoldMode(options));
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
