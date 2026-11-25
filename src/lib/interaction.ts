import type { IntervalMode, Options } from './options';
import type { Session } from './session';

/** 交互决策（docs/05 §5.2）。对齐 ARP `xN`：总开关 → 输入框过滤 → 三选一动作 */
export type InteractionDecision = { action: 'pause' | 'stop' | 'restart'; waitSeconds: number } | null;

/**
 * 「重新开始前等待」用哪个秒数？（ADR-026）
 *
 * 用户要求：固定档时不要让人再填一个数字，**直接用当前固定刷新间隔**；
 * 只有随机档才需要那个自定义输入框（随机档没有"当前间隔"这个单一数值）。
 *
 * @param opt             全局配置
 * @param fallbackSeconds 随机档时使用的自定义值
 */
export function restartWaitSeconds(
  opt: Pick<Options, 'intervalMode' | 'fixedSeconds' | 'interactionRestartWait'>,
  fallbackSeconds: number,
): number {
  if (opt.intervalMode === 'fixed') return Math.max(0, Math.round(opt.fixedSeconds));
  return Math.max(0, Math.round(fallbackSeconds));
}

export function decideInteraction(opt: Options, isInput: boolean): InteractionDecision {
  if (!opt.interactions) return null;
  if (isInput && opt.ignoreInputField) return null;
  return {
    action: opt.interactionAction,
    waitSeconds: restartWaitSeconds(opt, opt.interactionRestartWait),
  };
}

/** 「重新开始前等待」是否需要在面板上给一个自定义输入框（固定档不需要） */
export function needsCustomRestartWait(mode: IntervalMode): boolean {
  return mode === 'random';
}
