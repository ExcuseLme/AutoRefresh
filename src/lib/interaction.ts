import type { IntervalMode, Options } from './options';

/** 交互决策（docs/05 §5.2）。对齐 ARP `xN`：总开关 → 触发范围过滤 → 三选一动作 */
export type InteractionDecision = { action: 'pause' | 'stop' | 'restart'; waitSeconds: number } | null;

/**
 * 触发范围（ADR-028）。三档**互斥**，用枚举而不是两个布尔：
 *
 * | 档位 | 谁会触发交互动作 |
 * | --- | --- |
 * | `all` | 任何交互（点击/打字/滚动） |
 * | `outside-input` | 只有输入框外的交互（默认） |
 * | `inside-input-only` | 只有输入框内的点击/打字，普通点击与滚动不影响刷新 |
 *
 * 为什么是枚举：2 个开关 = 4 种组合，但只有上述 3 种合法，
 * `{interactionInputOnly:true, ignoreInputField:true}` 是冗余非法态。
 * 改成三档后互斥天然成立，不需要优先级、不需要"记住上一档"、也不会出现非法状态。
 *
 * 存储层仍沿用两个布尔字段（不改 schema），由 `scopePatch` / `triggerScope` 双向映射：
 * - `all`    ⇒ `{ interactionInputOnly: false, ignoreInputField: false }`
 * - `outside`⇒ `{ interactionInputOnly: false, ignoreInputField: true }`
 * - `inside` ⇒ `{ interactionInputOnly: true }`（`ignoreInputField` 此时不参与判定）
 */
export type TriggerScope = 'all' | 'outside-input' | 'inside-input-only';

/** 档位 ⇒ 落到存储字段的 patch（供 UI 用） */
export function scopePatch(scope: TriggerScope): Partial<Options> {
  switch (scope) {
    case 'all':
      return { interactionInputOnly: false, ignoreInputField: false };
    case 'outside-input':
      return { interactionInputOnly: false, ignoreInputField: true };
    case 'inside-input-only':
      // 只需打开 interactionInputOnly；它优先于 ignoreInputField，后者无需改动
      return { interactionInputOnly: true };
  }
}

/** 存储字段 ⇒ 档位（供判定与 UI 回显用） */
export function triggerScope(
  opt: Pick<Options, 'interactionInputOnly' | 'ignoreInputField'>,
): TriggerScope {
  if (opt.interactionInputOnly) return 'inside-input-only';
  return opt.ignoreInputField ? 'outside-input' : 'all';
}

/**
 * 「重新开始前等待」用哪个秒数？（ADR-026）
 *
 * 固定档：直接用当前固定刷新间隔（用户不用再填一个数字）。
 * 随机档：没有"当前间隔"这个单一数值，用 `interactionRestartWait`。
 */
export function restartWaitSeconds(
  opt: Pick<Options, 'intervalMode' | 'fixedSeconds' | 'interactionRestartWait'>,
  fallbackSeconds: number,
): number {
  if (opt.intervalMode === 'fixed') return Math.max(0, Math.round(opt.fixedSeconds));
  return Math.max(0, Math.round(fallbackSeconds));
}

/** 「重新开始前等待」是否需要在面板上给一个自定义输入框（固定档不需要） */
export function needsCustomRestartWait(mode: IntervalMode): boolean {
  return mode === 'random';
}

export function decideInteraction(opt: Options, isInput: boolean): InteractionDecision {
  if (!opt.interactions) return null;
  switch (triggerScope(opt)) {
    case 'inside-input-only':
      if (!isInput) return null;
      break;
    case 'outside-input':
      if (isInput) return null;
      break;
    case 'all':
    default:
      break;
  }
  return {
    action: opt.interactionAction,
    waitSeconds: restartWaitSeconds(opt, opt.interactionRestartWait),
  };
}
