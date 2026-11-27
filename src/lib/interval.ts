import { MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS, type Options } from './options';

/** 秒 → 毫秒，并夹到合法区间（ADR-007：非法值不会走到这里，这里只防迁移脏数据） */
export function clampSeconds(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return MIN_INTERVAL_SECONDS;
  return Math.min(MAX_INTERVAL_SECONDS, Math.round(v));
}

/**
 * 「当前间隔配置」的指纹（ADR-036）。
 *
 * 用来判断用户改配置时**下一轮的间隔是否真的要变**：
 *   - 只有真正决定间隔大小的字段参与（`fixedSeconds` / `randomMin` / `randomMax` / `mode`）
 *   - `avoidRepeatRandom` 不参与（它只影响随机取值去重，不改变量级）
 *
 * 为什么不直接比 `nextDelayMs()` 的返回值：随机档每次调用都会取新值，
 * 两次调用必然不同，没法用来判断"配置变了没有"。
 */
export function intervalSignature(
  opt: Pick<Options, 'intervalMode' | 'fixedSeconds' | 'randomMinSeconds' | 'randomMaxSeconds'>,
): string {
  if (opt.intervalMode === 'random') {
    const min = clampSeconds(opt.randomMinSeconds);
    const max = clampSeconds(opt.randomMaxSeconds);
    // 与 nextDelayMs 一致：min>max 时按交换后的区间取值，所以指纹也要归一
    return `random:${Math.min(min, max)}-${Math.max(min, max)}`;
  }
  return `fixed:${clampSeconds(opt.fixedSeconds)}`;
}

/**
 * 是否需要因为间隔配置变化而重置倒计时（ADR-036）。
 *
 * 两条判断都成立才重置：
 *   1. 会话**正在倒计时**（`status === 'start'`）—— 手动暂停的不该自己跑起来
 *   2. 指纹真的变了 —— 只改「强制刷新」之类的无关配置不该打断倒计时
 *
 * `prevSig` 为 undefined（本特性上线前就存在的旧会话）按"变了"处理：
 * 用户既然改了间隔，就该立即应用，没必要为兼容旧数据而不生效。
 */
export function needsRearm(
  status: 'start' | 'pause' | 'wait',
  prevSig: string | undefined,
  nextSig: string,
): boolean {
  if (status !== 'start') return false;
  return prevSig !== nextSig;
}

/**
 * 计算下一轮等待毫秒数。设计依据 docs/05-refresh-engine.md §2
 *
 * 与 ARP `qg()` 对齐点：
 * - 随机区间为**闭区间**（整数 min ⇒ `span = max-min+1`）
 * - `min===max` 退化为固定值
 * - ADR-006：避免与上一轮取到同一个值（最多重试 10 次，与 ARP `$_()` 同上限）
 */
export function nextDelayMs(
  opt: Pick<
    Options,
    'intervalMode' | 'fixedSeconds' | 'randomMinSeconds' | 'randomMaxSeconds' | 'avoidRepeatRandom'
  >,
  prevDelayMs = 0,
  rng: () => number = Math.random,
): number {
  switch (opt.intervalMode) {
    case 'random': {
      const min = clampSeconds(opt.randomMinSeconds);
      const max = clampSeconds(opt.randomMaxSeconds);
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      if (lo === hi) return lo * 1000;

      const span = hi - lo + 1; // 闭区间
      let v = lo + Math.floor(rng() * span);
      if (opt.avoidRepeatRandom) {
        for (let i = 0; i < 10 && v * 1000 === prevDelayMs; i++) {
          v = lo + Math.floor(rng() * span);
        }
      }
      return v * 1000;
    }

    case 'fixed':
    default:
      return clampSeconds(opt.fixedSeconds) * 1000;
  }
}
