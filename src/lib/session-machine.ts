/**
 * 会话状态迁移的纯函数部分，方便单测。设计依据 docs/03-storage-and-state.md §3
 */
import type { Session, SessionStatus } from './session';

export type Transition = { status: SessionStatus; waitReason?: 'interaction' } | null;

/** 只有 start/wait 会响应"暂停/停止/重新开始"；pause 状态忽略新的交互（与 ARP `Gh()` 一致） */
export function acceptsInteraction(status: SessionStatus): boolean {
  return status === 'start' || status === 'wait';
}

export function canResume(status: SessionStatus): boolean {
  return status === 'pause';
}

export function canPause(status: SessionStatus): boolean {
  return status === 'start' || status === 'wait';
}

/** 面板状态摘要分支（docs/04 §2） */
export type SummaryKind =
  | { kind: 'idle' }
  | { kind: 'running'; count: number; limit: number | null }
  /** 暂停中：带出剩余秒数（ADR-034：暂停要记住倒计时到哪） */
  | { kind: 'paused'; count: number; remainSeconds?: number }
  | { kind: 'waiting'; seconds: number };

export function summarize(session: Session | null, limit: number | null): SummaryKind {
  if (!session) return { kind: 'idle' };
  switch (session.status) {
    case 'pause':
      return {
        kind: 'paused',
        count: session.count,
        // 手动暂停才有剩余时间；输入框占用暂停（input-hold）没有
        remainSeconds:
          session.pausedRemainMs === undefined
            ? undefined
            : Math.max(0, Math.round(session.pausedRemainMs / 1000)),
      };
    case 'wait':
      return { kind: 'waiting', seconds: Math.max(0, Math.round(session.delayMs / 1000)) };
    case 'start':
      return { kind: 'running', count: session.count, limit };
    default:
      return { kind: 'idle' };
  }
}
