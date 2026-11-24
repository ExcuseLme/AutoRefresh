/**
 * 全局配置（唯一持久配置）。设计依据：docs/03-storage-and-state.md §1
 *
 * 与 ARP 的差异：
 * - 只有一份全局配置，没有 domain_config / site_scopes（ADR-002）
 * - 时间一律「整数秒」，不接受小数（OQ-5 已确认）
 */

export type IntervalMode = 'fixed' | 'random' | 'custom';
export type RefreshType = 'full' | 'xhr';
export type InteractionAction = 'stop' | 'pause' | 'restart';
export type Redirection = 'follow' | 'canonical';

/** 固定档预设（需求只保留这 4 个） */
export const FIXED_PRESETS = [3, 5, 10, 60] as const;
export type FixedPreset = (typeof FIXED_PRESETS)[number];

export const MIN_INTERVAL_SECONDS = 1;
export const MAX_INTERVAL_SECONDS = 86400;

export type Options = {
  schemaVersion: 1;

  // ── 间隔
  intervalMode: IntervalMode;
  /** 固定档命中的预设秒数；与 customSeconds 分存，避免"值相等但意图不同" */
  fixedPreset: FixedPreset;
  /** 固定档当前生效秒数（= fixedPreset） */
  fixedSeconds: number;
  /** 自定义档全局唯一的秒数（B3：全局同步） */
  customSeconds: number;
  randomMinSeconds: number;
  randomMaxSeconds: number;
  /** ADR-006：避免连续两轮取到同一个随机值 */
  avoidRepeatRandom: boolean;

  // ── 刷新类型（原 ARP「监控」tab，搬到「间隔」）
  refreshType: RefreshType;
  /** ADR-009：XHR 模式通过点击该选择器触发页面自身的请求 */
  autoClickSelector: string;

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
  schemaVersion: 1,

  intervalMode: 'fixed',
  fixedPreset: 10,
  fixedSeconds: 10,
  customSeconds: 10,
  randomMinSeconds: 5,
  randomMaxSeconds: 30,
  avoidRepeatRandom: true,

  refreshType: 'full',
  autoClickSelector: '',

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
