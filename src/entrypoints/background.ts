import { isInputHoldMode } from '@/lib/interaction';
import { intervalSignature, needsRearm, nextDelayMs } from '@/lib/interval';
import {
  clearKeepActive,
  ensureKeepActive,
  setAutoDiscardable,
} from '@/lib/keep-active-runtime';
import type { ContentCommand, ContentEvent, ErrorCode, PopupCommand, StateSnapshot, TimerCommand, TimerEvent } from '@/lib/messages';
import { armTimer, disarmTimer, ensureOffscreen, pingOffscreen, stopBadgeWatch, watchBadge } from '@/lib/offscreen-client';
import { badgeAppearance, BADGE_COLORS } from '@/lib/badge';
import { DEFAULT_CLICK_ACTION, DEFAULT_OPTIONS, type ClickAction, type Options } from '@/lib/options';
import {
  getSelectorForUrl,
  pageKeyOf,
  setActionForUrl,
  setSelectorForUrl,
} from '@/lib/page-selectors';
import { probeSelector, runRefresh, sendToContent } from '@/lib/refresh';
import { createSession, type Session } from '@/lib/session';
import { acceptsInteraction, canPause, canResume } from '@/lib/session-machine';
import { loadSessions, saveSessions } from '@/lib/session-store';
import { dropLegacyGlobalOptions, getOptionsForPage, setOptionsForPage, watchPageOptions } from '@/lib/page-options';
import { reachedLimit, isRefreshableUrl } from '@/lib/url';
import { applyPatch } from '@/lib/validate';

export default defineBackground(() => {
  // ────────────────────────────────────────────────────────────── 状态

  const sessions = new Map<number, Session>();
  /**
   * 当前标签页那一份配置（ADR-037）。
   *
   * SW 里不再有"全局 options"这回事 —— 所有配置都按页面（pageKey）存。
   * 这个变量只作**缓存**，值 = 「最近一次 GET_STATE / OPTIONS_PATCH / 会话启动时
   * 那个 activeTab 对应的页面配置」，用于 START 等没有显式带上 pageKey 的路径。
   */
  let options: Options = { ...DEFAULT_OPTIONS };
  let ready: Promise<void> | null = null;

  /** 会话锁定页面的配置（ADR-037：整轮刷新都用**启动时那一页**的配置）。 */
  const tabConfigs = new Map<number, Options>();

  /** 取某标签页对应页面的配置（有缓存就用缓存，没有就按 tab.url 读/建） */
  async function configForTab(tabId: number): Promise<Options> {
    const cached = tabConfigs.get(tabId);
    if (cached) return cached;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const key = pageKeyOf(tab?.url ?? null);
    const cfg = await getOptionsForPage(key);
    tabConfigs.set(tabId, cfg);
    return cfg;
  }

  /** 取某页面 key 的配置（每轮刷新用：会话锁定了 pageKey，不再看 tab.url） */
  async function configForPageKey(pageKey: string): Promise<Options> {
    const cfg = await getOptionsForPage(pageKey || null);
    return cfg;
  }

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
      /*
       * ADR-037：配置按页面存，不再有一次"全局读取"。
       * 顺手删掉 ADR-037 之前的全局 `options` 键 —— 用户已确认迁移时**不继承**旧全局配置，
       * 留着只会让人误以为还有全局配置。
       */
      await dropLegacyGlobalOptions();
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

  /**
   * 面板里改触发方式（ADR-035）。
   *
   * **不需要已有 selector**：单击/双击是与 selector 平行的独立偏好，
   * 用户完全可以先定好触发方式、再去拾取元素。之前这里在没有 selector 时直接
   * `return { ok: true }` 而不写库，导致面板点了"双击"看起来完全没反应。
   *
   * 拾取元素时 `applyPickerResult` 会读到这里的 action 一并写入，两者不冲突。
   */
  async function setClickActionForTab(
    tabId: number,
    action: ClickAction,
  ): Promise<{ ok: boolean; code?: ErrorCode }> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const key = pageKeyOf(tab?.url);
    if (!tab || !key) return { ok: false, code: 'err_page_unavailable' };
    await setActionForUrl(tab.url, action);
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

    // ADR-037：用**这个标签页那一页**的配置（不是全局的，也不是别的页面的）
    const cfg = await configForTab(tabId);
    options = cfg; // 同步缓存，供后续无 pageKey 的路径读

    const firstDelay = nextDelayMs(cfg);
    const s = createSession(tabId, tab.url!, firstDelay, token());
    // ADR-036：记下这一轮依据的间隔配置指纹，后续改配置时用它判断要不要重置倒计时
    s.intervalSig = intervalSignature(cfg);
    sessions.set(tabId, s);

    await setAutoDiscardable(tabId, false);
    if (cfg.keepActive) await ensureKeepActive(tabId);
    await broadcastInputHold(isInputHoldMode(cfg), tabId);
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

  /**
   * 用户手动暂停（ADR-034）。
   *
   * 关键：**记住剩余时间**。用户点暂停时，本轮已经数到哪就存进 `pausedRemainMs`，
   * 点继续时从那个位置接着数（而不是重新计一整轮、也不是立刻刷新）。
   *
   * 同时清掉 `input-hold` 标记 —— 手动暂停不该被"输入框占用解除"自动恢复。
   */
  async function pause(tabId: number): Promise<{ ok: true }> {
    const s = sessions.get(tabId);
    if (s && canPause(s.status)) {
      s.status = 'pause';
      // 记住还剩多少（数掉的部分不还给用户，按"停在哪里就从哪里接着"）
      s.pausedRemainMs = Math.max(0, s.armedAt + s.delayMs - Date.now());
      delete s.waitReason;
      await persist();
      await disarmTimer(tabId);
      await updateBadge();
    }
    return { ok: true };
  }

  /**
   * 用户手动继续（ADR-034）。
   *
   * 从 `pausedRemainMs` 接着数：**不立即刷新**，等剩下的那几秒走完才刷新。
   * 与 `hold-input` 的自动恢复不同 —— 后者按 ADR-032 是"重新计一整轮"
   * （因为用户刚离开输入框，立刻刷新观感差）。
   */
  async function resume(tabId: number): Promise<{ ok: true }> {
    const s = sessions.get(tabId);
    if (s && canResume(s.status)) {
      const cfg = cfgOf(s);
      const remain = s.pausedRemainMs;
      delete s.pausedRemainMs;

      // ADR-036：暂停期间用户改了间隔配置 ⇒ 旧的剩余时间已经无意义，按新配置重新计一轮。
      // 这种情况**不立即刷新**（用户刚点继续，期望的是看到倒计时）。
      const sigChanged = s.intervalSig !== intervalSignature(cfg);

      if (sigChanged) {
        confirmStarted(s, nextDelayMs(cfg, s.prevDelayMs));
      } else if (remain !== undefined && remain > 0) {
        // 接着数：把 armedAt 往回挪，使 "armedAt + delayMs - now === remain"
        s.status = 'start';
        delete s.waitReason;
        s.armedAt = Date.now() - (s.delayMs - remain);
        s.intervalSig = intervalSignature(cfg);
        s.timerToken = token();
        await persist();
        await armTimer(tabId, s.timerToken, remain);
        await updateBadge();
      } else {
        // 没有剩余记录（旧存档 / 剩余刚好为 0）：按新一轮走，并立即刷新
        confirmStarted(s, nextDelayMs(cfg, s.prevDelayMs));
        await executeRound(tabId);
      }
    }
    return { ok: true };
  }

  /**
   * 某会话**自己那一页**的配置（ADR-037）。
   *
   * 所有和间隔有关的计算都用它，绝不用 `options`（那个只是"最近一次活跃页面"的缓存）——
   * 否则 A 页正在跑的会话会被 B 页的配置带偏。
   */
  function cfgOf(s: Session): Options {
    return tabConfigs.get(s.tabId) ?? options;
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
    s.intervalSig = intervalSignature(cfgOf(s));
    s.timerToken = token();
    void persist();
    void armTimer(s.tabId, s.timerToken, delayMs);
    void updateBadge();
  }

  /**
   * 间隔配置变了 ⇒ 放弃当前倒计时、按新配置重新计时（ADR-036）。
   *
   * 用户要求：改了刷新间隔后要**立即应用**，而不是等正在进行的倒计时结束。
   * 固定档与随机档都要这样（随机档会重新抽一个新值）。
   *
   * ADR-037 补充：配置是按页面存的，所以**只有该页面的会话**会被重置
   * （`tabConfigs` 里对应 tab 的缓存已经是新配置，`cfgOf` 自然读到新值）。
   *
   * 只处理**正在倒计时**的会话：
   *   - `pause`：用户手动暂停了，倒计时本就停着，不该因为他改了配置就自己跑起来
   *     也不动它的指纹 —— `resume()` 要靠新旧指纹差异判断"暂停期间配置改了没有"
   *   - `wait`：ADR-032 之后已不再产生的旧状态，保守忽略
   */
  async function rearmSessionsForIntervalChange(pageKey: string): Promise<void> {
    for (const s of [...sessions.values()]) {
      if (s.pageKey !== pageKey) continue; // 只动这一页的会话
      const cfg = cfgOf(s);
      if (!needsRearm(s.status, s.intervalSig, intervalSignature(cfg))) continue;
      // 重新抽/重算下一轮间隔，然后从现在开始重新计时
      confirmStarted(s, nextDelayMs(cfg, s.prevDelayMs));
    }
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

    // ADR-037：整轮刷新都用**会话锁定那一页**的配置（锁定值见 createSession 的 pageKey）。
    // 即使 follow 模式页面自己跳走了，也不会突然改用新页面的配置。
    const cfg = await configForPageKey(s.pageKey);
    tabConfigs.set(tabId, cfg);
    options = cfg;

    // ADR-022：XHR 的 selector / 触发方式按页面隔离，且**锁定会话启动时的页面**。
    // 用 s.pageKey（而不是当前 tab.url）⇒ follow 模式下页面自己跳走了也不会改去点新页面。
    const pageEntry = s.pageKey ? await getSelectorForUrl(s.pageKey) : null;

    const outcome = await runRefresh(tabId, {
      refreshType: cfg.refreshType,
      hardRefresh: cfg.hardRefresh,
      redirection: cfg.redirection,
      autoClickSelector: pageEntry?.selector ?? '',
      autoClickAction: pageEntry?.action ?? DEFAULT_CLICK_ACTION,
      canonicalUrl: s.canonicalUrl,
      keepActive: cfg.keepActive,
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
      confirmStarted(s, nextDelayMs(cfg, s.prevDelayMs));
      return;
    }

    delete s.lastError;
    delete s.failedRounds;

    // follow 模式：每轮把当前 URL 记为下一次的基准；canonical 模式不改写（docs/05 §4）
    if (cfg.redirection === 'follow' && tab.url) s.tabUrl = tab.url;

    s.count += 1;

    if (reachedLimit(cfg, s.count)) {
      sessions.delete(tabId);
      await persist();
      await disarmTimer(tabId);
      await clearBadge(tabId);
      await clearKeepActive(tabId);
      await setAutoDiscardable(tabId, true);
      return;
    }

    confirmStarted(s, nextDelayMs(cfg, s.prevDelayMs));
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
      const cfg = cfgOf(s);
      confirmStarted(s, nextDelayMs(cfg, s.prevDelayMs));
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
          if (!s) return;
          const cfg = cfgOf(s);
          if (cfg.keepActive) await ensureKeepActive(tabId);
          await broadcastInputHold(isInputHoldMode(cfg), tabId);
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
        // ADR-037：面板看到的是**当前这个标签页那一页**的配置，不是全局的
        const cfg = await getOptionsForPage(currentKey);
        tabConfigs.set(tabId, cfg);
        options = cfg;
        const snapshot: StateSnapshot = {
          options: cfg,
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
        const m = msg as PopupCommand & { patch: Partial<Options>; tabId?: number };
        const patch = m.patch;

        /*
         * ADR-037：配置按页面存，所以 patch 必须落到**某个页面的 key** 上。
         * 优先用消息里带的 tabId（popup 一定会带）；缺省时退回"最近活跃那页"的缓存键。
         */
        let pageKey: string | null = null;
        if (typeof m.tabId === 'number') {
          const tab = await chrome.tabs.get(m.tabId).catch(() => null);
          pageKey = pageKeyOf(tab?.url);
        }
        if (!pageKey) {
          sendResponse({ ok: false, issues: [{ field: 'schemaVersion', code: 'err_page_unavailable' }] });
          return;
        }

        // 基于**这一页**当前配置做校验与合并（不是全局，也不是别的页面）
        const current = await getOptionsForPage(pageKey);
        const result = applyPatch(current, patch);
        if (!result.ok) {
          sendResponse({ ok: false, issues: result.issues });
          return;
        }

        await setOptionsForPage(pageKey, result.options);
        if (typeof m.tabId === 'number') tabConfigs.set(m.tabId, result.options);
        options = result.options;

        // 间隔配置变了 ⇒ 该页面上正在跑的会话放弃倒计时、立即按新配置重新计时（ADR-036）
        await rearmSessionsForIntervalChange(pageKey);

        // 开关改动即时生效：keep-active / 输入框占用监视 需要同步到内容脚本
        if (patch.keepActive !== undefined || patch.interactionMode !== undefined) {
          for (const [tabId, s] of sessions) {
            if (s.pageKey !== pageKey) continue; // 只影响这一页的会话
            const cfg = cfgOf(s);
            if (cfg.keepActive) await ensureKeepActive(tabId);
            else await clearKeepActive(tabId);
            await broadcastInputHold(isInputHoldMode(cfg), tabId);
          }
        }
        sendResponse({ ok: true, options: result.options });
      })();
      return true;
    }

    return false;
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_WATCHDOG) void watchdog();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    // ADR-037：会话缓存与配置缓存一起清，避免 tabId 被复用后读到上一任标签页的配置
    tabConfigs.delete(tabId);
    if (!sessions.has(tabId)) return;
    sessions.delete(tabId);
    void persist();
    void disarmTimer(tabId);
  });

  /*
   * ADR-037：没有"全局配置变化"这回事了（配置按页面存）。
   * 这里保留 per-page 表的监听，只用于把**当前活跃标签页**那份配置刷进缓存 ——
   * 这样即使用户在别处（比如另一个面板实例）改了这一页的配置，SW 的缓存也不会过期。
   */
  watchPageOptions(() => {
    void (async () => {
      for (const [tabId, s] of [...sessions]) {
        const fresh = await getOptionsForPage(s.pageKey);
        tabConfigs.set(tabId, fresh);
      }
    })();
  });

  chrome.runtime.onInstalled.addListener(() => void ensureReady());
  chrome.runtime.onStartup.addListener(() => void ensureReady());
  void ensureReady();
});
