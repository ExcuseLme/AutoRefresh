import type { ClickAction, Options } from './options';

/** popup → SW */
export type PopupCommand =
  | { type: 'START'; tabId: number }
  | { type: 'STOP'; tabId: number }
  | { type: 'PAUSE'; tabId: number }
  | { type: 'RESUME'; tabId: number }
  | { type: 'OPTIONS_PATCH'; patch: Partial<Options> }
  | { type: 'GET_STATE'; tabId: number }
  | { type: 'TEST_SELECTOR'; tabId: number; selector: string }
  /** 进入元素拾取模式（ADR-018） */
  | { type: 'PICKER_START'; tabId: number }
  /** 取消元素拾取模式 */
  | { type: 'PICKER_STOP'; tabId: number }
  /** 改当前页面的 selector（ADR-022：按 URL 隔离，不写全局） */
  | { type: 'SELECTOR_SET'; tabId: number; selector: string }
  /** 改当前页面的触发方式（ADR-022） */
  | { type: 'CLICK_ACTION_SET'; tabId: number; action: ClickAction };

/** SW → offscreen */
export type TimerCommand =
  | { type: 'ARM'; tabId: number; token: string; delayMs: number }
  | { type: 'DISARM'; tabId?: number; token?: string }
  | { type: 'PING' }
  /**
   * 让 offscreen 每秒刷新该标签页的徽章倒计时（ADR-031）。
   *
   * 为什么由 offscreen 而不是 SW 来做：SW 空闲约 30s 就被回收，想每秒唤醒它代价太大
   * （会持续阻止它休眠）。offscreen 文档在计时期间本来就是活的，它有 `chrome.action`
   * 权限，直接写徽章即可，SW 全程可以睡着。
   */
  | { type: 'BADGE_WATCH'; tabId: number; dueAt: number }
  | { type: 'BADGE_UNWATCH'; tabId?: number };

/** offscreen → SW */
export type TimerEvent =
  | { type: 'TICK_DONE'; tabId: number; token: string }
  /** offscreen 每秒发一次，请求 SW 重画该标签页的徽章倒计时（ADR-031） */
  | { type: 'BADGE_TICK'; tabId: number }
  | { type: 'PONG' };

/** 内容脚本对选择器探测的回复（TEST_SELECTOR 用） */
export type SelectorProbe =
  | { result: 'ok'; count: number; preview: string }
  | { result: 'not-found'; count: 0 }
  | { result: 'invalid' };

/** 拾取器的实时回显（用户在页面上移动鼠标时） */
export type PickerPreview = {
  selector: string;
  /** 命中的层级，用于卡片上标注（semantic / path / …） */
  tier: string;
  /** 是否推荐（较长路径会提示"可能失效"） */
  long: boolean;
  /** 元素摘要，如 `<div> “刷新”` */
  preview: string;
  /** 该元素在 Shadow DOM 内（不支持） */
  shadow: boolean;
};

/** SW → content script（走 chrome.tabs.sendMessage） */
export type ContentCommand =
  | { type: 'AUTOCLICK'; selector: string; action: ClickAction }
  | { type: 'TEST_SELECTOR'; selector: string }
  | { type: 'PICKER_START' }
  | { type: 'PICKER_STOP' }
  | { type: 'SET_INTERACTION'; enabled: boolean }
  /** 内容脚本持续上报「输入框占用」状态（ADR-032） */
  | { type: 'SET_INPUT_HOLD'; enabled: boolean }
  | { type: 'CLEAR_KEEP_ACTIVE' };

/** content script → SW（走 chrome.runtime.sendMessage） */
export type ContentEvent =
  /** ADR-032：输入框占用状态变化（true=占用中，false=已解除） */
  | { type: 'INPUT_HOLD'; held: boolean }
  | { type: 'CONTENT_READY' }
  /** 拾取成功：带回生成的 selector */
  | { type: 'PICKER_RESULT'; selector: string; preview: string }
  /** 拾取被取消（Esc / 右键 / 页面导航走） */
  | { type: 'PICKER_CANCELLED'; reason?: string }
  /** 拾取过程中的实时回显（仅用于 SW 转发给 popup，可选） */
  | { type: 'PICKER_PREVIEW'; preview: PickerPreview | null };

export type RoutedMessage = { to: 'offscreen' } & TimerCommand;

/** SW state 快照（给 popup） */
export type StateSnapshot = {
  options: Options;
  session: import('./session').Session | null;
  tabUrl: string;
  /**
   * 当前标签页 URL 对应的 per-page 配置（ADR-022）。
   * 没有就是 null —— 不回落，避免"看起来有配置其实点的是别的页面"。
   */
  pageSelector: import('./page-selectors').PageSelectorEntry | null;
  /** 当前标签页的 pageKey（面板用它判断"是否是同一个页面"，也方便排查） */
  pageKey: string | null;
  /** 运行中的会话锁定的 pageKey；与当前页面不同时面板给出提示（ADR-022） */
  sessionPageKey: string | null;
};

/** 统一的错误返回，popup 用 t() 翻译 code */
export type ErrorCode =
  | 'err_page_unavailable'
  | 'err_not_integer'
  | 'err_interval_positive'
  | 'err_interval_max'
  | 'err_random_range'
  | 'err_limit_count'
  | 'err_restart_wait'
  | 'err_picker_unavailable';

/**
 * 运行期刷新失败的 code（不是表单校验错误）。
 *
 * 关键语义（用户需求）：一轮刷新如果**没真正触发**，就不算一次有效刷新 ——
 * 计数不涨、徽章变红、面板红字告警。避免出现"计数在涨但其实什么都没干"。
 *
 * 命名注意：这些 code 同时是 `_locales` 的 key，
 * 而 Chrome 要求 messages.json 的 key 只能用 `[a-zA-Z0-9_]`（不能有连字符），
 * 所以这里统一用下划线（早期写 `xhr-not-found` 会导致扩展加载直接失败）。
 */
export type RefreshFailureCode =
  | 'xhr_no_selector'
  | 'xhr_not_found'
  | 'xhr_invalid'
  | 'xhr_no_content'
  | 'tab_gone';

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; field?: string };
