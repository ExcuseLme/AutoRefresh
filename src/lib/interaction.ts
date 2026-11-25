import type { IntervalMode, Options } from './options';

/** 交互决策（docs/05 §5.2）。对齐 ARP `xN`：总开关 → 触发范围过滤 → 三选一动作 */
export type InteractionDecision = { action: 'pause' | 'stop' | 'restart'; waitSeconds: number } | null;

/**
 * 触发范围（ADR-027）。三档，由两个互斥子选项决定：
 *
 * | interactionInputOnly | ignoreInputField | 谁会触发 |
 * | --- | --- | --- |
 * | false | false | **所有**交互（点击/打字/滑动）都触发 |
 * | false | true  | 只有**输入框外**的交互触发（默认，输入框内打字不打扰刷新） |
 * | true  | （无关） | 只有**输入框内**的点击/打字触发，普通点击与滚动不影响刷新 |
 *
 * `interactionInputOnly` 优先：一旦开启，`ignoreInputField` 不再参与判断
 * （否则两者同时为真的组合会产生"任何交互都不触发"的死状态）。
 */
export type TriggerScope = 'all' | 'outside-input' | 'inside-input-only';

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

/**
 * 供 UI 用：两个子开关的互斥规则。
 *
 * 设计要点（ADR-027）：互斥是**单向**的，这样"关掉刚打开的那个"能回到原状态。
 *
 * | 操作 | 结果 patch | 说明 |
 * | --- | --- | --- |
 * | 开「仅输入框内」 | 只设 `interactionInputOnly=true` | 不动 `ignoreInputField`；它已被 `triggerScope` 的优先级盖住 |
 * | 关「仅输入框内」 | 只设 `interactionInputOnly=false` | `ignoreInputField` 还是原来的值 ⇒ **自动回到关它之前的那一档** |
 * | 开「忽略输入框交互」 | `ignoreInputField=true` + `interactionInputOnly=false` | 否则点了看起来没反应（inputOnly 优先），必须真的切走 |
 * | 关「忽略输入框交互」 | 只设 `ignoreInputField=false` | 此时必然是 `all` 档 |
 */
export function exclusiveScopePatch(
  which: 'inputOnly' | 'ignoreInput',
  value: boolean,
): Partial<Options> {
  if (which === 'inputOnly') {
    return value
      ? { interactionInputOnly: true }
      : { interactionInputOnly: false };
  }
  return value
    ? { ignoreInputField: true, interactionInputOnly: false }
    : { ignoreInputField: false };
}
