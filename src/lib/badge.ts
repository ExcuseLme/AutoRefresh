/**
 * 徽章文案（ADR-031）
 *
 * 用户需求：在扩展图标上实时显示当前页面的倒计时。
 *
 * 规则（原话）：
 *   "倒计时仅显示剩余总秒数，如果大于等于60秒则显示为截断的分钟数，
 *    [60<=剩余时间<120]秒时显示为'1m'，剩余[120<=剩余时间<180]秒时显示为'2m'"
 *
 * 所以是**截断**（floor）而不是四舍五入：240s–300s 都显示 `5m`，不是 `4m`/`5m` 跳变。
 *   - `>= 60s`  ⇒ `{floor(sec/60)}m`
 *   - `< 60s`   ⇒ 秒数本身
 *
 * 剩余秒数用 `Math.ceil`：`delayMs` 只剩 0.2s 时应显示 `1` 而不是 `0`，
 * 否则最后一秒会出现"显示 0 但还没刷新"的观感。
 *
 * 当前页面没有开启刷新时不显示任何数字（徽章清空），符合"这扩展图标正常显示"的要求。
 */
import type { Session } from './session';

export function countdownText(remainingMs: number): string {
  const sec = Math.max(0, Math.ceil(remainingMs / 1000));
  if (sec >= 60) return `${Math.floor(sec / 60)}m`;
  return String(sec);
}

/** 徽章配色。与 ARP 的语义对齐：运行绿、暂停黄、失败红、拾取紫 */
export const BADGE_COLORS = {
  running: '#22c55e',
  paused: '#f59e0b',
  failed: '#dc2626',
  picking: '#6366f1',
} as const;

export type BadgeAppearance = {
  /** 徽章文本；空串表示不显示 */
  text: string;
  color: string;
};

/** 失败/pause 等非倒计时态统一用短标记 */
const STATE_MARK: Record<'failed' | 'paused' | 'wait-paused', string> = {
  failed: '!',
  paused: 'II',
  'wait-paused': 'II',
};

/**
 * 由会话推导徽章外观。
 *
 * | 会话状态 | 徽章 |
 * | --- | --- |
 * | 无会话 | 空（正常图标，不显示倒计时） |
 * | 失败（有 lastError） | `!` 红 |
 * | 暂停 | `II` 黄 |
 * | 运行 / 等待重启 | **倒计时数字** 绿（≥60s 时 `{n}m`） |
 */
export function badgeAppearance(session: Session | null, now: number = Date.now()): BadgeAppearance {
  if (!session) return { text: '', color: BADGE_COLORS.running };

  if (session.lastError) return { text: STATE_MARK.failed, color: BADGE_COLORS.failed };
  if (session.status === 'pause') return { text: STATE_MARK.paused, color: BADGE_COLORS.paused };

  // start / wait：都处于"距下一轮还有多久"的状态，显示倒计时
  const remain = session.armedAt + session.delayMs - now;
  return { text: countdownText(remain), color: BADGE_COLORS.running };
}
