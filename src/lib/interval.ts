import { MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS, type Options } from './options';

/** 秒 → 毫秒，并夹到合法区间（ADR-007：非法值不会走到这里，这里只防迁移脏数据） */
export function clampSeconds(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return MIN_INTERVAL_SECONDS;
  return Math.min(MAX_INTERVAL_SECONDS, Math.round(v));
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
    | 'intervalMode'
    | 'fixedSeconds'
    | 'customSeconds'
    | 'randomMinSeconds'
    | 'randomMaxSeconds'
    | 'avoidRepeatRandom'
  >,
  prevDelayMs = 0,
  rng: () => number = Math.random,
): number {
  switch (opt.intervalMode) {
    case 'custom':
      return clampSeconds(opt.customSeconds) * 1000;

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
