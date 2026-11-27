/**
 * per-page 配置表的纯逻辑测试（ADR-037）
 *
 * 用户需求："把该扩展的所有配置都修改为 url 作用域记忆吧，不用全局共享配成记忆方案了"
 * 并确认：**新页面一律用内置默认值**（不从旧的全局配置继承）。
 *
 * 这里只测纯函数（清洗 / 容量淘汰），不碰 chrome.storage —— 那部分靠浏览器实测。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '@/lib/options';
import {
  enforcePageOptionsCapacity,
  MAX_PAGE_OPTIONS,
  sanitizePageOptions,
  type PageOptionsTable,
} from '@/lib/page-options';

describe('sanitizePageOptions', () => {
  it('非对象输入 ⇒ 空表', () => {
    expect(sanitizePageOptions(null)).toEqual({});
    expect(sanitizePageOptions('garbage')).toEqual({});
    expect(sanitizePageOptions(42)).toEqual({});
    expect(sanitizePageOptions([])).toEqual({});
  });

  it('接受 { options, updatedAt } 形状并保留时间戳', () => {
    const out = sanitizePageOptions({
      'https://a.com/x': { options: { fixedSeconds: 30 }, updatedAt: 123 },
    });
    expect(out['https://a.com/x']?.options.fixedSeconds).toBe(30);
    expect(out['https://a.com/x']?.updatedAt).toBe(123);
  });

  it('也接受直接存 Options 的旧形状（updatedAt 补 0）', () => {
    const out = sanitizePageOptions({ 'https://a.com/x': { fixedSeconds: 30 } });
    expect(out['https://a.com/x']?.options.fixedSeconds).toBe(30);
    expect(out['https://a.com/x']?.updatedAt).toBe(0);
  });

  it('脏条目被丢弃但好条目保留', () => {
    const out = sanitizePageOptions({
      'https://a.com/x': { options: { fixedSeconds: 30 }, updatedAt: 1 },
      'not-a-page': 'i am not an object',
      'https://b.com/y': { options: null, updatedAt: 2 },
      'https://c.com/z': 42,
    });
    expect(Object.keys(out)).toEqual(['https://a.com/x']);
  });

  it('缺失字段的条目被迁移补齐成完整 Options（不丢默认值）', () => {
    const out = sanitizePageOptions({
      'https://a.com/x': { options: { fixedSeconds: 30 }, updatedAt: 1 },
    });
    const o = out['https://a.com/x']!.options;
    // 没写的字段回落默认，整份配置始终是合法完整的
    expect(o.intervalMode).toBe(DEFAULT_OPTIONS.intervalMode);
    expect(o.refreshType).toBe(DEFAULT_OPTIONS.refreshType);
    expect(o.schemaVersion).toBe(DEFAULT_OPTIONS.schemaVersion);
  });
});

describe('enforcePageOptionsCapacity（LRU 淘汰）', () => {
  it('未超限时原样返回', () => {
    const table: PageOptionsTable = {
      'https://a.com/x': { options: { ...DEFAULT_OPTIONS }, updatedAt: 1 },
    };
    expect(enforcePageOptionsCapacity(table, 10)).toEqual(table);
  });

  it('超限时淘汰最久没被访问的', () => {
    const table: PageOptionsTable = {
      'https://a.com/1': { options: { ...DEFAULT_OPTIONS }, updatedAt: 100 },
      'https://a.com/2': { options: { ...DEFAULT_OPTIONS }, updatedAt: 200 },
      'https://a.com/3': { options: { ...DEFAULT_OPTIONS }, updatedAt: 300 },
    };
    const trimmed = enforcePageOptionsCapacity(table, 2);
    expect(Object.keys(trimmed).sort()).toEqual(['https://a.com/2', 'https://a.com/3']);
  });

  it('默认上限是 MAX_PAGE_OPTIONS', () => {
    expect(MAX_PAGE_OPTIONS).toBe(300);
  });
});
