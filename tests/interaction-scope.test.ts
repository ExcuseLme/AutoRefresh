import { describe, expect, it } from 'vitest';
import { isInputHoldMode, shouldHoldForInput } from '@/lib/interaction';
import { DEFAULT_OPTIONS } from '@/lib/options';

describe('isInputHoldMode / shouldHoldForInput（ADR-032 两档语义）', () => {
  it('stable 档永不因输入框占用而暂停', () => {
    expect(isInputHoldMode({ interactionMode: 'stable' })).toBe(false);
    expect(shouldHoldForInput({ interactionMode: 'stable' }, true)).toBe(false);
    expect(shouldHoldForInput({ interactionMode: 'stable' }, false)).toBe(false);
  });

  it('hold-input 档：占用时暂停', () => {
    expect(isInputHoldMode({ interactionMode: 'hold-input' })).toBe(true);
    expect(shouldHoldForInput({ interactionMode: 'hold-input' }, true)).toBe(true);
  });

  it('hold-input 档：解除后不暂停（恢复计时由 SW 的边上沿处理）', () => {
    expect(shouldHoldForInput({ interactionMode: 'hold-input' }, false)).toBe(false);
  });

  it('默认值就是 hold-input（对应用户两种需求的第二种）', () => {
    expect(DEFAULT_OPTIONS.interactionMode).toBe('hold-input');
  });
});
