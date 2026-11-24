import { describe, expect, it } from 'vitest';
import { applyPatch, migrate, validateOptions } from '@/lib/validate';
import { DEFAULT_OPTIONS } from '@/lib/options';

describe('validateOptions · 合法输入', () => {
  it('全默认值可通过', () => {
    const res = validateOptions(DEFAULT_OPTIONS);
    expect(res.ok).toBe(true);
  });

  it('空对象回落默认', () => {
    const res = validateOptions({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.options).toEqual(DEFAULT_OPTIONS);
  });

  it('非对象输入回落默认', () => {
    expect(migrate(null)).toEqual(DEFAULT_OPTIONS);
    expect(migrate('garbage')).toEqual(DEFAULT_OPTIONS);
    expect(migrate(42)).toEqual(DEFAULT_OPTIONS);
  });
});

describe('validateOptions · 非法值被拒绝（ADR-007 / T-21b / T-24）', () => {
  it('固定秒数为 0 / 负数 / 小数都拒绝', () => {
    expect(validateOptions({ fixedSeconds: 0 }).ok).toBe(false);
    expect(validateOptions({ fixedSeconds: -3 }).ok).toBe(false);
    expect(validateOptions({ fixedSeconds: 2.5 }).ok).toBe(false);
  });

  it('超过上限拒绝', () => {
    expect(validateOptions({ fixedSeconds: 100_000 }).ok).toBe(false);
    expect(validateOptions({ customSeconds: 100_000 }).ok).toBe(false);
  });

  it('随机范围 max < min 拒绝', () => {
    const res = validateOptions({ randomMinSeconds: 20, randomMaxSeconds: 5 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0]?.code).toBe('err_random_range');
  });

  it('随机 min/max 非法秒数拒绝', () => {
    expect(validateOptions({ randomMinSeconds: 0 }).ok).toBe(false);
    expect(validateOptions({ randomMaxSeconds: -1 }).ok).toBe(false);
  });

  it('刷新次数 <1 拒绝', () => {
    const res = validateOptions({ refreshLimitCount: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0]?.code).toBe('err_limit_count');
  });

  it('重启等待为负拒绝', () => {
    const res = validateOptions({ interactionRestartWait: -1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0]?.code).toBe('err_restart_wait');
  });
});

describe('applyPatch', () => {
  it('单个字段的合法 patch 通过', () => {
    const res = applyPatch(DEFAULT_OPTIONS, { hardRefresh: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.options.hardRefresh).toBe(true);
  });

  it('patch 中的非法字段整条拒绝（docs/03 §6）', () => {
    const res = applyPatch(DEFAULT_OPTIONS, { hardRefresh: true, customSeconds: 0 });
    expect(res.ok).toBe(false);
  });

  it('未提及的字段保持原值', () => {
    const cur = { ...DEFAULT_OPTIONS, fixedPreset: 60 as const, fixedSeconds: 60 };
    const res = applyPatch(cur, { intervalMode: 'random' as const });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options.fixedSeconds).toBe(60);
      expect(res.options.intervalMode).toBe('random');
    }
  });
});

describe('migrate', () => {
  it('脏枚举回落默认', () => {
    const o = migrate({ intervalMode: 'weird', refreshType: 'nope', interactionAction: 'x', redirection: 'y' });
    expect(o.intervalMode).toBe(DEFAULT_OPTIONS.intervalMode);
    expect(o.refreshType).toBe(DEFAULT_OPTIONS.refreshType);
    expect(o.interactionAction).toBe(DEFAULT_OPTIONS.interactionAction);
    expect(o.redirection).toBe(DEFAULT_OPTIONS.redirection);
  });

  it('未知键被丢弃', () => {
    const o = migrate({ ...DEFAULT_OPTIONS, domain_config: { a: 1 }, premium: true });
    expect('domain_config' in o).toBe(false);
    expect('premium' in o).toBe(false);
  });

  it('fixedPreset 只接受 3/5/10/60', () => {
    expect(migrate({ fixedPreset: 15 }).fixedPreset).toBe(DEFAULT_OPTIONS.fixedPreset);
    expect(migrate({ fixedPreset: 60 }).fixedPreset).toBe(60);
  });
});
