import { describe, expect, it } from 'vitest';
import { decideInteraction } from '@/lib/interaction';
import { acceptsInteraction, canPause, canResume, summarize } from '@/lib/session-machine';
import { createSession, isLive, type Session } from '@/lib/session';
import { DEFAULT_OPTIONS } from '@/lib/options';

function session(over: Partial<Session> = {}): Session {
  return { ...createSession(1, 'https://example.com/', 10_000, 'tok-1'), ...over };
}

/**
 * 会话状态机
 *
 * 注意：`decideInteraction` 与「三选一动作 / 重新开始等待」在 ADR-032 里已被删除
 * （用户确认只要两档语义，不需要 stop/pause/restart 三选一）。
 * 输入框占用相关的判定改在 `tests/input-hold.test.ts` 与 `tests/interaction-scope.test.ts`。
 */
describe('会话状态机', () => {
  it('只有 start/wait 响应交互（T-13b 的 pause 不能被再次交互覆盖）', () => {
    expect(acceptsInteraction('start')).toBe(true);
    expect(acceptsInteraction('wait')).toBe(true);
    expect(acceptsInteraction('pause')).toBe(false);
  });

  it('pause/resume 的可用状态', () => {
    expect(canPause('start')).toBe(true);
    expect(canPause('wait')).toBe(true);
    expect(canPause('pause')).toBe(false);
    expect(canResume('pause')).toBe(true);
    expect(canResume('start')).toBe(false);
  });

  it('isLive：pause 也算"活着"（可继续）', () => {
    expect(isLive(null)).toBe(false);
    expect(isLive(session({ status: 'pause' }))).toBe(true);
    expect(isLive(session({ status: 'start' }))).toBe(true);
  });
});

describe('summarize（面板状态摘要）', () => {
  it('无会话 → idle', () => {
    expect(summarize(null, null)).toEqual({ kind: 'idle' });
  });

  it('运行中，无上限', () => {
    expect(summarize(session({ status: 'start', count: 3 }), null)).toEqual({
      kind: 'running',
      count: 3,
      limit: null,
    });
  });

  it('运行中，有上限（T-12）', () => {
    expect(summarize(session({ status: 'start', count: 2 }), 3)).toEqual({
      kind: 'running',
      count: 2,
      limit: 3,
    });
  });

  it('暂停保留 count', () => {
    expect(summarize(session({ status: 'pause', count: 4 }), null)).toEqual({ kind: 'paused', count: 4 });
  });

  it('wait 显示剩余秒数（T-13c）', () => {
    expect(summarize(session({ status: 'wait', delayMs: 5000 }), null)).toEqual({
      kind: 'waiting',
      seconds: 5,
    });
  });
});

describe('createSession', () => {
  it('初始为 start、count=0、canonicalUrl 记为启动 URL', () => {
    const s = createSession(7, 'https://example.com/x', 3000, 'tok');
    expect(s.status).toBe('start');
    expect(s.count).toBe(0);
    expect(s.canonicalUrl).toBe('https://example.com/x');
    expect(s.tabUrl).toBe('https://example.com/x');
    expect(s.delayMs).toBe(3000);
    expect(s.timerToken).toBe('tok');
  });
});
