/**
 * 全局配置（唯一持久配置）。设计依据：docs/03-storage-and-state.md §1
 *
 * 与 ARP 的差异：
 * - 只有一份全局配置，没有 domain_config / site_scopes（ADR-002）
 * - 时间一律「整数秒」，不接受小数（OQ-5 已确认）
 * - 间隔只有「固定 / 随机」两档，固定档只有一个 `fixedSeconds` 数据源（ADR-021）
 * - XHR 的 selector 与单击/双击**不在这里**：它们按页面（URL）隔离，
 *   存在独立的 `pageSelectors` 键里（ADR-022 / `lib/page-selectors.ts`）
 */

export type IntervalMode = 'fixed' | 'random';
export type RefreshType = 'full' | 'xhr';
export type InteractionAction = 'stop' | 'pause' | 'restart';
export type Redirection = 'follow' | 'canonical';
/** XHR 模式点一下还是点两下（ADR-020）。按页面存，见 page-selectors.ts */
export type ClickAction = 'single' | 'double';

/** 固定档的快捷数字（点击即"上屏"，不参与持久化语义，见 ADR-021） */
export const FIXED_PRESETS = [3, 5, 10, 60] as const;

export const MIN_INTERVAL_SECONDS = 1;
export const MAX_INTERVAL_SECONDS = 86400;

export const SCHEMA_VERSION = 3;

export type Options = {
  schemaVersion: typeof SCHEMA_VERSION;

  // ── 间隔
  intervalMode: IntervalMode;
  /** 固定档唯一的秒数来源：−/+ 对它 ∓1，chip 把它上屏，手动输入直接改它（ADR-021） */
  fixedSeconds: number;
  randomMinSeconds: number;
  randomMaxSeconds: number;
  /** ADR-006：避免连续两轮取到同一个随机值 */
  avoidRepeatRandom: boolean;

  // ── 刷新类型（原 ARP「监控」tab，搬到「间隔」）
  refreshType: RefreshType;

  // ── 常规开关
  hardRefresh: boolean;
  keepActive: boolean;
  refreshLimitEnabled: boolean;
  refreshLimitCount: number;
  interactions: boolean;
  interactionAction: InteractionAction;
  /** 重新开始前等待秒数，仅 interactionAction==='restart' 时生效 */
  interactionRestartWait: number;
  ignoreInputField: boolean;
  redirection: Redirection;
};

export const DEFAULT_OPTIONS: Options = {
  schemaVersion: SCHEMA_VERSION,

  intervalMode: 'fixed',
  fixedSeconds: 10,
  randomMinSeconds: 5,
  randomMaxSeconds: 30,
  avoidRepeatRandom: true,

  refreshType: 'full',

  hardRefresh: false,
  keepActive: false,
  refreshLimitEnabled: false,
  refreshLimitCount: 10,
  interactions: false,
  interactionAction: 'stop',
  interactionRestartWait: 5,
  ignoreInputField: true,
  redirection: 'follow',
};

/** 某个页面第一次配置触发方式时的默认值 */
export const DEFAULT_CLICK_ACTION: ClickAction = 'single';
