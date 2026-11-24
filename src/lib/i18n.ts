import type { ErrorCode } from './messages';

/** messages.json 里实际存在的 key（ts 层无法从 json 推导，用字面量联合保证不漏翻） */
export type MsgKey = ErrorCode | (string & {});

/**
 * 取文案。设计依据 docs/06-i18n.md §1
 * 缺失时回落 key 名，便于开发期一眼看出漏翻。
 */
export function t(key: MsgKey, subs?: (string | number)[]): string {
  const message = chrome.i18n.getMessage(key, subs?.map(String));
  return message || key;
}
