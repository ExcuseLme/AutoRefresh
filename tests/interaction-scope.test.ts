import { describe, expect, it } from 'vitest';
import { decideInteraction, exclusiveScopePatch, restartWaitSeconds, triggerScope } from '@/lib/interaction';
import { DEFAULT_OPTIONS } from '@/lib/options';

describe('triggerScope（ADR-027：三档触发范围）', () => {
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

describe('exclusiveScopePatch（两个子开关的单向互斥）', () => {
  it('开「仅输入框内」只改自己，保留 ignoreInputField', () => {
    // 关键：不动 ignoreInputField ⇒ 关掉它时能回到原来那一档
    expect(exclusiveScopePatch('inputOnly', true)).toEqual({ interactionInputOnly: true });
  });

  it('关「仅输入框内」只改自己 ⇒ 回到关它之前的那一档', () => {
    expect(exclusiveScopePatch('inputOnly', false)).toEqual({ interactionInputOnly: false });
  });

  it('开「忽略输入框交互」必须同时关掉「仅输入框内」', () => {
    // 否则点下去看起来没反应（triggerScope 里 inputOnly 优先）
    expect(exclusiveScopePatch('ignoreInput', true)).toEqual({
      ignoreInputField: true,
      interactionInputOnly: false,
    });
  });

  it('关「忽略输入框交互」只改自己', () => {
    expect(exclusiveScopePatch('ignoreInput', false)).toEqual({ ignoreInputField: false });
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
