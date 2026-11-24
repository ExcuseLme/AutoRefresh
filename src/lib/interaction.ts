import type { Options } from './options';
import type { Session } from './session';

/** 交互决策（docs/05 §5.2）。对齐 ARP `xN`：总开关 → 输入框过滤 → 三选一动作 */
export type InteractionDecision = { action: 'pause' | 'stop' | 'restart'; waitSeconds: number } | null;

export function decideInteraction(opt: Options, isInput: boolean): InteractionDecision {
  if (!opt.interactions) return null;
  if (isInput && opt.ignoreInputField) return null;
  return { action: opt.interactionAction, waitSeconds: opt.interactionRestartWait };
}
