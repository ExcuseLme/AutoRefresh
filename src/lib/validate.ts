import type { ErrorCode } from './messages';
import {
  DEFAULT_OPTIONS,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  SCHEMA_VERSION,
  type ClickAction,
  type InteractionAction,
  type IntervalMode,
  type Options,
  type Redirection,
  type RefreshType,
} from './options';

export type ValidationIssue = { field: keyof Options; code: ErrorCode };

export type ValidationResult =
  | { ok: true; options: Options }
  | { ok: false; issues: ValidationIssue[] };

const INTERVAL_MODES: readonly IntervalMode[] = ['fixed', 'random'];
const REFRESH_TYPES: readonly RefreshType[] = ['full', 'xhr'];
const CLICK_ACTIONS: readonly ClickAction[] = ['single', 'double'];
const ACTIONS: readonly InteractionAction[] = ['stop', 'pause', 'restart'];
const REDIRECTIONS: readonly Redirection[] = ['follow', 'canonical'];

type Raw = Record<string, unknown>;

/** 整数秒：OQ-5 已确认不接受小数 */
function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** 夹到合法整数区间；非整数返回 null（调用方决定回落） */
function clampInt(v: unknown, min: number, max: number): number | null {
  if (!isInt(v)) return null;
  return Math.min(max, Math.max(min, v));
}

/**
 * schema v1 → v2 迁移（ADR-021）。
 *
 * v1 的形状：`intervalMode: 'fixed' | 'random' | 'custom'` + `customSeconds` + `fixedPreset`。
 * v2 的形状：`intervalMode: 'fixed' | 'random'` + 唯一的 `fixedSeconds`。
 *
 * 关键点：**不能静默丢掉用户原来的自定义值**。
 * `custom` 档的 `customSeconds` 必须保值进 `fixedSeconds`；
 * 否则用户从 7 秒变回默认 10 秒会莫名其妙，还找不到原因。
 *
 * 纯形状改写，不做合法性判断 —— 校验留给 validateOptions（ADR-007 的"拒绝非法"在其内）。
 */
export function migrateV1ToV2(raw: Raw): Raw {
  const next: Raw = { ...raw };

  if (raw.intervalMode === 'custom') {
    next.intervalMode = 'fixed';
    const custom = clampInt(raw.customSeconds, MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS);
    if (custom !== null) next.fixedSeconds = custom;
  }

  // v1 的固定档可能只有 fixedPreset 而没有 fixedSeconds（脏数据）→ 用预设值补上
  if (!('fixedSeconds' in next) && isInt(raw.fixedPreset)) next.fixedSeconds = raw.fixedPreset;

  delete next.customSeconds;
  delete next.fixedPreset;
  next.schemaVersion = SCHEMA_VERSION;
  return next;
}

/**
 * 校验并归一化一份完整配置。
 *
 * 规则（docs/03 §2 + ADR-007）：用户显式提供的字段若类型/值域非法 → 拒绝整个 patch；
 * 缺失或类型未知的字段 → 回落默认（用于迁移脏数据）。
 */
export function validateOptions(input: unknown): ValidationResult {
  const raw: Raw = typeof input === 'object' && input !== null ? (input as Raw) : {};
  const issues: ValidationIssue[] = [];

  /** 读取整数秒字段：未提供→默认；提供了但非法→记录 issue 并回落 */
  const readInt = (
    key: keyof Options,
    fallback: number,
    opts: { min: number; max: number; codeMin: ErrorCode; codeMax?: ErrorCode },
  ): number => {
    if (!(key in raw) || raw[key] === undefined) return fallback;
    const v = raw[key];
    if (!isInt(v)) {
      issues.push({ field: key, code: 'err_not_integer' });
      return fallback;
    }
    if (v < opts.min) {
      issues.push({ field: key, code: opts.codeMin });
      return fallback;
    }
    if (v > opts.max) {
      issues.push({ field: key, code: opts.codeMax ?? 'err_interval_max' });
      return fallback;
    }
    return v;
  };

  const readBool = (key: keyof Options, fallback: boolean): boolean => {
    const v = raw[key];
    return typeof v === 'boolean' ? v : fallback;
  };

  const readString = (key: keyof Options, fallback: string): string => {
    const v = raw[key];
    return typeof v === 'string' ? v : fallback;
  };

  const intervalMode = pickEnum<IntervalMode>(raw.intervalMode, INTERVAL_MODES, DEFAULT_OPTIONS.intervalMode);
  const refreshType = pickEnum<RefreshType>(raw.refreshType, REFRESH_TYPES, DEFAULT_OPTIONS.refreshType);
  const autoClickAction = pickEnum<ClickAction>(
    raw.autoClickAction,
    CLICK_ACTIONS,
    DEFAULT_OPTIONS.autoClickAction,
  );
  const interactionAction = pickEnum<InteractionAction>(
    raw.interactionAction,
    ACTIONS,
    DEFAULT_OPTIONS.interactionAction,
  );
  const redirection = pickEnum<Redirection>(raw.redirection, REDIRECTIONS, DEFAULT_OPTIONS.redirection);

  const options: Options = {
    schemaVersion: SCHEMA_VERSION,
    intervalMode,
    fixedSeconds: readInt('fixedSeconds', DEFAULT_OPTIONS.fixedSeconds, {
      min: MIN_INTERVAL_SECONDS,
      max: MAX_INTERVAL_SECONDS,
      codeMin: 'err_interval_positive',
    }),
    randomMinSeconds: readInt('randomMinSeconds', DEFAULT_OPTIONS.randomMinSeconds, {
      min: MIN_INTERVAL_SECONDS,
      max: MAX_INTERVAL_SECONDS,
      codeMin: 'err_interval_positive',
    }),
    randomMaxSeconds: readInt('randomMaxSeconds', DEFAULT_OPTIONS.randomMaxSeconds, {
      min: MIN_INTERVAL_SECONDS,
      max: MAX_INTERVAL_SECONDS,
      codeMin: 'err_interval_positive',
    }),
    avoidRepeatRandom: readBool('avoidRepeatRandom', DEFAULT_OPTIONS.avoidRepeatRandom),
    refreshType,
    autoClickSelector: readString('autoClickSelector', DEFAULT_OPTIONS.autoClickSelector),
    autoClickAction,
    hardRefresh: readBool('hardRefresh', DEFAULT_OPTIONS.hardRefresh),
    keepActive: readBool('keepActive', DEFAULT_OPTIONS.keepActive),
    refreshLimitEnabled: readBool('refreshLimitEnabled', DEFAULT_OPTIONS.refreshLimitEnabled),
    refreshLimitCount: readInt('refreshLimitCount', DEFAULT_OPTIONS.refreshLimitCount, {
      min: 1,
      max: 1_000_000,
      codeMin: 'err_limit_count',
      codeMax: 'err_limit_count',
    }),
    interactions: readBool('interactions', DEFAULT_OPTIONS.interactions),
    interactionAction,
    interactionRestartWait: readInt('interactionRestartWait', DEFAULT_OPTIONS.interactionRestartWait, {
      min: 0,
      max: 3600,
      codeMin: 'err_restart_wait',
      codeMax: 'err_restart_wait',
    }),
    ignoreInputField: readBool('ignoreInputField', DEFAULT_OPTIONS.ignoreInputField),
    redirection,
  };

  // 随机范围是「跨字段」约束：两者都合法时才比较，任一非法已单独记录
  if (!issues.some((i) => i.field === 'randomMaxSeconds' || i.field === 'randomMinSeconds')) {
    if ('randomMaxSeconds' in raw && raw.randomMaxSeconds !== undefined)
      if (options.randomMaxSeconds < options.randomMinSeconds) {
        issues.push({ field: 'randomMaxSeconds', code: 'err_random_range' });
      }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, options };
}

/** 字段级 patch：与当前值合并后整体校验；任一处非法则整条 patch 拒绝（docs/03 §6） */
export function applyPatch(current: Options, patch: Partial<Options>): ValidationResult {
  return validateOptions({ ...current, ...patch });
}

/**
 * 迁移 / 读取：容忍脏数据，缺失或未知字段回落默认，不抛错（docs/03 §5）。
 *
 * 顺序不能反：先按 schemaVersion 做形状迁移，再统一校验。
 * 若先校验，v1 的 `intervalMode='custom'` 在 v2 枚举里不存在，会被 pickEnum 静默变成 'fixed'，
 * 用户的 customSeconds 就丢了 —— 这正是 migrateV1ToV2 要先跑的原因。
 */
export function migrate(raw: unknown): Options {
  const base: Raw = typeof raw === 'object' && raw !== null ? (raw as Raw) : {};
  const shape = base.schemaVersion === SCHEMA_VERSION ? base : migrateV1ToV2(base);
  const result = validateOptions(shape);
  return result.ok ? result.options : { ...DEFAULT_OPTIONS };
}

/** 是否是"尚未升级到当前 schema"的存档（首读时用来决定要不要立刻回写迁移结果） */
export function needsMigration(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return true;
  return (raw as Raw).schemaVersion !== SCHEMA_VERSION;
}
