/**
 * 每 tab 的刷新会话。设计依据 docs/03-storage-and-state.md §3
 *
 * 状态机：
 *   stop ← STOP ─ start ⇄ pause
 *                   └→ wait（交互 restart 的延迟）→ start
 * ARP 的 `countdown` / `complete` 两个状态在本扩展合并掉（无倒计时、无"完成"语义）。
 */
import type { RefreshFailureCode } from './messages';
import { pageKeyOf } from './page-selectors';

export type SessionStatus = 'start' | 'pause' | 'wait';

/** ADR-032：pause 的原因。null/缺省 = 用户手动暂停；input-hold = 输入框占用自动暂停 */
export type WaitReason = 'interaction' | 'input-hold';

export type Session = {
  tabId: number;
  status: SessionStatus;
  /** 启动时页面 URL（follow 模式下每轮更新为当前 URL） */
  tabUrl: string;
  /** redirection==='canonical' 时始终回到这个 URL（START 时记录，canonical 模式下不再改写） */
  canonicalUrl: string;
  /**
   * ADR-022：**会话锁定**的页面 key（`协议//主机路径`），START 时记录后永不改写。
   *
   * XHR 的 selector / 触发方式按页面隔离（`lib/page-selectors.ts`）。一轮刷新该用哪份配置？
   * 用户已确认：**锁定会话启动时那个页面**。这样即使 follow 模式页面自己跳走了，
   * 也不会突然改去点新页面上的元素 —— 行为可预测，失败原因也好解释。
   */
  pageKey: string;
  /** 已完成刷新轮次 */
  count: number;
  /** 每轮唯一 token：offscreen 的过期 TICK_DONE 用它对不上就丢弃 */
  timerToken: string;
  /** 本轮开始等待的时刻（Date.now），用于 SW 重启后重算剩余时间 */
  armedAt: number;
  /** 本轮等待毫秒数 */
  delayMs: number;
  /** 上一轮等待毫秒数（avoidRepeatRandom 用） */
  prevDelayMs: number;
  /** status==='wait' 时的原因 */
  waitReason?: WaitReason;
  /**
   * 最近一次执行失败的 code（如 XHR 选择器无效）。
   * 失败的一轮**不计入 count**，面板据此显示红字告警与红色徽章（docs/05 §7.2）。
   */
  lastError?: RefreshFailureCode;
  /** 连续失败轮次（成功一轮即清零）；仅用于面板展示与诊断 */
  failedRounds?: number;
};

/** 会话只存在内存里并由 SW 镜像到 storage.session；浏览器重启不恢复（docs/03 §4） */
export type SessionMap = Map<number, Session>;

export function createSession(tabId: number, tabUrl: string, delayMs: number, token: string): Session {
  return {
    tabId,
    status: 'start',
    tabUrl,
    canonicalUrl: tabUrl,
    // ADR-022：会话锁定启动时的页面 key；无法解析的 URL 用空串（取配置时拿不到就是"没配"）
    pageKey: pageKeyOf(tabUrl) ?? '',
    count: 0,
    timerToken: token,
    armedAt: Date.now(),
    delayMs,
    prevDelayMs: 0,
  };
}

export const ACTIVE_STATUSES: readonly SessionStatus[] = ['start', 'pause', 'wait'];

/** 状态摘要用：会话是否处于"用户认为正在刷新"的区间（pause 也算，因为可继续） */
export function isLive(s: Session | null): boolean {
  return s !== null && ACTIVE_STATUSES.includes(s.status);
}
