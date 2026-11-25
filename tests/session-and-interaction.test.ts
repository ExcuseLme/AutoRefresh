import { describe, expect, it } from 'vitest';
import { decideInteraction } from '@/lib/interaction';
import { acceptsInteraction, canPause, canResume, summarize } from '@/lib/session-machine';
import { createSession, isLive, type Session } from '@/lib/session';
import { DEFAULT_OPTIONS } from '@/lib/options';

function session(over: Partial<Session> = {}): Session {
  return { ...createSession(1, 'https://example.com/', 10_000, 'tok-1'), ...over };
}

describe('decideInteraction（A4 / A6 / A7 / T-13 / T-15 / T-16）', () => {
  it('总开关关闭时无动作（T-16）', () => {
    expect(decideInteraction({ ...DEFAULT_OPTIONS, interactions: false }, false)).toBeNull();
  });

  it('总开关开启时返回三选一动作', () => {
    const d = decideInteraction(
      { ...DEFAULT_OPTIONS, interactions: true, interactionAction: 'stop' },
      false,
    );
    expect(d?.action).toBe('stop');
  });

  it('忽略输入框开启时，输入框内交互被忽略（T-15）', () => {
    expect(
      decideInteraction({ ...DEFAULT_OPTIONS, interactions: true, ignoreInputField: true }, true),
    ).toBeNull();
  });

  it('忽略输入框关闭时，输入框内交互也生效（T-15b）', () => {
    const d = decideInteraction(
      { ...DEFAULT_OPTIONS, interactions: true, ignoreInputField: false, interactionAction: 'pause' },
      true,
    );
    expect(d?.action).toBe('pause');
  });

  it('restart 在随机档时用自定义等待秒数（T-13c）', () => {
    const d = decideInteraction(
      {
        ...DEFAULT_OPTIONS,
        interactions: true,
        interactionAction: 'restart',
        interactionRestartWait: 5,
        intervalMode: 'random',
      },
      false,
    );
    expect(d).toEqual({ action: 'restart', waitSeconds: 5 });
  });

  it('restart 在固定档时直接用当前固定间隔（ADR-026：不让用户再填数字）', () => {
    const d = decideInteraction(
      {
        ...DEFAULT_OPTIONS,
        interactions: true,
        interactionAction: 'restart',
        interactionRestartWait: 5,
        intervalMode: 'fixed',
        fixedSeconds: 30,
      },
      false,
    );
    // 自定义值 5 被忽略，用固定间隔 30
    expect(d).toEqual({ action: 'restart', waitSeconds: 30 });
  });
});

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
