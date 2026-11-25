import { describe, expect, it } from 'vitest';
import { decideInteraction, restartWaitSeconds, scopePatch, triggerScope } from '@/lib/interaction';
import { DEFAULT_OPTIONS } from '@/lib/options';

describe('triggerScope（三档触发范围）', () => {
  it('两个子开关都关 ⇒ 任何交互都触发', () => {
    expect(triggerScope({ interactionInputOnly: false, ignoreInputField: false })).toBe('all');
  });

  it('只开「忽略输入框交互」⇒ 只有输入框外的交互触发（默认）', () => {
    expect(triggerScope({ interactionInputOnly: false, ignoreInputField: true })).toBe('outside-input');
  });

  it('开「仅输入框内触发」⇒ 只有输入框内的交互触发', () => {
    expect(triggerScope({ interactionInputOnly: true, ignoreInputField: true })).toBe('inside-input-only');
    expect(triggerScope({ interactionInputOnly: true, ignoreInputField: false })).toBe('inside-input-only');
  });

  it('interactionInputOnly 优先（两者同时为真不会变成"任何都不触发"的死状态）', () => {
    expect(triggerScope({ interactionInputOnly: true, ignoreInputField: true })).toBe('inside-input-only');
  });
});

describe('decideInteraction 与触发范围联合', () => {
  const base = { ...DEFAULT_OPTIONS, interactions: true, interactionAction: 'pause' } as const;

  it('总开关关闭 ⇒ 任何交互都不触发', () => {
    expect(decideInteraction({ ...base, interactions: false }, false)).toBeNull();
    expect(decideInteraction({ ...base, interactions: false }, true)).toBeNull();
  });

  it('scope=all ⇒ 输入框内外都触发', () => {
    const opt = { ...base, interactionInputOnly: false, ignoreInputField: false };
    expect(decideInteraction(opt, false)).toMatchObject({ action: 'pause' });
    expect(decideInteraction(opt, true)).toMatchObject({ action: 'pause' });
  });

  it('scope=outside-input ⇒ 只有输入框外触发（普通点击/滚动照常干扰刷新）', () => {
    const opt = { ...base, interactionInputOnly: false, ignoreInputField: true };
    expect(decideInteraction(opt, false)).toMatchObject({ action: 'pause' });
    expect(decideInteraction(opt, true)).toBeNull();
  });

  it('scope=inside-input-only ⇒ 只有输入框内触发（普通点击/滚动不影响刷新）', () => {
    const opt = { ...base, interactionInputOnly: true, ignoreInputField: false };
    expect(decideInteraction(opt, false)).toBeNull();
    expect(decideInteraction(opt, true)).toMatchObject({ action: 'pause' });
  });

  it('scope=inside-input-only 时，即使 ignoreInputField 残留为 true 也仍只在输入框内触发', () => {
    const opt = { ...base, interactionInputOnly: true, ignoreInputField: true };
    expect(decideInteraction(opt, false)).toBeNull();
    expect(decideInteraction(opt, true)).toMatchObject({ action: 'pause' });
  });
});

describe('scopePatch / triggerScope 三档互斥（ADR-028）', () => {
  it('all 档 ⇒ 两个布尔都关', () => {
    expect(scopePatch('all')).toEqual({ interactionInputOnly: false, ignoreInputField: false });
  });

  it('outside-input 档 ⇒ 只开 ignoreInputField', () => {
    expect(scopePatch('outside-input')).toEqual({ interactionInputOnly: false, ignoreInputField: true });
  });

  it('inside-input-only 档 ⇒ 只开 interactionInputOnly', () => {
    expect(scopePatch('inside-input-only')).toEqual({ interactionInputOnly: true });
  });

  it('每个档位 patch 后再读回，档位不变（往返一致）', () => {
    for (const scope of ['all', 'outside-input', 'inside-input-only'] as const) {
      const opt = { interactionInputOnly: false, ignoreInputField: true, ...scopePatch(scope) };
      expect(triggerScope(opt)).toBe(scope);
    }
  });

  it('三档之间切换不会残留上一档的状态', () => {
    // all → inside：ignoreInputField 被保留为 true，但 inputOnly 优先，读回仍是 inside
    const afterInside = { interactionInputOnly: false, ignoreInputField: true, ...scopePatch('inside-input-only') };
    expect(triggerScope(afterInside)).toBe('inside-input-only');
    // inside → all：两个都被显式关掉，不会因为 inputOnly 残留而卡在 inside
    const afterAll = { ...afterInside, ...scopePatch('all') };
    expect(triggerScope(afterAll)).toBe('all');
    // all → outside：回到默认档
    const afterOutside = { ...afterAll, ...scopePatch('outside-input') };
    expect(triggerScope(afterOutside)).toBe('outside-input');
  });
});
describe('restartWaitSeconds（ADR-026）', () => {
  it('固定档取固定间隔，忽略自定义值', () => {
    expect(restartWaitSeconds({ intervalMode: 'fixed', fixedSeconds: 13, interactionRestartWait: 5 }, 5)).toBe(13);
  });

  it('随机档取自定义值', () => {
    expect(restartWaitSeconds({ intervalMode: 'random', fixedSeconds: 13, interactionRestartWait: 5 }, 5)).toBe(5);
  });

  it('负数夹到 0、小数四舍五入', () => {
    expect(restartWaitSeconds({ intervalMode: 'random', fixedSeconds: 13, interactionRestartWait: -3 }, -3)).toBe(0);
    expect(restartWaitSeconds({ intervalMode: 'fixed', fixedSeconds: 13.6, interactionRestartWait: 5 }, 5)).toBe(14);
  });
});
