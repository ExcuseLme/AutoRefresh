import type { ErrorCode } from './messages';
import {
  DEFAULT_OPTIONS,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  SCHEMA_VERSION,
  type InteractionMode,
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
const INTERACTION_MODES: readonly InteractionMode[] = ['stable', 'hold-input'];
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
 * v1 → v2 形状迁移（ADR-021）。
 *
 * v1：`intervalMode: 'fixed' | 'random' | 'custom'` + `customSeconds` + `fixedPreset`
 * v2：`intervalMode: 'fixed' | 'random'` + 唯一的 `fixedSeconds`
 *
 * 关键：**不能静默丢掉用户原来的自定义值**（`custom` 档的 `customSeconds` 保值进 `fixedSeconds`）。
 */
export function migrateV1ToV2(raw: Raw): Raw {
  const next: Raw = { ...raw };

  if (raw.intervalMode === 'custom') {
    next.intervalMode = 'fixed';
    const custom = clampInt(raw.customSeconds, MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS);
    if (custom !== null) next.fixedSeconds = custom;
  }

  if (!('fixedSeconds' in next) && isInt(raw.fixedPreset)) next.fixedSeconds = raw.fixedPreset;

  delete next.customSeconds;
  delete next.fixedPreset;
  next.schemaVersion = 2;
  return next;
}

/**
 * v2 → v3 形状迁移（ADR-022）。
 *
 * v2 的 XHR selector / 触发方式是**全局**字段（`autoClickSelector` / `autoClickAction`），
 * 用户实测发现这会导致"在 B 页选元素把 A 页正在跑的会话目标改掉"。v3 把它们移出 options，
 * 改存到按 URL 隔离的 `pageSelectors` 键（`lib/page-selectors.ts`）。
 *
 * **这里不把旧的全局值写到任何页面**：迁移时无从得知它属于哪个 URL，
 * 猜错会在错误页面上点错元素。安全做法是丢弃，让用户回到页面重新拾取一次
 * （`docs/11` §3.3 记录了这条取舍）。
 */
export function migrateV2ToV3(raw: Raw): Raw {
  const next: Raw = { ...raw };
  delete next.autoClickSelector;
  delete next.autoClickAction;
  next.schemaVersion = 3;
  return next;
}

/**
 * v3 → v4 形状迁移（ADR-032）。
 *
 * v3 用 4 个字段描述交互：`interactionAction`（stop/pause/restart）、`interactionRestartWait`、
 * `interactionInputOnly`、`ignoreInputField`。ADR-028 把它们压成三段枚举后，
 * 用户进一步确认只需要两档语义（"始终稳定刷新" / "输入框占用时暂停"），
 * 三选一动作与重启等待秒数都没有适用场景了。
 *
 * 迁移映射（保住用户原来的实际行为，而不是一律回默认）：
 *
 * | v3 组合 | v4 `interactionMode` |
 * | --- | --- |
 * | `interactionInputOnly=true`（旧「仅框内」） | `hold-input` —— 语义正是"输入框在场时打断" |
 * | 其余（旧「任何交互」/「仅框外」） | `stable` —— 框外点击也打断会让倒计时不稳，正是用户要摆脱的行为 |
 *
 * 旧「仅框外」为什么不保留：用户明确说"我只有两种需求"，
 * 框外点击也打断会让倒计时不稳定，属于他要摆脱的行为。
 */
export function migrateV3ToV4(raw: Raw): Raw {
  const next: Raw = { ...raw };

  /*
   * 旧「仅框内」⇒ hold-input（语义正是"输入框在场时打断"）。
   * 但**空/脏存档**（压根没有 v3 的交互字段）不能硬写 stable ——
   * 那会让"全新安装"与"空存档"得到不同默认行为。这种情况用默认值。
   */
  const hasV3Interaction = 'interactionInputOnly' in raw || 'ignoreInputField' in raw;
  const mode: Raw['interactionMode'] = hasV3Interaction
    ? raw.interactionInputOnly === true
      ? 'hold-input'
      : 'stable'
    : DEFAULT_OPTIONS.interactionMode;
  next.interactionMode = mode;

  delete next.interactionAction;
  delete next.interactionRestartWait;
  delete next.interactionInputOnly;
  delete next.ignoreInputField;

  next.schemaVersion = 4;
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

  const intervalMode = pickEnum<IntervalMode>(raw.intervalMode, INTERVAL_MODES, DEFAULT_OPTIONS.intervalMode);
  const refreshType = pickEnum<RefreshType>(raw.refreshType, REFRESH_TYPES, DEFAULT_OPTIONS.refreshType);
  const interactionMode = pickEnum<InteractionMode>(
    raw.interactionMode,
    INTERACTION_MODES,
    DEFAULT_OPTIONS.interactionMode,
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
    hardRefresh: readBool('hardRefresh', DEFAULT_OPTIONS.hardRefresh),
    keepActive: readBool('keepActive', DEFAULT_OPTIONS.keepActive),
    refreshLimitEnabled: readBool('refreshLimitEnabled', DEFAULT_OPTIONS.refreshLimitEnabled),
    refreshLimitCount: readInt('refreshLimitCount', DEFAULT_OPTIONS.refreshLimitCount, {
      min: 1,
      max: 1_000_000,
      codeMin: 'err_limit_count',
      codeMax: 'err_limit_count',
    }),
    interactionMode,
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
 * 顺序不能反：先把形状逐版本推到当前版本，再统一校验。
 * 若先校验，v1 的 `intervalMode='custom'` 在 v2 枚举里不存在，会被 pickEnum 静默变成
 * 'fixed'，用户的 customSeconds 就丢了 —— 这正是形状迁移必须先跑的原因。
 */
export function migrate(raw: unknown): Options {
  const base: Raw = typeof raw === 'object' && raw !== null ? (raw as Raw) : {};

  let shape = base;
  const version = typeof base.schemaVersion === 'number' ? base.schemaVersion : 1;
  if (version < 2) shape = migrateV1ToV2(shape);
  if (version < 3) shape = migrateV2ToV3(shape);
  if (version < 4) shape = migrateV3ToV4(shape);

  const result = validateOptions(shape);
  return result.ok ? result.options : { ...DEFAULT_OPTIONS };
}

/** 是否是"尚未升级到当前 schema"的存档（首读时用来决定要不要立刻回写迁移结果） */
export function needsMigration(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return true;
  const v = (raw as Raw).schemaVersion;
  return typeof v !== 'number' || v < SCHEMA_VERSION;
}
