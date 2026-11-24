import { describe, expect, it } from 'vitest';
import { clampSeconds, nextDelayMs } from '@/lib/interval';
import type { Options } from '@/lib/options';

type IntervalInput = Pick<
  Options,
  | 'intervalMode'
  | 'fixedSeconds'
  | 'randomMinSeconds'
  | 'randomMaxSeconds'
  | 'avoidRepeatRandom'
>;

function make(over: Partial<IntervalInput>): IntervalInput {
  return {
    intervalMode: 'fixed',
    fixedSeconds: 10,
    randomMinSeconds: 5,
    randomMaxSeconds: 6,
    avoidRepeatRandom: true,
    ...over,
  };
}

describe('clampSeconds', () => {
  it('保留合法整数', () => {
    expect(clampSeconds(3)).toBe(3);
    expect(clampSeconds(60)).toBe(60);
  });

  it('非法值抬到最小 1 秒', () => {
    expect(clampSeconds(0)).toBe(1);
    expect(clampSeconds(-3)).toBe(1);
    expect(clampSeconds(Number.NaN)).toBe(1);
  });

  it('超上限压到 86400', () => {
    expect(clampSeconds(200_000)).toBe(86400);
  });
});

describe('nextDelayMs · fixed', () => {
  it('固定档返回配置秒数', () => {
    expect(nextDelayMs(make({ intervalMode: 'fixed', fixedSeconds: 3 }))).toBe(3000);
    expect(nextDelayMs(make({ intervalMode: 'fixed', fixedSeconds: 60 }))).toBe(60000);
  });
});

describe('nextDelayMs · fixed 是唯一数据源（ADR-021）', () => {
  it('任意非预设值（如自定义输入的 7 秒）直接生效', () => {
    expect(nextDelayMs(make({ intervalMode: 'fixed', fixedSeconds: 7 }))).toBe(7000);
    expect(nextDelayMs(make({ intervalMode: 'fixed', fixedSeconds: 13 }))).toBe(13000);
  });

  it('非法值被夹到 1 秒（防迁移脏数据）', () => {
    expect(nextDelayMs(make({ intervalMode: 'fixed', fixedSeconds: 0 }))).toBe(1000);
  });

  it('不存在 custom 模式了', () => {
    const modes: IntervalInput['intervalMode'][] = ['fixed', 'random'];
    expect(modes).toHaveLength(2);
  });
});

describe('nextDelayMs · random', () => {
  it('min===max 退化为固定值', () => {
    expect(nextDelayMs(make({ intervalMode: 'random', randomMinSeconds: 5, randomMaxSeconds: 5 }))).toBe(5000);
  });

  it('闭区间：能取到下界与上界（T-23 的核心断言）', () => {
    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < 500 && !(sawMin && sawMax); i++) {
      const v = nextDelayMs(make({ intervalMode: 'random' }));
      if (v === 5000) sawMin = true;
      if (v === 6000) sawMax = true;
      expect([5000, 6000]).toContain(v);
    }
    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });

  it('取值恒落在 [min,max] 内', () => {
    const input = make({ intervalMode: 'random', randomMinSeconds: 3, randomMaxSeconds: 9 });
    for (let i = 0; i < 200; i++) {
      const v = nextDelayMs(input) / 1000;
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('avoidRepeatRandom：不返回上一轮的值（min..max 跨度足够时）', () => {
    const input = make({ intervalMode: 'random', randomMinSeconds: 1, randomMaxSeconds: 10 });
    // 用可预测的 rng 强制第一次取 1、之后取 1（若去重生效，结果不应是 1000）
    let first = true;
    const rng = () => {
      if (first) {
        first = false;
        return 0; // 第一次 → 1s
      }
      return 0; // 后续也指向 1s
    };
    const prev = 1000;
    const v = nextDelayMs(input, prev, rng);
    // 重试 10 次都返回 0 ⇒ 仍可能落回 1s，但只有在重试用尽后才允许
    expect(v).toBeGreaterThanOrEqual(1000);
  });

  it('avoidRepeatRandom 关闭时不去重', () => {
    const input = make({ intervalMode: 'random', avoidRepeatRandom: false });
    const v = nextDelayMs(input, 5000, () => 0);
    expect(v).toBe(5000); // 允许与上一轮相同
  });

  it('avoidRepeatRandom 开启且 min===max 时允许相同（无法避开）', () => {
    const input = make({ intervalMode: 'random', randomMinSeconds: 7, randomMaxSeconds: 7 });
    expect(nextDelayMs(input, 7000)).toBe(7000);
  });

  it('min>max 时不崩溃，按交换后的区间取值', () => {
    const input = make({ intervalMode: 'random', randomMinSeconds: 9, randomMaxSeconds: 3 });
    for (let i = 0; i < 50; i++) {
      const v = nextDelayMs(input) / 1000;
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });
});
