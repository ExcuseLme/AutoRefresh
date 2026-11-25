// 追加到 tests/session-and-interaction.test.ts 的 restart 段
import { describe, expect, it } from 'vitest';
import { needsCustomRestartWait, restartWaitSeconds } from '@/lib/interaction';

describe('restartWaitSeconds / needsCustomRestartWait（ADR-026）', () => {
  it('固定档取固定间隔，忽略自定义值', () => {
    expect(
      restartWaitSeconds({ intervalMode: 'fixed', fixedSeconds: 13, interactionRestartWait: 5 }, 5),
    ).toBe(13);
  });

  it('随机档取自定义值', () => {
    expect(
      restartWaitSeconds({ intervalMode: 'random', fixedSeconds: 13, interactionRestartWait: 5 }, 5),
    ).toBe(5);
  });

  it('负数被夹到 0（防御脏数据）', () => {
    expect(
      restartWaitSeconds({ intervalMode: 'random', fixedSeconds: 13, interactionRestartWait: -3 }, -3),
    ).toBe(0);
  });

  it('非整数被四舍五入（内部只传整数秒）', () => {
    expect(
      restartWaitSeconds({ intervalMode: 'fixed', fixedSeconds: 13.6, interactionRestartWait: 5 }, 5),
    ).toBe(14);
  });

  it('只有随机档才需要面板上的自定义输入框', () => {
    expect(needsCustomRestartWait('fixed')).toBe(false);
    expect(needsCustomRestartWait('random')).toBe(true);
  });
});
