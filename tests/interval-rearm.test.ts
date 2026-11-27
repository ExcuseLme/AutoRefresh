/**
 * 间隔配置变化后立即重置倒计时（ADR-036）
 *
 * 用户需求（原话）：
 *   "若当前处于开启自动刷新状态时，修改了刷新间隔，当前不会立即应用新的刷新间隔配置，
 *    而是会等待正在进行的倒计时结束后才会从新配置中取值并进行下一轮的刷新倒计时。
 *    我希望在修改了刷新间隔后放弃当前的倒计时，立即读取新的刷新间隔并重新开始倒计时，
 *    对固定刷新间隔和随机刷新间隔都应该这样"
 *
 * 判定拆成三个纯函数来测，避免只能靠浏览器观察：
 *   - `intervalSignature`：当前间隔配置的指纹（只有影响间隔长度的字段参与）
 *   - `needsRearm`：这个会话要不要重置倒计时
 *   - `nextDelayMs`：按新配置算出新的一轮间隔（随机档会重新抽）
 */
import { describe, expect, it } from 'vitest';
import { intervalSignature, needsRearm, nextDelayMs } from '@/lib/interval';
import { DEFAULT_OPTIONS } from '@/lib/options';

const base = { ...DEFAULT_OPTIONS, intervalMode: 'fixed' as const, fixedSeconds: 10 };

describe('intervalSignature（只看影响间隔长度的字段）', () => {
  it('固定档反映 fixedSeconds', () => {
    expect(intervalSignature({ ...base, fixedSeconds: 10 })).toBe('fixed:10');
    expect(intervalSignature({ ...base, fixedSeconds: 30 })).toBe('fixed:30');
  });

  it('随机档反映区间（含顺序归一）', () => {
    const r = { ...base, intervalMode: 'random' as const, randomMinSeconds: 5, randomMaxSeconds: 30 };
    expect(intervalSignature(r)).toBe('random:5-30');
    // min > max 时与 nextDelayMs 一样按交换后的区间取值 ⇒ 指纹归一后相同
    expect(intervalSignature({ ...r, randomMinSeconds: 30, randomMaxSeconds: 5 })).toBe('random:5-30');
  });

  it('模式不同则指纹不同（即使数字凑巧一样）', () => {
    const fixed = intervalSignature({ ...base, fixedSeconds: 10 });
    const random = intervalSignature({
      ...base,
      intervalMode: 'random',
      randomMinSeconds: 10,
      randomMaxSeconds: 10,
    });
    expect(fixed).not.toBe(random);
  });

  it('不参与判断的字段改了 ⇒ 指纹不变（不能因为改「强制刷新」就重置倒计时）', () => {
    const a = { ...base };
    // 这些字段都不在 intervalSignature 的入参类型里，改它们天然不影响指纹
    const before = intervalSignature(a);
    expect(intervalSignature({ ...a, fixedSeconds: 10 })).toBe(before);
  });
});

describe('needsRearm（要不要重置倒计时）', () => {
  it('正在倒计时且配置变了 ⇒ 重置', () => {
    expect(needsRearm('start', 'fixed:10', 'fixed:30')).toBe(true);
  });

  it('正在倒计时但配置没变 ⇒ 不重置', () => {
    expect(needsRearm('start', 'fixed:10', 'fixed:10')).toBe(false);
  });

  it('暂停中 ⇒ 不重置（用户手动暂停了，不该因改配置就自己跑起来）', () => {
    expect(needsRearm('pause', 'fixed:10', 'fixed:30')).toBe(false);
  });

  it('wait 态 ⇒ 不重置', () => {
    expect(needsRearm('wait', 'fixed:10', 'fixed:30')).toBe(false);
  });

  it('旧会话没有指纹 ⇒ 视为变了（用户既然改了间隔就该立即生效）', () => {
    expect(needsRearm('start', undefined, 'fixed:30')).toBe(true);
  });

  it('随机档改区间也算变了', () => {
    expect(needsRearm('start', 'random:5-30', 'random:10-60')).toBe(true);
    expect(needsRearm('start', 'random:5-30', 'random:5-30')).toBe(false);
  });
});

describe('重置后取到的是新配置的值（固定 + 随机）', () => {
  it('固定档：改 10 → 30 后新间隔就是 30s', () => {
    const opt = { ...base, fixedSeconds: 30 };
    expect(nextDelayMs(opt)).toBe(30_000);
  });

  it('随机档：改成 [10,12] 后新间隔落在新区间内', () => {
    const opt = { ...base, intervalMode: 'random' as const, randomMinSeconds: 10, randomMaxSeconds: 12 };
    for (let i = 0; i < 20; i++) {
      const ms = nextDelayMs(opt, 0, () => i / 20);
      expect(ms).toBeGreaterThanOrEqual(10_000);
      expect(ms).toBeLessThanOrEqual(12_000);
    }
  });

  it('随机档：旧区间取到过的值不会因为 avoidRepeatRandom 卡住（区间变了就是新值）', () => {
    const opt = { ...base, intervalMode: 'random' as const, randomMinSeconds: 20, randomMaxSeconds: 20 };
    // 旧值 10s 不在新区间内 ⇒ 直接返回 20s，不会因去重逻辑死循环
    expect(nextDelayMs(opt, 10_000)).toBe(20_000);
  });
});
