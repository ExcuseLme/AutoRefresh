/**
 * 暂停/继续的剩余时间语义（ADR-034）
 *
 * 用户 bug 报告："在暂停之后不会记住当前倒计时到多少了，点击继续后会立即触发刷新
 * 而不是继续之前倒计时的数字继续倒计时"
 *
 * 这里把核心算式抽成纯函数来测，避免只能靠浏览器手动验证。
 */

/** 暂停瞬间的剩余毫秒数 */
function remainAtPause(armedAt: number, delayMs: number, now: number): number {
  return Math.max(0, armedAt + delayMs - now);
}

/**
 * 继续时把 armedAt 往回挪，使 "armedAt + delayMs - now === remain"。
 * 这样面板/徽章的现有倒计时读取逻辑（都用 armedAt + delayMs - now）无需改动。
 */
function armedAtAfterResume(now: number, delayMs: number, remain: number): number {
  return now - (delayMs - remain);
}

import { describe, expect, it } from 'vitest';
import { summarize } from '@/lib/session-machine';
import { createSession } from '@/lib/session';

describe('pause/resume 的剩余时间（ADR-034）', () => {
  const armedAt = 1_000_000;
  const delayMs = 10_000;

  it('暂停时记住已数掉 3 秒 ⇒ 剩 7 秒', () => {
    expect(remainAtPause(armedAt, delayMs, armedAt + 3_000)).toBe(7_000);
  });

  it('继续后从 7 秒接着数，而不是重新 10 秒', () => {
    const remain = 7_000;
    const resumeAt = armedAt + 20_000; // 暂停了很久才点继续
    const newArmedAt = armedAtAfterResume(resumeAt, delayMs, remain);

    // 面板/徽章用同一个算式读剩余
    expect(newArmedAt + delayMs - resumeAt).toBe(remain);
  });

  it('继续后 1 秒时剩余仍是 6 秒（真的在接着数）', () => {
    const remain = 7_000;
    const resumeAt = armedAt + 20_000;
    const newArmedAt = armedAtAfterResume(resumeAt, delayMs, remain);
    expect(newArmedAt + delayMs - (resumeAt + 1_000)).toBe(6_000);
  });

  it('暂停发生在最后一刻 ⇒ 剩余接近 0，不会变成负数', () => {
    expect(remainAtPause(armedAt, delayMs, armedAt + delayMs + 5_000)).toBe(0);
  });

  it('summarize 在手动暂停时带出剩余秒数', () => {
    const s = { ...createSession(1, 'https://example.com/', delayMs, 'tok'), status: 'pause' as const, pausedRemainMs: 7_000 };
    const out = summarize(s, null);
    expect(out.kind).toBe('paused');
    if (out.kind === 'paused') expect(out.remainSeconds).toBe(7);
  });

  it('summarize 在输入框占用暂停时不带剩余（那种暂停是"重新计一轮"）', () => {
    const s = { ...createSession(1, 'https://example.com/', delayMs, 'tok'), status: 'pause' as const };
    const out = summarize(s, null);
    expect(out.kind).toBe('paused');
    if (out.kind === 'paused') expect(out.remainSeconds).toBeUndefined();
  });
});
