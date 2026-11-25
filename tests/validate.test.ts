import { describe, expect, it } from 'vitest';
import { applyPatch, migrate, migrateV1ToV2, migrateV2ToV3, needsMigration, validateOptions } from '@/lib/validate';
import { DEFAULT_OPTIONS, FIXED_PRESETS, MAX_INTERVAL_SECONDS, SCHEMA_VERSION } from '@/lib/options';

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

  it('非对象输入回落默认（v4 形状迁移会补 interactionMode，所以只比较关键字段）', () => {
    for (const bad of [null, 'garbage', 42]) {
      const out = migrate(bad);
      expect(out.schemaVersion).toBe(4);
      expect(out.fixedSeconds).toBe(DEFAULT_OPTIONS.fixedSeconds);
      expect(out.interactionMode).toBe(DEFAULT_OPTIONS.interactionMode);
    }
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
    expect(validateOptions({ fixedSeconds: MAX_INTERVAL_SECONDS + 1 }).ok).toBe(false);
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

  it('非法 interactionMode 回落默认（ADR-032 只剩两档）', () => {
    const res = validateOptions({ interactionMode: 'bogus' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.options.interactionMode).toBe(DEFAULT_OPTIONS.interactionMode);
    for (const mode of ['stable', 'hold-input'] as const) {
      const r = validateOptions({ interactionMode: mode });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.options.interactionMode).toBe(mode);
    }
  });
});

describe('applyPatch', () => {
  it('单个字段的合法 patch 通过', () => {
    const res = applyPatch(DEFAULT_OPTIONS, { hardRefresh: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.options.hardRefresh).toBe(true);
  });

  it('patch 中的非法字段整条拒绝（docs/03 §6）', () => {
    const res = applyPatch(DEFAULT_OPTIONS, { hardRefresh: true, fixedSeconds: 0 });
    expect(res.ok).toBe(false);
  });

  it('未提及的字段保持原值', () => {
    const cur = { ...DEFAULT_OPTIONS, fixedSeconds: 60 };
    const res = applyPatch(cur, { intervalMode: 'random' as const });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options.fixedSeconds).toBe(60);
      expect(res.options.intervalMode).toBe('random');
    }
  });

  it('autoClickAction 已移出 options（ADR-022 改按页面存）', () => {
    // v3 起 options 里没有 autoClickSelector / autoClickAction，
    // 它们由 lib/page-selectors.ts 按 URL 隔离存储
    expect('autoClickAction' in DEFAULT_OPTIONS).toBe(false);
    expect('autoClickSelector' in DEFAULT_OPTIONS).toBe(false);
    const res = applyPatch(DEFAULT_OPTIONS, { autoClickAction: 'double' } as never);
    expect(res.ok).toBe(true);
    if (res.ok) expect('autoClickAction' in res.options).toBe(false);
  });
});

describe('migrate · 脏数据', () => {
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

  it('v1 的 fixedPreset 迁移成 fixedSeconds', () => {
    // v2 不再有"预设集合"概念，fixedSeconds 是唯一数据源，
    // 所以 15 这种 v1 里非法的 fixedPreset 迁移后也是一个合法秒数（ADR-021）
    expect(migrate({ schemaVersion: 1, fixedPreset: 15 }).fixedSeconds).toBe(15);
    expect(migrate({ schemaVersion: 1, fixedPreset: 60 }).fixedSeconds).toBe(60);
  });
});

describe('migrateV1ToV2（ADR-021 / R20：不能静默丢用户的自定义值）', () => {
  it('custom 档的 customSeconds 保值进 fixedSeconds', () => {
    const out = migrateV1ToV2({
      schemaVersion: 1,
      intervalMode: 'custom',
      customSeconds: 7,
      fixedSeconds: 10,
      fixedPreset: 10,
    });
    expect(out.intervalMode).toBe('fixed');
    expect(out.fixedSeconds).toBe(7);
    expect('customSeconds' in out).toBe(false);
    expect('fixedPreset' in out).toBe(false);
    expect(out.schemaVersion).toBe(2);
  });

  it('custom 档但 customSeconds 非法时不动 fixedSeconds', () => {
    const out = migrateV1ToV2({ intervalMode: 'custom', customSeconds: 2.5, fixedSeconds: 12 });
    expect(out.intervalMode).toBe('fixed');
    expect(out.fixedSeconds).toBe(12);
  });

  it('随机档原样保留随机区间', () => {
    const out = migrateV1ToV2({
      intervalMode: 'random',
      randomMinSeconds: 3,
      randomMaxSeconds: 9,
      customSeconds: 5,
    });
    expect(out.intervalMode).toBe('random');
    expect(out.randomMinSeconds).toBe(3);
    expect(out.randomMaxSeconds).toBe(9);
    expect('customSeconds' in out).toBe(false);
  });

  it('固定档 60 秒迁移后不变', () => {
    const out = migrateV1ToV2({ intervalMode: 'fixed', fixedSeconds: 60, fixedPreset: 60 });
    expect(out.fixedSeconds).toBe(60);
  });

  it('只有 fixedPreset 没有 fixedSeconds（脏数据）时用预设补上', () => {
    const out = migrateV1ToV2({ intervalMode: 'fixed', fixedPreset: 5 });
    expect(out.fixedSeconds).toBe(5);
  });

  it('迁移结果能通过校验并升到当前 schema（v1 → v3）', () => {
    const out = migrate({ schemaVersion: 1, intervalMode: 'custom', customSeconds: 7 });
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.intervalMode).toBe('fixed');
    expect(out.fixedSeconds).toBe(7);
  });
});

describe('needsMigration', () => {
  it('缺失 / 旧版本 / 非对象都需要迁移', () => {
    expect(needsMigration(undefined)).toBe(true);
    expect(needsMigration(null)).toBe(true);
    expect(needsMigration({})).toBe(true);
    expect(needsMigration({ schemaVersion: 1 })).toBe(true);
  });

  it('当前版本不需要迁移', () => {
    expect(needsMigration(DEFAULT_OPTIONS)).toBe(false);
    expect(needsMigration({ schemaVersion: SCHEMA_VERSION })).toBe(false);
  });

  it('旧版本（v1 / v2）都需要迁移', () => {
    expect(needsMigration({ schemaVersion: 1 })).toBe(true);
    expect(needsMigration({ schemaVersion: 2 })).toBe(true);
  });
});

describe('migrateV2ToV3（ADR-022：全局 selector 移出 options）', () => {
  it('删掉全局 autoClickSelector / autoClickAction', () => {
    const out = migrateV2ToV3({
      schemaVersion: 2,
      autoClickSelector: '[aria-label="刷新"]',
      autoClickAction: 'double',
      fixedSeconds: 10,
    });
    expect('autoClickSelector' in out).toBe(false);
    expect('autoClickAction' in out).toBe(false);
    expect(out.schemaVersion).toBe(3);
    // 其它字段原样保留
    expect(out.fixedSeconds).toBe(10);
  });

  it('不把旧全局值写到任何页面（pages 里没有任何条目 —— 猜 URL 会点错元素）', () => {
    const out = migrate({
      schemaVersion: 2,
      autoClickSelector: '.some-selector',
      autoClickAction: 'double',
    });
    expect('autoClickSelector' in out).toBe(false);
    expect('autoClickAction' in out).toBe(false);
  });

  it('v1 存档会连续迁到 v4', () => {
    const out = migrate({
      schemaVersion: 1,
      intervalMode: 'custom',
      customSeconds: 7,
      autoClickSelector: '.old',
    });
    expect(out.schemaVersion).toBe(4);
    expect(out.fixedSeconds).toBe(7);
    expect(out.intervalMode).toBe('fixed');
    expect('autoClickSelector' in out).toBe(false);
  });
});

describe('FIXED_PRESETS 仍保留为 UI 快捷数字（ADR-021）', () => {
  it('4 个预设都存在且升序', () => {
    expect(FIXED_PRESETS).toEqual([3, 6, 10, 60]);
    expect([...FIXED_PRESETS].sort((a, b) => a - b)).toEqual([...FIXED_PRESETS]);
  });

  it('默认固定秒数是合法整数且在预设集内', () => {
    expect(Number.isInteger(DEFAULT_OPTIONS.fixedSeconds)).toBe(true);
    expect(DEFAULT_OPTIONS.fixedSeconds).toBeGreaterThan(0);
    expect((FIXED_PRESETS as readonly number[]).includes(DEFAULT_OPTIONS.fixedSeconds)).toBe(true);
  });
});
