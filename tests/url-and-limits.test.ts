import { describe, expect, it } from 'vitest';
import { isRefreshableUrl, normalizeUrl, pickTargetUrl, reachedLimit, sameUrl } from '@/lib/url';
import { DEFAULT_CLICK_ACTION, DEFAULT_OPTIONS } from '@/lib/options';

describe('isRefreshableUrl（T-44）', () => {
  it('接受 http/https', () => {
    expect(isRefreshableUrl('https://example.com/')).toBe(true);
    expect(isRefreshableUrl('http://example.com/a')).toBe(true);
  });

  it('拒绝 chrome:// 与 about:', () => {
    expect(isRefreshableUrl('chrome://settings/')).toBe(false);
    expect(isRefreshableUrl('chrome://newtab/')).toBe(false);
    expect(isRefreshableUrl('about:blank')).toBe(false);
  });

  it('拒绝空/undefined', () => {
    expect(isRefreshableUrl(undefined)).toBe(false);
    expect(isRefreshableUrl('')).toBe(false);
  });
});

describe('normalizeUrl / sameUrl', () => {
  it('去协议与 www，并补尾斜杠', () => {
    expect(normalizeUrl('https://www.example.com/a')).toBe('example.com/a/');
    expect(normalizeUrl('http://example.com/a/')).toBe('example.com/a/');
  });

  it('同址判定', () => {
    expect(sameUrl('https://www.example.com/', 'http://example.com/')).toBe(true);
    expect(sameUrl('https://example.com/a', 'https://example.com/b')).toBe(false);
    expect(sameUrl(undefined, 'https://example.com')).toBe(false);
  });
});

describe('pickTargetUrl（T-14 / T-14b）', () => {
  it('follow 返回 null（不强制改 URL）', () => {
    expect(pickTargetUrl({ redirection: 'follow' }, 'https://example.com/start')).toBeNull();
  });

  it('canonical 返回开始时记录的 URL', () => {
    expect(pickTargetUrl({ redirection: 'canonical' }, 'https://example.com/start')).toBe(
      'https://example.com/start',
    );
  });
});

describe('reachedLimit（T-12，ADR-010 用 >= 而非 ARP 的 >）', () => {
  it('关闭时永不到限', () => {
    expect(reachedLimit({ refreshLimitEnabled: false, refreshLimitCount: 3 }, 100)).toBe(false);
  });

  it('count 达到上限即停', () => {
    const opt = { refreshLimitEnabled: true, refreshLimitCount: 3 };
    expect(reachedLimit(opt, 2)).toBe(false);
    expect(reachedLimit(opt, 3)).toBe(true);
    expect(reachedLimit(opt, 4)).toBe(true);
  });

  it('上限为 0 视为无效配置，不到限', () => {
    expect(reachedLimit({ refreshLimitEnabled: true, refreshLimitCount: 0 }, 5)).toBe(false);
  });
});

describe('DEFAULT_OPTIONS 与需求对齐（B1）', () => {
  it('固定档默认 10 秒且在预设集合内', () => {
    expect(DEFAULT_OPTIONS.fixedSeconds).toBe(10);
    expect([3, 6, 10, 60]).toContain(DEFAULT_OPTIONS.fixedSeconds);
  });

  it('schema 是 v3；不再有 custom 相关字段（ADR-021），也没有全局 selector 字段（ADR-022）', () => {
    expect(DEFAULT_OPTIONS.schemaVersion).toBe(3);
    expect('customSeconds' in DEFAULT_OPTIONS).toBe(false);
    expect('fixedPreset' in DEFAULT_OPTIONS).toBe(false);
    expect('autoClickSelector' in DEFAULT_OPTIONS).toBe(false);
    expect('autoClickAction' in DEFAULT_OPTIONS).toBe(false);
  });

  it('页面首次配置的默认触发方式是单击', () => {
    expect(DEFAULT_CLICK_ACTION).toBe('single');
  });

  it('默认完整页面刷新、只跟随重定向、忽略输入框为开', () => {
    expect(DEFAULT_OPTIONS.refreshType).toBe('full');
    expect(DEFAULT_OPTIONS.redirection).toBe('follow');
    expect(DEFAULT_OPTIONS.ignoreInputField).toBe(true);
  });

  it('随机范围默认 [5,30]', () => {
    expect(DEFAULT_OPTIONS.randomMinSeconds).toBe(5);
    expect(DEFAULT_OPTIONS.randomMaxSeconds).toBe(30);
  });
});
