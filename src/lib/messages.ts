import type { Options } from './options';

/** popup → SW */
export type PopupCommand =
  | { type: 'START'; tabId: number }
  | { type: 'STOP'; tabId: number }
  | { type: 'PAUSE'; tabId: number }
  | { type: 'RESUME'; tabId: number }
  | { type: 'OPTIONS_PATCH'; patch: Partial<Options> }
  | { type: 'GET_STATE'; tabId: number }
  | { type: 'TEST_SELECTOR'; tabId: number; selector: string };

/** SW → offscreen */
export type TimerCommand =
  | { type: 'ARM'; tabId: number; token: string; delayMs: number }
  | { type: 'DISARM'; tabId?: number; token?: string }
  | { type: 'PING' };

/** offscreen → SW */
export type TimerEvent =
  | { type: 'TICK_DONE'; tabId: number; token: string }
  | { type: 'PONG' };

/** 内容脚本对选择器探测的回复（TEST_SELECTOR 用） */
export type SelectorProbe =
  | { result: 'ok'; count: number; preview: string }
  | { result: 'not-found'; count: 0 }
  | { result: 'invalid' };

/** SW → content script（走 chrome.tabs.sendMessage） */
export type ContentCommand =
  | { type: 'AUTOCLICK'; selector: string }
  | { type: 'TEST_SELECTOR'; selector: string }
  | { type: 'SET_INTERACTION'; enabled: boolean }
  | { type: 'CLEAR_KEEP_ACTIVE' };

/** content script → SW（走 chrome.runtime.sendMessage） */
export type ContentEvent =
  | { type: 'INTERACTION'; isInput: boolean }
  | { type: 'CONTENT_READY' };

export type RoutedMessage = { to: 'offscreen' } & TimerCommand;

/** SW state 快照（给 popup） */
export type StateSnapshot = {
  options: Options;
  session: import('./session').Session | null;
  tabUrl: string;
};

/** 统一的错误返回，popup 用 t() 翻译 code */
export type ErrorCode =
  | 'err_page_unavailable'
  | 'err_not_integer'
  | 'err_interval_positive'
  | 'err_interval_max'
  | 'err_random_range'
  | 'err_limit_count'
  | 'err_restart_wait';

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
