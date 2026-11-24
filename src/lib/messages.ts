import type { Options } from './options';

/** popup → SW */
export type PopupCommand =
  | { type: 'START'; tabId: number }
  | { type: 'STOP'; tabId: number }
  | { type: 'PAUSE'; tabId: number }
  | { type: 'RESUME'; tabId: number }
  | { type: 'OPTIONS_PATCH'; patch: Partial<Options> }
  | { type: 'GET_STATE'; tabId: number };

/** SW → offscreen */
export type TimerCommand =
  | { type: 'ARM'; tabId: number; token: string; delayMs: number }
  | { type: 'DISARM'; tabId?: number; token?: string }
  | { type: 'PING' };

/** offscreen → SW */
export type TimerEvent =
  | { type: 'TICK_DONE'; tabId: number; token: string }
  | { type: 'PONG' };

/** SW → content script（走 chrome.tabs.sendMessage） */
export type ContentCommand =
  | { type: 'AUTOCLICK'; selector: string }
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

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; field?: string };
