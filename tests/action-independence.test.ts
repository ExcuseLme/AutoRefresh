/**
 * 「触发方式」独立于 selector 的回归测试（ADR-035）
 *
 * 用户 bug 报告：
 *   1. "点击'单击'或'双击'进行模式切换时感觉很卡，要等一会儿才会更新为目标状态"
 *   2. "在填写 xhr 刷新的目标元素 selector 之前似乎无法切换触发方式"
 *
 * 两件事同源：`action` 与 `selector` 被绑在同一条记录里，且读的时候
 * `if (!entry.selector) return null` 直接把只设了触发方式的页面判成"没配置"；
 * 面板又完全没有订阅 `pageSelectors`，只能等 500ms 轮询才看到新值。
 */
import { describe, expect, it } from 'vitest';
import { getEntryByKey, getPageEntry, setActionEntry, setPageEntry } from '@/lib/page-selectors';

describe('触发方式可以不依赖 selector（ADR-035）', () => {
  it('没有 selector 时也能写入并读回触发方式', () => {
    const map = setActionEntry({}, 'https://a.com/x', 'double');
    const entry = getPageEntry(map, 'https://a.com/x');
    expect(entry).not.toBeNull();
    expect(entry?.action).toBe('double');
    expect(entry?.selector).toBe('');
  });

  it('先设触发方式、后填 selector ⇒ 触发方式被保留', () => {
    let map = setActionEntry({}, 'https://a.com/x', 'double');
    map = setPageEntry(map, 'https://a.com/x', '.btn', 'double');
    expect(getPageEntry(map, 'https://a.com/x')?.action).toBe('double');
    expect(getPageEntry(map, 'https://a.com/x')?.selector).toBe('.btn');
  });

  it('先填 selector、后改触发方式 ⇒ selector 被保留', () => {
    let map = setPageEntry({}, 'https://a.com/x', '.btn', 'single');
    map = setActionEntry(map, 'https://a.com/x', 'double');
    expect(getPageEntry(map, 'https://a.com/x')?.selector).toBe('.btn');
    expect(getPageEntry(map, 'https://a.com/x')?.action).toBe('double');
  });

  it('清空 selector 不会把触发方式一起清掉', () => {
    let map = setActionEntry({}, 'https://a.com/x', 'double');
    map = setPageEntry(map, 'https://a.com/x', '', 'double');
    expect(getPageEntry(map, 'https://a.com/x')?.action).toBe('double');
  });

  it('getEntryByKey 与 getPageEntry 对空 selector 的结论一致', () => {
    const map = setActionEntry({}, 'https://a.com/x', 'double');
    expect(getEntryByKey(map, 'https://a.com/x')?.action).toBe('double');
    expect(getPageEntry(map, 'https://a.com/x')?.action).toBe('double');
  });

  it('未配置的页面两个入口都返回 null', () => {
    expect(getEntryByKey({}, 'https://a.com/x')).toBeNull();
    expect(getPageEntry({}, 'https://a.com/x')).toBeNull();
  });

  it('两种触发方式互切都能落库', () => {
    let map = setActionEntry({}, 'https://a.com/x', 'double');
    map = setActionEntry(map, 'https://a.com/x', 'single');
    expect(getPageEntry(map, 'https://a.com/x')?.action).toBe('single');
    map = setActionEntry(map, 'https://a.com/x', 'double');
    expect(getPageEntry(map, 'https://a.com/x')?.action).toBe('double');
  });

  it('不同页面的触发方式互不影响', () => {
    let map = setActionEntry({}, 'https://a.com/x', 'double');
    map = setActionEntry(map, 'https://b.com/x', 'single');
    expect(getPageEntry(map, 'https://a.com/x')?.action).toBe('double');
    expect(getPageEntry(map, 'https://b.com/x')?.action).toBe('single');
  });
});
