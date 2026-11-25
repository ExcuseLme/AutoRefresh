import type { Options } from './options';

/**
 * 交互模式语义（ADR-032）
 *
 * 用户原话：
 *   "我只有两种需求'无视输入框输入状态始终稳定的倒计时刷新'和
 *    '光标在输入框内或输入框内有任何内容时持续打断刷新直到光标不在任何输入框内
 *     且所有输入框内没有内容时才恢复自动倒计时刷新'，分别对应'任何交互'和'仅框内'"
 *
 * 所以是二选一，没有"总开关 + 三选一动作"这层了：
 *
 * | interactionMode | 倒计时行为 |
 * | --- | --- |
 * | `stable` | **始终稳定**，输入框有没有焦点/内容都不影响 |
 * | `hold-input` | 输入框**占用中**就暂停（不刷新、不推进），**解除后自动恢复**倒计时 |
 *
 * 两个关键设计判断：
 *
 * 1. **"占用"是状态，不是事件**。旧实现把点击/按键当成一次性事件去触发
 *    stop / pause / restart 动作，这与用户描述完全不符 —— 他要的是"占用的整段时间都不刷新"。
 *    因此判定入口是 `computeInputHold(doc)`（`lib/input-hold.ts`），由内容脚本持续监视并上报。
 *
 * 2. **不需要"停止"和"重新开始"**。`hold-input` 的定义就是"暂停 → 解除后恢复"，
 *    `stable` 根本不打断；三选一动作与"重新开始前等待秒数"都没有适用场景，已删除
 *    （连同 `interactionAction` / `interactionRestartWait` / `interactionInputOnly` /
 *    `ignoreInputField` 四个字段，见 schema v3 → v4 迁移）。
 */

export function isInputHoldMode(opt: Pick<Options, 'interactionMode'>): boolean {
  return opt.interactionMode === 'hold-input';
}

/**
 * 会话是否应当因输入框占用而暂停。
 *
 * `stable` 档永不 hold，所以调用方不用再判断 `inputHeld` 之外的任何东西。
 */
export function shouldHoldForInput(opt: Pick<Options, 'interactionMode'>, inputHeld: boolean): boolean {
  return inputHeld && isInputHoldMode(opt);
}
