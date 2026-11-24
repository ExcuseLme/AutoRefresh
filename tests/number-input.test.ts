import { describe, expect, it } from 'vitest';
import { parseIntInRange, parseStrictInt } from '@/lib/number-input';

describe('parseStrictInt（OQ-5：拒绝小数与部分数字）', () => {
  it('接受纯整数', () => {
    expect(parseStrictInt('3')).toBe(3);
    expect(parseStrictInt('0')).toBe(0);
    expect(parseStrictInt(' 60 ')).toBe(60);
    expect(parseStrictInt('86400')).toBe(86400);
  });

  it('拒绝小数（Number.parseInt 会截断，这里必须拒绝）', () => {
    expect(parseStrictInt('2.5')).toBeNull();
    expect(parseStrictInt('0.1')).toBeNull();
    expect(parseStrictInt('.5')).toBeNull();
  });

  it('拒绝部分数字', () => {
    expect(parseStrictInt('12abc')).toBeNull();
    expect(parseStrictInt('abc')).toBeNull();
    expect(parseStrictInt('1e3')).toBeNull();
  });

  it('拒绝负数与科学计数法', () => {
    expect(parseStrictInt('-3')).toBeNull();
    expect(parseStrictInt('+3')).toBeNull();
    expect(parseStrictInt('1E5')).toBeNull();
  });

  it('拒绝空串', () => {
    expect(parseStrictInt('')).toBeNull();
    expect(parseStrictInt('   ')).toBeNull();
  });
});

describe('parseIntInRange', () => {
  it('区间内原样返回', () => {
    expect(parseIntInRange('10', 1, 86400)).toBe(10);
  });

  it('下溢夹到 min', () => {
    expect(parseIntInRange('0', 1, 86400)).toBe(1);
  });

  it('上溢夹到 max', () => {
    expect(parseIntInRange('999999', 1, 86400)).toBe(86400);
  });

  it('非法输入返回 null（调用方回滚显示）', () => {
    expect(parseIntInRange('2.5', 1, 86400)).toBeNull();
  });
});
